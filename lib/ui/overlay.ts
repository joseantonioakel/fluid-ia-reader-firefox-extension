import { t } from '../i18n';
import { contrastingStack } from './fonts';
import type { Theme } from './theme';

/**
 * El resumen arranca con un cuerpo algo menor que el del original: cabe mejor
 * y refuerza, junto con la tipografía contraria, que es texto de la extensión.
 */
export const BASE_SCALE = 0.92;
/** Por debajo de esto el texto deja de leerse bien: antes que eso, scroll. */
export const MIN_SCALE = 0.6;
const SCALE_STEP = 0.04;
/** Interlineado copiado de la página, pero acotado: uno muy holgado desperdicia la caja. */
const LINE_HEIGHT_RANGE: readonly [number, number] = [1.2, 1.5];

const OVERLAY_CSS = `
:host { all: initial; }
.box {
  position: absolute;
  inset: 0;
  box-sizing: border-box;
  overflow: hidden;
  padding: var(--lf-pad);
  background: var(--lf-bg);
  color: var(--lf-fg);
  border-radius: 4px;
  /* Tres capas: la barra de acento (sin ocupar sitio), un halo del propio fondo
     que tapa las esquinas que el radio dejaría al descubierto, y una sombra suave. */
  box-shadow: inset 3px 0 0 var(--lf-accent), 0 0 0 2px var(--lf-bg), 0 1px 3px rgba(0,0,0,0.10);
  /* El host lleva all:initial, así que inherit NO traería la tipografía de la
     página: hay que pasar familia, tamaño e interlineado explícitamente. */
  font-family: var(--lf-font);
  font-size: calc(var(--lf-size) * var(--lf-scale));
  line-height: var(--lf-line);
  text-align: var(--lf-align);
  direction: var(--lf-dir);
  hyphens: auto;
  overflow-wrap: break-word;
  animation: lf-in 140ms ease-out;
}
.box.scroll { overflow-y: auto; overscroll-behavior: contain; }
@media (prefers-reduced-motion: reduce) { .box { animation: none; } }
@keyframes lf-in { from { opacity: 0; } to { opacity: 1; } }
/* La cabecera flota para que el texto aproveche toda la caja y fluya alrededor. */
.head {
  float: right;
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0 0 2px 8px;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 10px;
  line-height: 1;
  color: var(--lf-muted);
  direction: ltr;
}
.tag {
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-right: 2px;
}
button {
  font: inherit;
  line-height: 1;
  cursor: pointer;
  border: 1px solid var(--lf-border);
  background: transparent;
  color: inherit;
  border-radius: 4px;
  padding: 2px 4px;
}
button:hover { background: var(--lf-hover); }
button:focus-visible { outline: 2px solid var(--lf-accent); outline-offset: 1px; }
.body { display: block; }
.body ul { margin: 0; padding-left: 1.1em; }
.error { color: var(--lf-error); font-family: system-ui, sans-serif; font-size: 13px; }
.skeleton { display: flex; flex-direction: column; gap: 8px; padding-top: 4px; }
.skeleton i {
  display: block;
  height: 0.7em;
  border-radius: 4px;
  background: linear-gradient(90deg, var(--lf-hover) 25%, var(--lf-border) 50%, var(--lf-hover) 75%);
  background-size: 200% 100%;
  animation: lf-shimmer 1.4s ease-in-out infinite;
}
.skeleton i:last-child { width: 55%; }
@media (prefers-reduced-motion: reduce) { .skeleton i { animation: none; } }
@keyframes lf-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
@media print { :host { display: none !important; } }
`;

export type OverlayState = 'loading' | 'ready' | 'error';

export interface OverlayCallbacks {
  onRetry(id: number): void;
}

/**
 * Interlineado como factor del cuerpo. La página puede declararlo en px, como
 * número o como `normal`; al pasarlo a factor, reducir el cuerpo reduce también
 * el interlineado y el texto encoge de forma proporcional.
 */
export function lineHeightRatio(lineHeight: string, fontSize: string): number {
  const size = Number.parseFloat(fontSize);
  let ratio: number;
  if (lineHeight === 'normal' || !lineHeight) ratio = 1.4;
  else if (lineHeight.endsWith('px') && size > 0) ratio = Number.parseFloat(lineHeight) / size;
  else ratio = Number.parseFloat(lineHeight);
  if (!Number.isFinite(ratio) || ratio <= 0) ratio = 1.4;
  return Math.min(LINE_HEIGHT_RANGE[1], Math.max(LINE_HEIGHT_RANGE[0], ratio));
}

