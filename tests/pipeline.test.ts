import { describe, expect, it } from 'vitest';
import { planBatches } from '../lib/pipeline';
import { configFingerprint, normalizeUrl } from '../lib/cache';
import { DEFAULT_CONFIG } from '../lib/config';
import type { BlockPayload } from '../lib/types';

function blocks(count: number, targetWords = 40): BlockPayload[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    text: `bloque ${i}`,
    words: targetWords * 8,
    targetWords,
  }));
}

describe('planBatches', () => {
  it('con batchSize null hace UNA sola llamada', () => {
    const plan = planBatches(blocks(25), null, 25_000);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toHaveLength(25);
  });

  it('respeta un batchSize explícito', () => {
    const plan = planBatches(blocks(20), 8, 25_000);
    expect(plan.map((c) => c.length)).toEqual([8, 8, 4]);
  });

  it('divide automáticamente si la salida estimada excede el presupuesto', () => {
    // 100 bloques x 100 palabras objetivo ≈ 16.000 tokens: por encima de un presupuesto de 2.000.
    const plan = planBatches(blocks(100, 100), null, 2000);
    expect(plan.length).toBeGreaterThan(1);
    // Ningún lote debe seguir excediendo el presupuesto (salvo bloques sueltos).
    for (const chunk of plan) {
      if (chunk.length > 1) {
        const estimated = chunk.reduce((sum, b) => sum + b.targetWords, 0) * 1.6 + 200;
        expect(estimated).toBeLessThanOrEqual(2000);
      }
    }
    // No se pierde ni se duplica ningún bloque.
    expect(plan.flat().map((b) => b.id)).toEqual(blocks(100, 100).map((b) => b.id));
  });

  it('devuelve vacío sin bloques', () => {
    expect(planBatches([], null, 25_000)).toEqual([]);
  });
});

describe('normalizeUrl', () => {
  it('elimina el fragmento y los parámetros de tracking', () => {
    const normalized = normalizeUrl('https://ejemplo.com/post?utm_source=x&id=7&fbclid=abc#seccion');
    expect(normalized).toBe('https://ejemplo.com/post?id=7');
  });

  it('deja intacta una URL limpia', () => {
    expect(normalizeUrl('https://ejemplo.com/post')).toBe('https://ejemplo.com/post');
  });
});

describe('configFingerprint', () => {
  it('cambia al cambiar el formato de resumen', () => {
    const a = configFingerprint(DEFAULT_CONFIG, 'gemini-free', 'm', 'es');
    const b = configFingerprint({ ...DEFAULT_CONFIG, summaryFormat: 'bullets' }, 'gemini-free', 'm', 'es');
    expect(a).not.toBe(b);
  });

  it('cambia al cambiar la proporción, el idioma, el proveedor o el modelo', () => {
    const base = configFingerprint(DEFAULT_CONFIG, 'gemini-free', 'm', 'es');
    expect(configFingerprint({ ...DEFAULT_CONFIG, summaryRatio: 0.2 }, 'gemini-free', 'm', 'es')).not.toBe(base);
    expect(configFingerprint(DEFAULT_CONFIG, 'gemini-free', 'm', 'en')).not.toBe(base);
    expect(configFingerprint(DEFAULT_CONFIG, 'openrouter', 'm', 'es')).not.toBe(base);
    expect(configFingerprint(DEFAULT_CONFIG, 'gemini-free', 'otro', 'es')).not.toBe(base);
  });

  it('cambia al activar o desactivar la detección de falacias', () => {
    const on = configFingerprint({ ...DEFAULT_CONFIG, detectFallacies: true }, 'gemini-free', 'm', 'es');
    const off = configFingerprint({ ...DEFAULT_CONFIG, detectFallacies: false }, 'gemini-free', 'm', 'es');
    expect(on).not.toBe(off);
  });

  it('es estable si nada relevante cambia', () => {
    const a = configFingerprint(DEFAULT_CONFIG, 'gemini-free', 'm', 'es');
    const b = configFingerprint({ ...DEFAULT_CONFIG, minWords: 250 }, 'gemini-free', 'm', 'es');
    expect(a).toBe(b);
  });
});
