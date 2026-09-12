import { describe, expect, it } from 'vitest';
import { compressesEnough, countWords, targetWordsFor } from '../lib/words';
import { MAX_COMPRESSION_RATIO, SUMMARY_MAX_WORDS, SUMMARY_MIN_WORDS } from '../lib/types';

describe('countWords', () => {
  it('cuenta palabras ignorando puntuación y espacios múltiples', () => {
    expect(countWords('Hola,   mundo cruel.')).toBe(3);
  });

  it('devuelve 0 con texto vacío o solo espacios', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n\t ')).toBe(0);
  });

  it('maneja texto con acentos y signos de apertura', () => {
    expect(countWords('¿Cuántos años tenía la niña?')).toBe(5);
  });
});

describe('targetWordsFor', () => {
  it('aplica la proporción configurada', () => {
    // 400 * 0.125 = 50, dentro del rango permitido
    expect(targetWordsFor(400, 0.125)).toBe(50);
  });

  it('respeta el mínimo de 15 palabras en bloques cortos', () => {
    expect(targetWordsFor(100, 0.125)).toBe(SUMMARY_MIN_WORDS);
  });

  it('respeta el máximo de 100 palabras en bloques enormes', () => {
    expect(targetWordsFor(5000, 0.125)).toBe(SUMMARY_MAX_WORDS);
  });

  it('nunca sale del rango [15, 100] sea cual sea la entrada', () => {
    for (const words of [1, 50, 120, 800, 3000, 20000]) {
      for (const ratio of [0.05, 0.125, 0.2, 0.5]) {
        const target = targetWordsFor(words, ratio);
        expect(target).toBeGreaterThanOrEqual(SUMMARY_MIN_WORDS);
        expect(target).toBeLessThanOrEqual(SUMMARY_MAX_WORDS);
      }
    }
  });
});

describe('compressesEnough (regla de descarte del 60 %)', () => {
  it('acepta un resumen que comprime de sobra', () => {
    expect(compressesEnough(20, 200)).toBe(true);
  });

  it('rechaza un resumen que supera el 60 % del original', () => {
    expect(compressesEnough(70, 100)).toBe(false);
  });

  it('acepta justo en el límite del 60 %', () => {
    expect(compressesEnough(60, 100)).toBe(true);
    expect(MAX_COMPRESSION_RATIO).toBe(0.6);
  });

  it('descarta el caso patológico de un bloque corto con mínimo de 15 palabras', () => {
    // Un bloque de 20 palabras con resumen mínimo de 15 no comprime nada útil.
    expect(compressesEnough(15, 20)).toBe(false);
  });
});