/**
 * Relleno de la caja a partir del del párrafo: si el original lleva padding, el
 * resumen respeta el mismo margen interior y el texto arranca alineado con él.
 * A la izquierda se suma el hueco de la barra de acento.
 */
export function overlayPadding(computed: {
  paddingTop: string;
  paddingRight: string;
  paddingBottom: string;
  paddingLeft: string;
}): string {
  const px = (value: string, min: number): number => {
    const n = Number.parseFloat(value);
    return Math.max(min, Number.isFinite(n) ? n : 0);
  };
  const top = px(computed.paddingTop, 4);
  const right = px(computed.paddingRight, 8);
  const bottom = px(computed.paddingBottom, 4);
  const left = px(computed.paddingLeft, 0) + 10;
  return `${top}px ${right}px ${bottom}px ${left}px`;
}

/**
 * Overlay anclado a un bloque. Ocupa exactamente la caja del párrafo, de modo que
 * el layout del documento no se desplaza al aparecer, ocultarse o restaurarse.
 * El cuerpo del texto se reduce lo justo para que el resumen quepa siempre.
 */
export class BlockOverlay {
  readonly id: number;
  readonly block: HTMLElement;
  private elements: HTMLElement[];

  private host: HTMLElement;
  private shadow: ShadowRoot;
  private box!: HTMLElement;
  private bodyEl!: HTMLElement;
  private eyeBtn!: HTMLButtonElement;
  private retryBtn!: HTMLButtonElement;
  private tagEl!: HTMLElement;
  private previousPosition: string | null = null;
  private hidden = false;
  private state: OverlayState = 'loading';
  private scale = BASE_SCALE;
  private resizeObserver: ResizeObserver | null = null;

  constructor(id: number, elements: HTMLElement[], theme: Theme, private callbacks: OverlayCallbacks) {
    this.id = id;
    this.elements = elements;
    const anchor = elements[0]!;
    this.block = anchor;

    // El overlay se posiciona respecto al primer elemento del grupo: así no hay
    // que recalcular nada en cada scroll.
    const computed = getComputedStyle(anchor);
    if (!computed.position || computed.position === 'static') {
      this.previousPosition = anchor.style.position;
      anchor.style.position = 'relative';
    }

    // <span> como host: válido dentro de <p> y de cualquier bloque en línea. Va
    // posicionado en absoluto: un span vacío en flujo tiene altura de línea
    // propia y podía estirar la última línea del párrafo.
    this.host = document.createElement('span');
    this.host.setAttribute('data-lector-fluido', String(id));
    this.shadow = this.host.attachShadow({ mode: 'closed' });
    this.render(theme, computed);
    this.applyHostStyle();
    anchor.appendChild(this.host);

    this.track();
  }

