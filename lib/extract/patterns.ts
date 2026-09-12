/**
 * Patrones portados de @mozilla/readability (Apache-2.0).
 *
 * NO se usa la librería como dependencia de runtime: sus heurísticas se aplican
 * directamente sobre el DOM vivo para que cada candidato conserve su referencia
 * al Element real sobre el que hay que anclar overlays.
 *
 * Ver NOTICE para la atribución de licencia.
 */

export const REGEXPS = {
  unlikelyCandidates:
    /-ad-|ai2html|banner|breadcrumbs|combx|comment|community|cover-wrap|disqus|extra|footer|gdpr|header|legends|menu|related|remark|replies|rss|shoutbox|sidebar|skyscraper|social|sponsor|supplemental|ad-break|agegate|pagination|pager|popup|yom-remote/i,
  okMaybeItsACandidate: /and|article|body|column|content|main|shadow/i,
  positive:
    /article|body|content|entry|hentry|h-entry|main|page|pagination|post|text|blog|story/i,
  negative:
    /-ad-|hidden|^hid$| hid$| hid |^hid |banner|combx|comment|com-|contact|footer|gdpr|masthead|media|meta|outbrain|promo|related|scroll|share|shoutbox|sidebar|skyscraper|sponsor|shopping|tags|widget/i,
} as const;

/** Etiquetas que se puntúan como contenedores de contenido. */
export const DEFAULT_TAGS_TO_SCORE = new Set([
  'SECTION',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'P',
  'TD',
  'PRE',
]);

/** Etiquetas que nunca pueden ser el contenedor del artículo. */
export const NON_CONTAINER_TAGS = new Set(['A', 'BR', 'HR', 'IMG', 'INPUT', 'BUTTON', 'SELECT']);

/** Contenedores donde jamás buscamos bloques de texto. */
export const EXCLUDED_ANCESTORS = new Set([
  'PRE',
  'CODE',
  'TABLE',
  'FIGURE',
  'NAV',
  'ASIDE',
  'FOOTER',
  'HEADER',
  'FORM',
  'BUTTON',
  'SELECT',
  'TEXTAREA',
]);

/** Etiquetas candidatas a ser un bloque de texto resumible. */
export const BLOCK_TAGS = new Set(['P', 'LI', 'BLOCKQUOTE', 'DD', 'DIV']);

/** Puntuación base según la etiqueta, tal como la aplica Readability. */
export function baseScoreForTag(tagName: string): number {
  switch (tagName) {
    case 'DIV':
      return 5;
    case 'PRE':
    case 'TD':
    case 'BLOCKQUOTE':
      return 3;
    case 'ADDRESS':
    case 'OL':
    case 'UL':
    case 'DL':
    case 'DD':
    case 'DT':
    case 'LI':
    case 'FORM':
      return -3;
    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
    case 'H5':
    case 'H6':
    case 'TH':
      return -5;
    default:
      return 0;
  }
}

/** Peso por class/id: +25 si coincide con el patrón positivo, -25 con el negativo. */
export function getClassWeight(el: Element): number {
  let weight = 0;
  const className = typeof el.className === 'string' ? el.className : '';
  if (className) {
    if (REGEXPS.negative.test(className)) weight -= 25;
    if (REGEXPS.positive.test(className)) weight += 25;
  }
  if (el.id) {
    if (REGEXPS.negative.test(el.id)) weight -= 25;
    if (REGEXPS.positive.test(el.id)) weight += 25;
  }
  return weight;
}
