import { describe, expect, it } from 'vitest';
import { SANS_STACK, SERIF_STACK, classifyFontFamily, contrastingStack } from '../lib/ui/fonts';

describe('classifyFontFamily', () => {
  it('reconoce las genéricas', () => {
    expect(classifyFontFamily('serif')).toBe('serif');
    expect(classifyFontFamily('sans-serif')).toBe('sans');
  });

  it('no confunde sans-serif con serif pese a contener la palabra', () => {
    expect(classifyFontFamily('sans-serif')).toBe('sans');
    expect(classifyFontFamily('ui-sans-serif, system-ui, sans-serif')).toBe('sans');
  });

  it('reconoce pilas reales con serifa', () => {
    expect(classifyFontFamily('Georgia, "Times New Roman", serif')).toBe('serif');
    expect(classifyFontFamily('"Playfair Display", Georgia, serif')).toBe('serif');
    expect(classifyFontFamily('Merriweather')).toBe('serif');
    expect(classifyFontFamily('"PT Serif", serif')).toBe('serif');
  });

  it('reconoce pilas reales sin serifa', () => {
    expect(classifyFontFamily('-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto')).toBe('sans');
    expect(classifyFontFamily('Inter, Helvetica, Arial')).toBe('sans');
    expect(classifyFontFamily('"Open Sans", sans-serif')).toBe('sans');
    expect(classifyFontFamily('system-ui')).toBe('sans');
  });

  it('trata las slab como serifa', () => {
    expect(classifyFontFamily('"Roboto Slab", serif')).toBe('serif');
  });

  it('trata las monoespaciadas como sin serifa', () => {
    expect(classifyFontFamily('"SF Mono", Menlo, monospace')).toBe('sans');
  });

  it('ignora comillas y espacios sobrantes', () => {
    expect(classifyFontFamily("  'Georgia' ,  serif ")).toBe('serif');
  });

  it('asume sans ante una familia desconocida', () => {
    // Lo predominante en la web: el resumen saldrá con serifa, que contrasta.
    expect(classifyFontFamily('MiFuenteRara')).toBe('sans');
    expect(classifyFontFamily('')).toBe('sans');
  });
});

describe('contrastingStack', () => {
  it('da serifa cuando el original no la tiene', () => {
    expect(contrastingStack('Arial, sans-serif')).toBe(SERIF_STACK);
  });

  it('da sin serifa cuando el original sí la tiene', () => {
    expect(contrastingStack('Georgia, serif')).toBe(SANS_STACK);
  });

  it('siempre devuelve la pila opuesta, nunca la misma', () => {
    for (const family of ['Georgia, serif', 'Arial, sans-serif', 'Inter', 'Merriweather']) {
      const original = classifyFontFamily(family);
      const resulting = classifyFontFamily(contrastingStack(family));
      expect(resulting).not.toBe(original);
    }
  });
});