  private render(theme: Theme, computed: CSSStyleDeclaration): void {
    const style = document.createElement('style');
    style.textContent = OVERLAY_CSS;

    this.box = document.createElement('div');
    this.box.className = 'box';
    this.box.setAttribute('role', 'region');
    this.box.setAttribute('aria-label', t('overlayRegion'));
    // Fondo de la página teñido con un 10 % de celeste: opaco, para tapar el
    // texto original, pero reconocible como "esto lo ha puesto la extensión".
    this.box.style.setProperty('--lf-bg', theme.overlayBg);
    this.box.style.setProperty('--lf-fg', theme.fg);
    this.box.style.setProperty('--lf-border', theme.border);
    this.box.style.setProperty('--lf-hover', theme.hover);
    this.box.style.setProperty('--lf-accent', theme.accent);
    this.box.style.setProperty('--lf-muted', theme.dark ? '#9aa2b1' : '#6b7280');
    this.box.style.setProperty('--lf-error', theme.dark ? '#ff8f8f' : '#b42318');
    // Tipografía del tipo contrario a la del original, partiendo del mismo cuerpo.
    this.box.style.setProperty('--lf-font', contrastingStack(computed.fontFamily));
    this.box.style.setProperty('--lf-size', computed.fontSize || '16px');
    this.box.style.setProperty('--lf-line', String(lineHeightRatio(computed.lineHeight, computed.fontSize)));
    this.box.style.setProperty('--lf-scale', String(this.scale));
    this.box.style.setProperty('--lf-pad', overlayPadding(computed));
    // Alineación y dirección del original, para que el resumen "calce" en la caja.
    this.box.style.setProperty('--lf-align', computed.textAlign || 'start');
    this.box.style.setProperty('--lf-dir', computed.direction || 'ltr');

    const head = document.createElement('div');
    head.className = 'head';

    this.tagEl = document.createElement('span');
    this.tagEl.className = 'tag';
    this.tagEl.textContent = t('overlayTagSummary');

    this.retryBtn = document.createElement('button');
    this.retryBtn.type = 'button';
    this.retryBtn.textContent = '🔄';
    this.retryBtn.title = t('overlayRetry');
    this.retryBtn.hidden = true;
    this.retryBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onRetry(this.id);
    });

    this.eyeBtn = document.createElement('button');
    this.eyeBtn.type = 'button';
    this.eyeBtn.textContent = '👁';
    this.eyeBtn.title = t('overlayShowOriginal');
    this.eyeBtn.setAttribute('aria-pressed', 'false');
    this.eyeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });

    head.append(this.tagEl, this.retryBtn, this.eyeBtn);

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'body';
    this.setSkeleton();

    this.box.append(head, this.bodyEl);
    this.shadow.append(style, this.box);
  }

  /**
   * Estilos del host. Van en línea y con !important porque la página puede
   * tener reglas para `p > span` que de otro modo lo desplazarían.
   */
  private applyHostStyle(): void {
    this.host.removeAttribute('style');
    const set = (prop: string, value: string) => this.host.style.setProperty(prop, value, 'important');
    set('all', 'initial');
    set('position', 'absolute');
    set('display', 'block');
    set('z-index', '2147483000');
    if (this.hidden) {
      // Oculto: el host se encoge a la esquina para no interceptar clics ni
      // selección sobre el texto original; solo queda el botón para volver.
      set('top', '0');
      set('right', '0');
      return;
    }
    set('inset', '0');
    if (this.elements.length > 1) this.applySpan();
  }

  /**
   * Cuando el layout cambie (ventana redimensionada, fuentes cargadas, un
   * párrafo del grupo que crece), la caja se recoloca y el texto se reajusta.
   */
  private track(): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => {
      if (this.hidden) return;
      if (this.elements.length > 1) this.applySpan();
      this.fit();
    });
    for (const element of this.elements) this.resizeObserver.observe(element);
  }

  /**
   * Un bloque fusionado abarca varios elementos hermanos. El overlay se ancla al
   * primero, así que su caja debe cubrir la unión de todos: hasta el final del
   * último, y tan ancha como el más ancho, aunque un hermano sobresalga.
   */
  private applySpan(): void {
    const anchor = this.block.getBoundingClientRect();
    // El origen de las coordenadas absolutas es el borde del padding box del
    // ancla, no el de su border box: se descuenta el borde.
    const originX = anchor.left + this.block.clientLeft;
    const originY = anchor.top + this.block.clientTop;

    let left = Number.POSITIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    for (const element of this.elements) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      left = Math.min(left, rect.left);
      top = Math.min(top, rect.top);
      right = Math.max(right, rect.right);
      bottom = Math.max(bottom, rect.bottom);
    }
    if (!Number.isFinite(left) || bottom - top <= 0 || right - left <= 0) return;

    const set = (prop: string, value: string) => this.host.style.setProperty(prop, value, 'important');
    set('top', `${top - originY}px`);
    set('left', `${left - originX}px`);
    set('width', `${right - left}px`);
    set('height', `${bottom - top}px`);
    set('right', 'auto');
    set('bottom', 'auto');
  }

  private setScale(scale: number): void {
    this.scale = scale;
    this.box.style.setProperty('--lf-scale', String(scale));
  }

  /**
   * Reduce el cuerpo del texto hasta que el resumen quepa en la caja del
   * párrafo. La primera aproximación es analítica (el área que ocupa un texto
   * crece con el cuadrado del cuerpo) y luego se afina en pasos pequeños. Si ni
   * con el mínimo legible cabe, la caja pasa a tener scroll.
   */
  fit(): void {
    if (this.hidden || !this.host.isConnected) return;
    const overflow = (): number => this.box.scrollHeight - this.box.clientHeight;

    this.box.classList.remove('scroll');
    this.setScale(BASE_SCALE);
    if (this.box.clientHeight === 0 || overflow() <= 0) return;

    let scale = Math.max(MIN_SCALE, BASE_SCALE * Math.sqrt(this.box.clientHeight / this.box.scrollHeight));
    this.setScale(scale);
    while (overflow() > 0 && scale > MIN_SCALE) {
      scale = Math.max(MIN_SCALE, scale - SCALE_STEP);
      this.setScale(scale);
    }
    if (overflow() > 0) this.box.classList.add('scroll');
  }

  private setSkeleton(): void {
    const wrap = document.createElement('div');
    wrap.className = 'skeleton';
    for (let i = 0; i < 3; i += 1) wrap.appendChild(document.createElement('i'));
    this.bodyEl.replaceChildren(wrap);
  }

  setSummary(summary: string, format: 'bullets' | 'text'): void {
    this.state = 'ready';
    this.retryBtn.hidden = true;
    this.tagEl.textContent = t('overlayTagSummary');
    if (format === 'bullets') {
      const ul = document.createElement('ul');
      for (const line of summary.split('\n')) {
        const clean = line.replace(/^\s*[-*•]\s*/, '').trim();
        if (!clean) continue;
        const li = document.createElement('li');
        li.textContent = clean;
        ul.appendChild(li);
      }
      this.bodyEl.replaceChildren(ul.childElementCount ? ul : document.createTextNode(summary));
    } else {
      this.bodyEl.replaceChildren(document.createTextNode(summary));
    }
    this.fit();
  }

  setError(message: string): void {
    this.state = 'error';
    this.tagEl.textContent = t('overlayTagError');
    this.retryBtn.hidden = false;
    const p = document.createElement('div');
    p.className = 'error';
    p.textContent = message;
    this.bodyEl.replaceChildren(p);
    this.fit();
  }

  setLoading(): void {
    this.state = 'loading';
    this.tagEl.textContent = t('overlayTagSummary');
    this.retryBtn.hidden = true;
    this.setSkeleton();
    this.fit();
  }

  /** Marca visual cuando el resumen vino del proveedor de respaldo. */
  markFallback(providerName: string): void {
    this.tagEl.textContent = t('overlayTagFallback', providerName);
    this.fit();
  }

  toggle(): void {
    this.setHidden(!this.hidden);
  }

  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.box.style.display = hidden ? 'none' : '';
    this.eyeBtn.setAttribute('aria-pressed', String(hidden));
    this.applyHostStyle();
    if (hidden) {
      // Cuando el overlay se oculta, el botón debe seguir accesible para restaurarlo.
      this.shadow.appendChild(this.floatingEye());
    } else {
      this.shadow.querySelector('.peek')?.remove();
      this.fit();
    }
  }

  private floatingEye(): HTMLElement {
    const existing = this.shadow.querySelector('.peek');
    if (existing) return existing as HTMLElement;
    const btn = document.createElement('button');
    btn.className = 'peek';
    btn.type = 'button';
    btn.textContent = '👁';
    btn.title = t('overlayBackToSummary');
    btn.style.cssText =
      'position:absolute;top:2px;right:2px;font-size:12px;line-height:1;padding:2px 5px;' +
      'border-radius:5px;cursor:pointer;opacity:0.55;border:1px solid transparent;background:transparent;';
    btn.addEventListener('mouseenter', () => (btn.style.opacity = '1'));
    btn.addEventListener('mouseleave', () => (btn.style.opacity = '0.55'));
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });
    return btn;
  }

  isHidden(): boolean {
    return this.hidden;
  }

  getState(): OverlayState {
    return this.state;
  }

  /** Factor aplicado al cuerpo del original tras el último ajuste. */
  getScale(): number {
    return this.scale;
  }

  /** ¿Siguen vivos en el documento todos los elementos del bloque? */
  isConnected(): boolean {
    return this.elements.every((element) => element.isConnected);
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.host.remove();
    if (this.previousPosition !== null) {
      this.block.style.position = this.previousPosition;
      if (!this.block.getAttribute('style')) this.block.removeAttribute('style');
    }
  }
}
