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
  /** Motivo por el que conviene degradar al Modo B, si lo hay. Bloquea: se pregunta antes de seguir. */
  degradeReason: DegradeReason | null;
  /** Dudas que no impiden seguir in-place, pero merecen un aviso no bloqueante. */
  warnings: DegradeReason[];
  /** Bloques retirados por no poder anclarse, con el motivo: para el log y el diagnóstico. */
  unsafeBlocks: UnsafeBlock[];
  /** Fracción de las palabras del contenedor que cubren los bloques. Mide cuánto se pierde el extractor. */
  coverage: number;
}

export type DegradeReason = 'low-score' | 'too-few-blocks' | 'anchor-unsafe';

export type AnchorProblem = 'invisible' | 'overlap';

export interface UnsafeBlock {
  /** Id que tenía el bloque ANTES de retirarlo (los ids se reasignan después). */
  id: number;
  reason: AnchorProblem;
  /** Descripción corta del ancla, para reconocerla en el log: `P#intro` o `DIV.lead`. */
  anchor: string;
  words: number;
}

export interface AnchorReport {
  safe: ExtractedBlock[];
  unsafe: UnsafeBlock[];
}

/** Umbrales de la degradación. Puestos por criterio, pendientes de medir sobre páginas reales. */
export const DEGRADE = {
  /** Con la puntuación por debajo, hace falta evidencia directa (bloques y cobertura) para seguir. */
  minBlocksForLowScore: 3,
  minCoverageForLowScore: 0.5,
  /** Con más de estas palabras, cubrir menos de esta fracción significa que el extractor se pierde el artículo. */
  minWordsForCoverage: 500,
  minCoverage: 0.4,
  /** Fracción de bloques inseguros a partir de la cual no se sigue in-place. */
  maxUnsafeFraction: 1 / 3,
} as const;

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

function describeAnchor(element: HTMLElement): string {
  const cls = element.className && typeof element.className === 'string' ? element.className.split(/\s+/)[0] : '';
  return element.id ? `${element.tagName}#${element.id}` : cls ? `${element.tagName}.${cls}` : element.tagName;
}

function overlaps(a: DOMRect, b: DOMRect): boolean {
  const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  return overlapY > 4 && overlapX > 4;
}

/**
 * Verificación de anclaje, bloque a bloque. Un bloque es inseguro si alguno de
 * sus elementos mide 0 (está en un acordeón cerrado, una pestaña oculta o un
 * "leer más" plegado: pasa la comprobación de visibilidad porque el `display:
 * none` está en un ancestro) o si se solapa con un bloque ya aceptado (layout
 * absoluto, donde el overlay taparía contenido ajeno). Se retira solo ese
 * bloque; el resto sigue siendo perfectamente anclable.
 *
 * No se mira si hay ancestros `fixed` o `sticky`: el overlay se posiciona en
 * absoluto dentro del propio párrafo y se mueve con él, así que no le afectan.
 */
export function verifyAnchoring(blocks: ExtractedBlock[]): AnchorReport {
  const safe: ExtractedBlock[] = [];
  const unsafe: UnsafeBlock[] = [];
  const keptRects: DOMRect[] = [];

  for (const block of blocks) {
    const rects = block.elements.map((element) => element.getBoundingClientRect());
    const report = (reason: AnchorProblem) =>
      unsafe.push({ id: block.id, reason, anchor: describeAnchor(block.element), words: block.words });

    if (rects.some((rect) => rect.height <= 0 || rect.width <= 0)) {
      report('invisible');
      continue;
    }
    // De un par solapado se retira el segundo en orden de documento.
    if (rects.some((rect) => keptRects.some((kept) => overlaps(rect, kept)))) {
      report('overlap');
      continue;
    }
    safe.push(block);
    keptRects.push(...rects);
  }
  return { safe, unsafe };
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
      warnings: [],
      unsafeBlocks: [],
      coverage: 0,
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
  let blocks = groupBlocks(deduped, options.minWords);
  const fullText = deduped.map((block) => block.text).join('\n\n');
  const totalWords = countWords(getInnerText(container));

  // Anclaje por bloque: los inseguros se retiran y el resto conserva ids contiguos
  // (el modo per-block usa `id - 1` para encontrar el párrafo anterior).
  let unsafeBlocks: UnsafeBlock[] = [];
  const totalBlocks = blocks.length;
  if (!options.skipAnchorCheck && blocks.length > 0) {
    const report = verifyAnchoring(blocks);
    unsafeBlocks = report.unsafe;
    blocks = report.safe.map((block, id) => ({ ...block, id }));
  }

  const blockWords = blocks.reduce((sum, block) => sum + block.words, 0);
  const coverage = totalWords > 0 ? Math.min(1, blockWords / totalWords) : 0;

  /*
   * La puntuación del contenedor es un indicio; los bloques encontrados y la
   * cobertura son la evidencia. Solo se bloquea (degradeReason) cuando la
   * evidencia también es mala; si la puntuación es baja pero hay bloques de
   * sobra, se sigue in-place con un aviso.
   */
  let degradeReason: DegradeReason | null = null;
  const warnings: DegradeReason[] = [];

  if (candidate.score < MIN_CONFIDENT_SCORE) {
    const weakEvidence =
      blocks.length < DEGRADE.minBlocksForLowScore || coverage < DEGRADE.minCoverageForLowScore;
    if (weakEvidence) degradeReason = 'low-score';
    else warnings.push('low-score');
  }
  if (
    !degradeReason &&
    totalWords > DEGRADE.minWordsForCoverage &&
    (blocks.length < 2 || coverage < DEGRADE.minCoverage)
  ) {
    degradeReason = 'too-few-blocks';
  }
  if (unsafeBlocks.length > 0) {
    if (!degradeReason && unsafeBlocks.length > totalBlocks * DEGRADE.maxUnsafeFraction) {
      degradeReason = 'anchor-unsafe';
    } else if (!degradeReason) {
      warnings.push('anchor-unsafe');
    }
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
    warnings,
    unsafeBlocks,
    coverage,
  };
}
