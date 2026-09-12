import { countWords } from '../words';
import { BLOCK_TAGS, EXCLUDED_ANCESTORS } from './patterns';
import { findArticleContainer, getInnerText, getLinkDensity, isProbablyVisible, MIN_CONFIDENT_SCORE } from './score';

export interface ExtractedBlock {
  id: number;
  /** Elemento de anclaje del overlay (el primero del grupo). */
  element: HTMLElement;
  /** Uno o varios elementos: varios cuando se fusionaron párrafos cortos. */
  elements: HTMLElement[];
  text: string;
  words: number;
  merged: boolean;
}

interface Candidate {
  element: HTMLElement;
  text: string;
  words: number;
}

/**
 * Dos bloques solo se fusionan si son hermanos INMEDIATOS. Es deliberadamente
 * conservador: si entre medias hay un encabezado, una figura o una tabla, el
 * salto de tema es real y fusionar juntaría ideas que no van juntas.
 */
function isAdjacent(a: HTMLElement, b: HTMLElement): boolean {
  return a.nextElementSibling === b;
}

/** La acumulación de párrafos cortos junta entre 2 y 5. */
export const MIN_MERGE = 2;
export const MAX_MERGE = 5;

interface Group {
  elements: HTMLElement[];
  texts: string[];
  words: number;
}

/**
 * ¿Se sostiene el grupo por sí solo? Sí cuando llega al umbral, o cuando junta
 * al menos dos párrafos y la mitad del umbral: son párrafos que por separado no
 * dan para un resumen y que juntos tienen sustancia.
 */
function standsAlone(group: Group, minWords: number): boolean {
  return group.words >= minWords || (group.elements.length >= MIN_MERGE && group.words >= minWords / 2);
}

/**
 * Agrupa los candidatos en bloques resumibles. Ningún párrafo se queda fuera.
 *
 * Fase 1 — acumulación. Un párrafo que ya supera el umbral va solo. Los que no
 * llegan se acumulan mientras sean hermanos adyacentes, y el grupo se cierra al
 * alcanzar el umbral o al llegar a `MAX_MERGE` párrafos: más allá, el resumen
 * mezclaría demasiadas ideas. Un encabezado, una figura o un cambio de
 * contenedor cortan la serie.
 *
 * Fase 2 — rescate. Lo que queda sin sostenerse solo (un corto suelto, una
 * serie cortada antes de tiempo) se une al bloque adyacente con menos palabras,
 * sea el anterior o el siguiente. Solo queda solo el que no tiene ningún vecino
 * adyacente, y aun así se resume: la regla del 60 % decidirá después si merece
 * overlay. En este rescate el tope de párrafos puede superarse: antes eso que
 * dejar un párrafo fuera.
 */
export function groupBlocks(candidates: Candidate[], minWords: number): ExtractedBlock[] {
  const groups: Group[] = [];
  let run: Candidate[] = [];

  const toGroup = (members: Candidate[]): Group => ({
    elements: members.map((c) => c.element),
    texts: members.map((c) => c.text),
    words: members.reduce((sum, c) => sum + c.words, 0),
  });

  const closeRun = (): void => {
    if (run.length > 0) groups.push(toGroup(run));
    run = [];
  };

  for (const candidate of candidates) {
    if (candidate.words >= minWords) {
      closeRun();
      groups.push(toGroup([candidate]));
      continue;
    }

    // Un corto que no continúa la serie anterior la cierra y empieza otra.
    const previous = run[run.length - 1];
    if (previous && !isAdjacent(previous.element, candidate.element)) closeRun();

    run.push(candidate);
    const runWords = run.reduce((sum, c) => sum + c.words, 0);
    if (runWords >= minWords || run.length >= MAX_MERGE) closeRun();
  }
  closeRun();

  rescueWeakGroups(groups, minWords);

  return groups.map((group, id) => ({
    id,
    element: group.elements[0]!,
    elements: group.elements,
    text: group.texts.join('\n\n'),
    words: group.words,
    merged: group.elements.length > 1,
  }));
}

/**
 * Une cada grupo que no se sostiene solo con su vecino adyacente más pequeño.
 * Se repite hasta que ningún grupo débil tenga vecino: dos débiles adyacentes
 * acaban juntos, y un débil junto a uno grande se suma a él.
 */
function rescueWeakGroups(groups: Group[], minWords: number): void {
  const adjacent = (a: Group, b: Group): boolean =>
    isAdjacent(a.elements[a.elements.length - 1]!, b.elements[0]!);

  for (;;) {
    let index = -1;
    let target = -1;
    for (let i = 0; i < groups.length && index < 0; i += 1) {
      const group = groups[i]!;
      if (standsAlone(group, minWords)) continue;
      const before = groups[i - 1];
      const after = groups[i + 1];
      const canBefore = before !== undefined && adjacent(before, group);
      const canAfter = after !== undefined && adjacent(group, after);
      if (!canBefore && !canAfter) continue;
      index = i;
      // Con vecino a ambos lados gana el que tiene menos palabras; en empate, el anterior.
      if (canBefore && canAfter) target = before!.words <= after!.words ? i - 1 : i + 1;
      else target = canBefore ? i - 1 : i + 1;
    }
    if (index < 0) return;

    const first = Math.min(index, target);
    const [a, b] = [groups[first]!, groups[first + 1]!];
    groups.splice(first, 2, {
      elements: [...a.elements, ...b.elements],
      texts: [...a.texts, ...b.texts],
      words: a.words + b.words,
    });
  }
}

