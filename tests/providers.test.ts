import { describe, expect, it } from 'vitest';
import { ProviderError, coerceBatchResponse, coerceFallacies, errorFromStatus, parseJsonLoose } from '../lib/providers/types';

describe('parseJsonLoose', () => {
  it('acepta JSON limpio', () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
  });

  it('acepta JSON envuelto en un bloque de código', () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('acepta JSON con texto alrededor', () => {
    expect(parseJsonLoose('Claro, aquí tienes: {"a":1} ¡espero que sirva!')).toEqual({ a: 1 });
  });

  it('falla de forma reintentable si no hay JSON', () => {
    try {
      parseJsonLoose('no soy json');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderError);
      expect((error as ProviderError).retryable).toBe(true);
    }
  });
});

describe('coerceFallacies', () => {
  it('conserva nombre, cita y explicación recortados', () => {
    expect(coerceFallacies([{ name: ' Ad hominem ', quote: ' x ', explanation: ' Ataca a la persona. ' }])).toEqual([
      { name: 'Ad hominem', quote: 'x', explanation: 'Ataca a la persona.' },
    ]);
  });

  it('descarta entradas sin nombre o sin explicación; la cita puede faltar', () => {
    expect(
      coerceFallacies([
        { name: 'Sin explicación', quote: 'x' },
        { quote: 'sin nombre', explanation: 'y' },
        { name: 'Válida', explanation: 'z' },
        'texto suelto',
        null,
      ]),
    ).toEqual([{ name: 'Válida', quote: '', explanation: 'z' }]);
  });

  it('no admite más de tres por bloque y acota la longitud de cada campo', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ name: `F${i}`, quote: 'q'.repeat(1000), explanation: 'e' }));
    const out = coerceFallacies(many);
    expect(out).toHaveLength(3);
    expect(out[0]!.quote).toHaveLength(300);
  });

  it('cualquier cosa que no sea lista da lista vacía', () => {
    expect(coerceFallacies(undefined)).toEqual([]);
    expect(coerceFallacies('ad hominem')).toEqual([]);
  });
});

describe('coerceBatchResponse', () => {
  it('adjunta las falacias al resumen solo cuando hay alguna', () => {
    const result = coerceBatchResponse({
      tldr: '',
      summaries: [
        { id: 0, summary: 'Con falacia.', fallacies: [{ name: 'Hombre de paja', quote: 'q', explanation: 'e' }] },
        { id: 1, summary: 'Sin falacia.', fallacies: [] },
      ],
    });
    expect(result.summaries[0]!.fallacies).toEqual([{ name: 'Hombre de paja', quote: 'q', explanation: 'e' }]);
    expect('fallacies' in result.summaries[1]!).toBe(false);
  });

  it('normaliza ids en texto y recorta espacios', () => {
    const result = coerceBatchResponse({
      tldr: '  La tesis.  ',
      summaries: [
        { id: '0', summary: '  Primero.  ' },
        { id: 1, summary: 'Segundo.' },
      ],
    });
    expect(result.tldr).toBe('La tesis.');
    expect(result.summaries).toEqual([
      { id: 0, summary: 'Primero.' },
      { id: 1, summary: 'Segundo.' },
    ]);
  });

  it('descarta entradas sin resumen o con id inválido', () => {
    const result = coerceBatchResponse({
      summaries: [
        { id: 0, summary: 'Válido.' },
        { id: 'abc', summary: 'Sin id numérico.' },
        { id: 2, summary: '   ' },
        null,
      ],
    });
    expect(result.summaries).toEqual([{ id: 0, summary: 'Válido.' }]);
  });

  it('trata una respuesta sin resúmenes como fallo reintentable', () => {
    try {
      coerceBatchResponse({ tldr: 'algo', summaries: [] });
      expect.unreachable();
    } catch (error) {
      expect((error as ProviderError).code).toBe('empty-response');
      expect((error as ProviderError).retryable).toBe(true);
    }
  });
});

describe('errorFromStatus', () => {
  it('clasifica 401 como credencial, no reintentable', () => {
    const error = errorFromStatus(401, 'invalid key');
    expect(error.code).toBe('unauthorized');
    expect(error.retryable).toBe(false);
  });

  it('clasifica 402 como cuota agotada', () => {
    expect(errorFromStatus(402, '').code).toBe('quota');
  });

  it('clasifica 429 como límite de tasa reintentable', () => {
    const error = errorFromStatus(429, 'slow down');
    expect(error.code).toBe('rate-limit');
    expect(error.retryable).toBe(true);
  });

  it('clasifica 5xx como fallo de red reintentable', () => {
    expect(errorFromStatus(503, '').retryable).toBe(true);
  });
});
