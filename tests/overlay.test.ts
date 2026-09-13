import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BASE_SCALE, BlockOverlay, lineHeightRatio, overlayPadding } from '../lib/ui/overlay';
import type { Fallacy } from '../lib/types';
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

describe('BlockOverlay · falacias', () => {
  const fallacy: Fallacy = {
    kind: 'false-dilemma',
    name: 'Falso dilema',
    quote: 'O estás con nosotros o contra nosotros.',
    explanation: 'Presenta solo dos opciones cuando existen más.',
  };

  /** El Shadow DOM es cerrado: para inspeccionarlo, la prueba lo abre al crearlo. */
  let shadow: ShadowRoot;
  beforeEach(() => {
    const original = Element.prototype.attachShadow;
    vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element) {
      shadow = original.call(this, { mode: 'open' });
      return shadow;
    });
  });

  function overlayWith(fallacies = [fallacy]): BlockOverlay {
    const p = document.createElement('p');
    p.textContent = 'Texto.';
    document.body.appendChild(p);
    const overlay = new BlockOverlay(0, [p], theme, { onRetry: () => undefined });
    overlay.setSummary('Resumen.', 'text', fallacies);
    return overlay;
  }

  it('pinta un emblema por falacia, con el nombre accesible', () => {
    overlayWith([fallacy, { ...fallacy, kind: 'ad-hominem', name: 'Ad hominem' }]);
    const badges = shadow.querySelectorAll('.badge');
    expect(badges).toHaveLength(2);
    expect(badges[0]!.getAttribute('aria-label')).toBe('Falacia lógica: Falso dilema');
    expect(badges[1]!.getAttribute('title')).toBe('Ad hominem');
  });

  it('cada tipo de falacia lleva su propio icono; el tipo desconocido lleva el genérico', () => {
    overlayWith([
      fallacy,
      { ...fallacy, kind: 'ad-hominem' },
      { ...fallacy, kind: 'red-herring' },
      { ...fallacy, kind: 'other' },
    ]);
    const icons = Array.from(shadow.querySelectorAll('.badge'), (b) => b.textContent);
    expect(icons).toEqual(['⚖️', '👤', '🐟', '⚠']);
    expect(new Set(icons).size).toBe(4);
    expect(shadow.querySelectorAll('.badge')[2]!.getAttribute('data-kind')).toBe('red-herring');
  });

  it('el popover repite el icono del tipo junto al nombre', () => {
    overlayWith([{ ...fallacy, kind: 'slippery-slope', name: 'Pendiente resbaladiza' }]);
    shadow.querySelector('.badge')!.dispatchEvent(new Event('mouseenter'));
    expect(shadow.querySelector('.pop h4')!.textContent).toContain('🎿 Pendiente resbaladiza');
  });

  it('sin falacias no hay emblemas', () => {
    overlayWith([]);
    expect(shadow.querySelectorAll('.badge')).toHaveLength(0);
  });

  it('al pasar el ratón muestra el popover con nombre, cita y explicación', () => {
    const overlay = overlayWith();
    shadow.querySelector('.badge')!.dispatchEvent(new Event('mouseenter'));
    const pop = shadow.querySelector('.pop')!;
    expect(overlay.isPopoverOpen()).toBe(true);
    expect(pop.querySelector('h4')!.textContent).toContain('Falso dilema');
    expect(pop.querySelector('blockquote')!.textContent).toContain('O estás con nosotros o contra nosotros.');
    expect(pop.textContent).toContain('Presenta solo dos opciones cuando existen más.');
    expect(shadow.querySelector('.badge')!.getAttribute('aria-expanded')).toBe('true');
  });

  it('al salir del emblema el popover se cierra tras un pequeño margen', () => {
    vi.useFakeTimers();
    const overlay = overlayWith();
    const badge = shadow.querySelector('.badge')!;
    badge.dispatchEvent(new Event('mouseenter'));
    badge.dispatchEvent(new Event('mouseleave'));
    expect(overlay.isPopoverOpen()).toBe(true);
    vi.advanceTimersByTime(200);
    expect(overlay.isPopoverOpen()).toBe(false);
    vi.useRealTimers();
  });

  it('un clic fija el popover: sobrevive al mouseleave y se cierra con otro clic', () => {
    vi.useFakeTimers();
    const overlay = overlayWith();
    const badge = shadow.querySelector('.badge')!;
    badge.dispatchEvent(new MouseEvent('click'));
    badge.dispatchEvent(new Event('mouseleave'));
    vi.advanceTimersByTime(500);
    expect(overlay.isPopoverOpen()).toBe(true);
    badge.dispatchEvent(new MouseEvent('click'));
    expect(overlay.isPopoverOpen()).toBe(false);
    vi.useRealTimers();
  });

  it('Escape cierra el popover', () => {
    const overlay = overlayWith();
    shadow.querySelector('.badge')!.dispatchEvent(new Event('mouseenter'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(overlay.isPopoverOpen()).toBe(false);
  });

  it('ocultar el overlay o reintentar el bloque cierra el popover y retira los emblemas', () => {
    const overlay = overlayWith();
    shadow.querySelector('.badge')!.dispatchEvent(new Event('mouseenter'));
    overlay.setHidden(true);
    expect(overlay.isPopoverOpen()).toBe(false);
    overlay.setHidden(false);
    overlay.setLoading();
    expect(shadow.querySelectorAll('.badge')).toHaveLength(0);
  });

  it('el popover es hermano de la caja, no hijo: la caja recorta y el popover debe sobresalir', () => {
    overlayWith();
    shadow.querySelector('.badge')!.dispatchEvent(new Event('mouseenter'));
    const pop = shadow.querySelector('.pop')!;
    expect(pop.parentNode).toBe(shadow);
    expect(shadow.querySelector('.box')!.contains(pop)).toBe(false);
  });
});