export interface ExtractionResult {
  container: HTMLElement | null;
  score: number;
  title: string;
  fullText: string;
  /** Bloques por encima del umbral. */
  blocks: ExtractedBlock[];
  /** Todos los bloques candidatos, incluidos los cortos (para diagnóstico). */
  totalCandidates: number;
  totalWords: number;
  /** Motivo por el que conviene degradar al Modo B, si lo hay. */
  degradeReason: DegradeReason | null;
}

export type DegradeReason = 'low-score' | 'too-few-blocks' | 'anchor-unsafe';

function hasExcludedAncestor(el: Element, root: Element): boolean {
  let node: Element | null = el.parentElement;
  while (node && node !== root) {
    if (EXCLUDED_ANCESTORS.has(node.tagName)) return true;
    node = node.parentElement;
  }
  return false;
}

/** Un <div> solo cuenta como bloque si su contenido es texto en línea, sin hijos de bloque. */
function isInlineOnlyDiv(el: Element): boolean {
  for (const child of Array.from(el.children)) {
    if (BLOCK_TAGS.has(child.tagName) || child.tagName === 'SECTION' || child.tagName === 'ARTICLE') {
      return false;
    }
  }
  return true;
}

/** Proporción del texto que vive dentro de <code>. */
function codeRatio(el: Element): number {
  const total = getInnerText(el).length;
  if (!total) return 0;
  let code = 0;
  for (const node of Array.from(el.querySelectorAll('code, kbd, samp, var'))) {
    code += getInnerText(node).length;
  }
  return code / total;
}

export function isEligibleBlock(el: HTMLElement, root: Element): boolean {
  if (!BLOCK_TAGS.has(el.tagName)) return false;
  if (el.tagName === 'DIV' && !isInlineOnlyDiv(el)) return false;
  if (hasExcludedAncestor(el, root)) return false;
  if (!isProbablyVisible(el)) return false;
  if (codeRatio(el) > 0.4) return false;
  // Un "párrafo" que es casi todo enlaces es navegación disfrazada.
  if (getLinkDensity(el) > 0.5) return false;
  return true;
}

/**
 * Verificación de anclaje: detecta las condiciones que romperían un overlay
 * in-place y que deben degradar al Modo B.
 */
export function verifyAnchoring(blocks: ExtractedBlock[]): boolean {
  if (blocks.length === 0) return false;
  const rects: DOMRect[] = [];
  for (const element of blocks.flatMap((block) => block.elements)) {
    const rect = element.getBoundingClientRect();
    if (rect.height <= 0 || rect.width <= 0) return false;

    let node: HTMLElement | null = element;
    let depth = 0;
    while (node && depth < 12) {
      const style = node.ownerDocument?.defaultView?.getComputedStyle(node);
      if (style && (style.position === 'fixed' || style.position === 'sticky')) return false;
      node = node.parentElement;
      depth += 1;
    }
    rects.push(rect);
  }

  // Cajas solapadas: señal de layout absoluto donde el overlay taparía contenido ajeno.
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i]!;
      const b = rects[j]!;
      const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      if (overlapY > 4 && overlapX > 4) return false;
    }
  }
  return true;
}

export interface ExtractOptions {
  minWords: number;
  /** Saltar la verificación de anclaje (Modo B: el markup es nuestro). */
  skipAnchorCheck?: boolean;
}

export function extract(root: ParentNode & Element, options: ExtractOptions): ExtractionResult {
  const candidate = findArticleContainer(root);
  const doc = root.ownerDocument ?? (root as unknown as Document);
  const title =
    (doc.querySelector('h1')?.textContent ?? '').trim() ||
    (doc.title ?? '').trim() ||
    '';

  if (!candidate) {
    return {
      container: null,
      score: 0,
      title,
      fullText: '',
      blocks: [],
      totalCandidates: 0,
      totalWords: countWords(getInnerText(root)),
      degradeReason: 'low-score',
    };
  }

  const container = candidate.element;
  const elements = Array.from(container.querySelectorAll<HTMLElement>('p, li, blockquote, dd, div'));
  const candidates: Candidate[] = [];

  for (const el of elements) {
    if (!isEligibleBlock(el, container)) continue;
    const text = getInnerText(el);
    if (!text) continue;
    const words = countWords(text);
    if (words === 0) continue;
    candidates.push({ element: el, text, words });
  }

  // Un bloque anidado dentro de otro ya aceptado duplicaría el texto.
  const deduped = candidates.filter(
    (block) => !candidates.some((other) => other !== block && other.element.contains(block.element)),
  );

  // Los párrafos cortos consecutivos se fusionan hasta alcanzar el umbral.
  const blocks = groupBlocks(deduped, options.minWords);
  const fullText = deduped.map((block) => block.text).join('\n\n');
  const totalWords = countWords(getInnerText(container));

  let degradeReason: DegradeReason | null = null;
  if (candidate.score < MIN_CONFIDENT_SCORE) {
    degradeReason = 'low-score';
  } else if (blocks.length < 2 && totalWords > 500) {
    degradeReason = 'too-few-blocks';
  } else if (!options.skipAnchorCheck && blocks.length > 0 && !verifyAnchoring(blocks)) {
    degradeReason = 'anchor-unsafe';
  }

  return {
    container,
    score: candidate.score,
    title,
    fullText,
    blocks,
    totalCandidates: deduped.length,
    totalWords,
    degradeReason,
  };
}
