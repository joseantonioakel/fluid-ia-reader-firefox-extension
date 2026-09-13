import { describe, expect, it } from 'vitest';
import { GEMINI_RESPONSE_SCHEMA, JSON_SCHEMA, buildBatchPrompt } from '../lib/pipeline/prompts';
import type { ArticlePayload } from '../lib/types';

const article: ArticlePayload = {
  title: 'Título',
  fullText: 'Texto completo.',
  url: 'https://ejemplo.com/a',
  lang: 'es',
  blocks: [{ id: 0, text: 'Bloque cero.', words: 120, targetWords: 20 }],
};

describe('buildBatchPrompt y falacias', () => {
  it('con detección activa pide las falacias del texto original, con cita literal', () => {
    const prompt = buildBatchPrompt(article, article.blocks, 'proportional', 'es', true, true);
    expect(prompt).toContain('"fallacies"');
    expect(prompt).toContain('TEXTO ORIGINAL');
    expect(prompt).toContain('LITERAL');
    expect(prompt).toContain('máximo 3 por bloque');
    // El nombre y la explicación van en el idioma del resumen.
    expect(prompt).toContain('nombre de la falacia en español');
  });

  it('con detección desactivada pide la lista vacía, para que el esquema estricto siga cumpliéndose', () => {
    const prompt = buildBatchPrompt(article, article.blocks, 'proportional', 'es', true, false);
    expect(prompt).toContain('"fallacies" como lista vacía');
    expect(prompt).not.toContain('TEXTO ORIGINAL');
  });

  it('por defecto no detecta: los proveedores deben pedirlo explícitamente', () => {
    const prompt = buildBatchPrompt(article, article.blocks, 'proportional', 'es', true);
    expect(prompt).toContain('"fallacies" como lista vacía');
  });

  it('los esquemas estructurados exigen la lista de falacias en cada resumen', () => {
    expect(JSON_SCHEMA.properties.summaries.items.required).toContain('fallacies');
    expect(JSON_SCHEMA.properties.summaries.items.properties.fallacies.items.required).toEqual([
      'name',
      'quote',
      'explanation',
    ]);
    expect(GEMINI_RESPONSE_SCHEMA.properties.summaries.items.required).toContain('fallacies');
  });
});
