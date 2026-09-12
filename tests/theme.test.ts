import { describe, expect, it } from 'vitest';
import { tintWithCeleste } from '../lib/ui/theme';

function parse(color: string): [number, number, number] {
  const match = color.match(/rgb\((\d+), (\d+), (\d+)\)/);
  if (!match) throw new Error(`color inesperado: ${color}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

describe('tintWithCeleste', () => {
  it('sobre blanco da un blanco azulado, no un blanco puro', () => {
    const [r, g, b] = parse(tintWithCeleste([255, 255, 255]));
    expect(b).toBeGreaterThan(r); // el azul domina levemente
    expect(r).toBeLessThan(255);
    expect(r).toBeGreaterThan(230); // sigue siendo claramente claro
  });

  it('sobre negro da un negro azulado, no un negro puro', () => {
    const [r, g, b] = parse(tintWithCeleste([0, 0, 0]));
    expect(b).toBeGreaterThan(r);
    expect(r).toBeGreaterThan(0);
    expect(b).toBeLessThan(40); // sigue siendo claramente oscuro
  });

  it('aplica exactamente un 10 % del celeste de referencia', () => {
    // celeste = (135, 206, 235); base negra → 10 % puro del tinte
    expect(parse(tintWithCeleste([0, 0, 0]))).toEqual([14, 21, 24]);
    // base blanca → 90 % de blanco + 10 % de celeste
    expect(parse(tintWithCeleste([255, 255, 255]))).toEqual([243, 250, 253]);
  });

  it('respeta fondos que no son ni blancos ni negros', () => {
    // Un fondo crema conserva su carácter cálido, solo se enfría un poco.
    const [r, g, b] = parse(tintWithCeleste([250, 245, 230]));
    expect(r).toBeGreaterThan(230);
    expect(b).toBeGreaterThan(230);
    expect(r).toBeLessThan(250);
  });

  it('permite ajustar la proporción', () => {
    expect(parse(tintWithCeleste([0, 0, 0], 0))).toEqual([0, 0, 0]);
    expect(parse(tintWithCeleste([0, 0, 0], 1))).toEqual([135, 206, 235]);
  });
});
