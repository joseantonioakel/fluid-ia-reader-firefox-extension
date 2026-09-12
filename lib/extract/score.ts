import {
  REGEXPS,
  DEFAULT_TAGS_TO_SCORE,
  NON_CONTAINER_TAGS,
  baseScoreForTag,
  getClassWeight,
} from './patterns';

export interface ScoredCandidate {
  element: HTMLElement;
  score: number;
}

/** Puntuación mínima para confiar en el candidato ganador. */
export const MIN_CONFIDENT_SCORE = 20;

export function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function getInnerText(el: Element): string {
  return normalizeText(el.textContent ?? '');
}

/**
 * Densidad de enlaces: proporción del texto que vive dentro de <a>.
 * Un menú de navegación tiende a 1; un párrafo de artículo, a 0.
 */
export function getLinkDensity(el: Element): number {
  const textLength = getInnerText(el).length;
  if (textLength === 0) return 0;
  let linkLength = 0;
  for (const link of Array.from(el.getElementsByTagName('a'))) {
    // Los anclas internas (#) cuentan a medias: suelen ser índices dentro del propio artículo.
    const coefficient = (link.getAttribute('href') ?? '').startsWith('#') ? 0.3 : 1;
    linkLength += getInnerText(link).length * coefficient;
  }
  return Math.min(1, linkLength / textLength);
}

export function isProbablyVisible(el: Element): boolean {
  const html = el as HTMLElement;
  if (html.hidden) return false;
  if (el.getAttribute('aria-hidden') === 'true') return false;
  const style = el.ownerDocument?.defaultView?.getComputedStyle(el);
  if (style) {
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (style.opacity === '0') return false;
  }
  return true;
}

/** ¿El subárbol coincide con el patrón de candidatos improbables? */
export function isUnlikelyCandidate(el: Element): boolean {
  const className = typeof el.className === 'string' ? el.className : '';
  const matchString = `${className} ${el.id}`;
  if (!REGEXPS.unlikelyCandidates.test(matchString)) return false;
  // Escape hatch de Readability: si además parece contenido, no se descarta.
  if (REGEXPS.okMaybeItsACandidate.test(matchString)) return false;
  if (el.tagName === 'BODY' || el.tagName === 'A') return false;
  return true;
}

function hasUnlikelyAncestor(el: Element, root: Element): boolean {
  let node: Element | null = el;
  while (node && node !== root) {
    if (isUnlikelyCandidate(node)) return true;
    node = node.parentElement;
  }
  return false;
}

function getAncestors(el: Element, depth: number): HTMLElement[] {
  const out: HTMLElement[] = [];
  let node = el.parentElement;
  while (node && out.length < depth) {
    out.push(node);
    if (node.tagName === 'BODY') break;
    node = node.parentElement;
  }
  return out;
}

function initialScore(el: HTMLElement): number {
  return baseScoreForTag(el.tagName) + getClassWeight(el);
}

/**
 * Encuentra el contenedor del artículo puntuando los nodos de texto y propagando
 * la puntuación a sus ancestros, tal como hace Readability, pero sobre el DOM vivo.
 */
export function findArticleContainer(root: ParentNode & Element): ScoredCandidate | null {
  const scores = new Map<HTMLElement, number>();

  const nodes = Array.from(root.querySelectorAll('p, td, pre, blockquote, li, section, h2, h3'));
  for (const node of nodes) {
    if (!DEFAULT_TAGS_TO_SCORE.has(node.tagName) && node.tagName !== 'BLOCKQUOTE' && node.tagName !== 'LI') {
      continue;
    }
    const text = getInnerText(node);
    if (text.length < 25) continue;
    if (hasUnlikelyAncestor(node, root)) continue;
    if (!isProbablyVisible(node)) continue;

    const ancestors = getAncestors(node, 3);
    if (ancestors.length === 0) continue;

    // 1 punto base, +1 por coma, +1 por cada 100 caracteres hasta un tope de 3.
    let contentScore = 1;
    contentScore += (text.match(/,/g) ?? []).length;
    contentScore += Math.min(Math.floor(text.length / 100), 3);

    ancestors.forEach((ancestor, level) => {
      if (NON_CONTAINER_TAGS.has(ancestor.tagName)) return;
      // El padre recibe la puntuación completa, el abuelo la mitad, y así sucesivamente.
      const divider = level === 0 ? 1 : level === 1 ? 2 : level * 3;
      const previous = scores.get(ancestor) ?? initialScore(ancestor);
      scores.set(ancestor, previous + contentScore / divider);
    });
  }

  let top: ScoredCandidate | null = null;
  for (const [element, rawScore] of scores) {
    // Penalizar contenedores dominados por enlaces (menús, listas de "relacionados").
    const score = rawScore * (1 - getLinkDensity(element));
    if (!top || score > top.score) top = { element, score };
  }
  if (!top) return null;

  // Ascender mientras el padre conserve al menos el 75 % de la puntuación,
  // para no cortar contenido legítimo que cuelgue de un wrapper.
  let current = top;
  let parent = current.element.parentElement;
  while (parent && parent.tagName !== 'BODY') {
    const parentScore = scores.get(parent);
    if (parentScore === undefined) break;
    const adjusted = parentScore * (1 - getLinkDensity(parent));
    if (adjusted < current.score * 0.75) break;
    current = { element: parent, score: adjusted };
    parent = parent.parentElement;
  }

  return current;
}
