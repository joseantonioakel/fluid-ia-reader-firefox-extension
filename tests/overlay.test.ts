import { beforeEach, describe, expect, it } from 'vitest';
import { BASE_SCALE, BlockOverlay, lineHeightRatio, overlayPadding } from '../lib/ui/overlay';
import type { Theme } from '../lib/ui/theme';

const theme: Theme = {
  bg: '#fff',
  fg: '#000',
  bar: '#fff',
  border: '#ddd',
  hover: '#eee',
  link: '#00f',
  accent: '#2f6bff',
  dark: false,
  overlayBg: 'rgb(243, 250, 253)',
};

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('lineHeightRatio', () => {
  it('convierte un interlineado en px a factor del cuerpo', () => {
    expect(lineHeightRatio('27px', '18px')).toBe(1.5);
    expect(lineHeightRatio('20px', '16px')).toBe(1.25);
  });

  it('acepta un factor numérico tal cual', () => {
    expect(lineHeightRatio('1.3', '16px')).toBe(1.3);
  });

  it('normal y valores inválidos caen en un factor razonable', () => {
    expect(lineHeightRatio('normal', '16px')).toBe(1.4);
    expect(lineHeightRatio('', '16px')).toBe(1.4);
    expect(lineHeightRatio('abc', '16px')).toBe(1.4);
  });

  it('acota los interlineados muy holgados o muy apretados', () => {
    // 2.0 desperdiciaría media caja; 1.0 apelmaza el texto.
    expect(lineHeightRatio('32px', '16px')).toBe(1.5);
    expect(lineHeightRatio('1', '16px')).toBe(1.2);
  });
});

describe('overlayPadding', () => {
  it('respeta el relleno del párrafo y deja hueco a la barra de acento', () => {
    expect(
      overlayPadding({ paddingTop: '12px', paddingRight: '16px', paddingBottom: '12px', paddingLeft: '16px' }),
    ).toBe('12px 16px 12px 26px');
  });

  it('un párrafo sin relleno recibe un mínimo para que el texto no toque el borde', () => {
    expect(overlayPadding({ paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px' })).toBe(
      '4px 8px 4px 10px',
    );
  });
});

describe('BlockOverlay', () => {
  function paragraph(id: string): HTMLElement {
    const p = document.createElement('p');
    p.id = id;
    p.textContent = 'Texto original del párrafo.';
    document.body.appendChild(p);
    return p;
  }

  it('el host va fuera de flujo para no alterar la última línea del párrafo', () => {
    const p = paragraph('a');
    new BlockOverlay(0, [p], theme, { onRetry: () => undefined });
    const host = p.querySelector<HTMLElement>('[data-lector-fluido]')!;
    expect(host.style.getPropertyValue('position')).toBe('absolute');
    expect(host.style.getPropertyValue('inset')).toBe('0');
    expect(p.style.position).toBe('relative');
  });

  it('al ocultarse el host se encoge a la esquina y no cubre el texto', () => {
    const p = paragraph('a');
    const overlay = new BlockOverlay(0, [p], theme, { onRetry: () => undefined });
    overlay.setHidden(true);
    const host = p.querySelector<HTMLElement>('[data-lector-fluido]')!;
    expect(host.style.getPropertyValue('inset')).toBe('');
    expect(Number.parseFloat(host.style.getPropertyValue('top'))).toBe(0);
    expect(Number.parseFloat(host.style.getPropertyValue('right'))).toBe(0);
    overlay.setHidden(false);
    expect(host.style.getPropertyValue('inset')).toBe('0');
  });

  it('parte de un cuerpo algo menor que el del original', () => {
    const p = paragraph('a');
    const overlay = new BlockOverlay(0, [p], theme, { onRetry: () => undefined });
    overlay.setSummary('Resumen breve.', 'text');
    // jsdom no calcula layout, así que nunca hay desbordamiento: se queda en la base.
    expect(overlay.getScale()).toBe(BASE_SCALE);
    expect(BASE_SCALE).toBeLessThan(1);
  });

  it('destruir el overlay deja el párrafo como estaba', () => {
    const p = paragraph('a');
    const overlay = new BlockOverlay(0, [p], theme, { onRetry: () => undefined });
    overlay.destroy();
    expect(p.querySelector('[data-lector-fluido]')).toBeNull();
    expect(p.getAttribute('style')).toBeNull();
  });
});
