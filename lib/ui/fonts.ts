/**
 * El resumen se escribe con una tipografía del tipo CONTRARIO al del texto
 * original: así se distingue de un vistazo qué es resumen y qué es el texto de
 * la página, sin depender del color.
 */

export type FontKind = 'serif' | 'sans';

export const SERIF_STACK =
  "Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', 'Times New Roman', serif";

export const SANS_STACK =
  "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/** Familias con serifa que no llevan "serif" en el nombre. */
const SERIF_NAMES = [
  'times', 'georgia', 'garamond', 'palatino', 'book antiqua', 'bookman', 'cambria',
  'constantia', 'baskerville', 'didot', 'bodoni', 'caslon', 'charter', 'chaparral',
  'hoefler', 'merriweather', 'playfair', 'lora', 'crimson', 'spectral', 'tinos',
  'iowan', 'athelas', 'sitka', 'utopia', 'minion', 'newsreader', 'literata',
  'freight', 'miller', 'guardian egyptian', 'publico', 'canela', 'tiempos',
];

/** Familias sin serifa que no llevan "sans" en el nombre. */
const SANS_NAMES = [
  'arial', 'helvetica', 'roboto', 'inter', 'segoe', 'verdana', 'tahoma', 'calibri',
  'lato', 'montserrat', 'poppins', 'ubuntu', 'nunito', 'rubik', 'karla', 'manrope',
  'futura', 'avenir', 'gotham', 'proxima', 'circular', 'graphik', 'gill', 'frutiger',
  'univers', 'akzidenz', 'blinkmacsystemfont', 'system-ui', 'oxygen', 'cantarell',
];

/**
 * Clasifica un valor de `font-family` computado.
 *
 * Cuando no se reconoce ninguna familia se asume `sans`, que es lo predominante
 * en la web: el resumen saldrá entonces con serifa, que es el caso habitual.
 */
export function classifyFontFamily(fontFamily: string): FontKind {
  const tokens = fontFamily
    .split(',')
    .map((token) => token.trim().replace(/^["']|["']$/g, '').toLowerCase())
    .filter(Boolean);

  for (const token of tokens) {
    // El orden importa: "sans-serif" y "ui-sans-serif" contienen "serif".
    if (token.includes('sans')) return 'sans';
    if (token.includes('serif')) return 'serif';
    if (token.includes('slab')) return 'serif';
    if (token.includes('mono')) return 'sans';
    if (SERIF_NAMES.some((name) => token.includes(name))) return 'serif';
    if (SANS_NAMES.some((name) => token.includes(name))) return 'sans';
  }

  return 'sans';
}

/** Devuelve la pila tipográfica opuesta a la del texto original. */
export function contrastingStack(fontFamily: string): string {
  return classifyFontFamily(fontFamily) === 'serif' ? SANS_STACK : SERIF_STACK;
}
