import { MAX_COMPRESSION_RATIO, SUMMARY_MAX_WORDS, SUMMARY_MIN_WORDS } from './types';

let segmenter: Intl.Segmenter | null | undefined;

function getSegmenter(locale?: string): Intl.Segmenter | null {
  if (segmenter !== undefined) return segmenter;
  try {
    segmenter = new Intl.Segmenter(locale, { granularity: 'word' });
  } catch {
    segmenter = null;
  }
  return segmenter;
}

/** Conteo de palabras consciente del idioma, con fallback a división por espacios. */
export function countWords(text: string, locale?: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const seg = getSegmenter(locale);
  if (!seg) return trimmed.split(/\s+/).filter(Boolean).length;
  let count = 0;
  for (const { isWordLike } of seg.segment(trimmed)) {
    if (isWordLike) count += 1;
  }
  return count;
}

/**
 * Longitud objetivo del resumen: clamp(W * ratio, 15, 100).
 */
export function targetWordsFor(blockWords: number, ratio: number): number {
  const raw = Math.round(blockWords * ratio);
  return Math.min(SUMMARY_MAX_WORDS, Math.max(SUMMARY_MIN_WORDS, raw));
}

/**
 * Regla de descarte: si el resumen no comprime lo suficiente, el bloque
 * no recibe overlay y el texto original queda intacto.
 */
export function compressesEnough(summaryWords: number, blockWords: number): boolean {
  return summaryWords <= blockWords * MAX_COMPRESSION_RATIO;
}
