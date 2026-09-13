import { fallacyIcon } from '../fallacies';
import { t } from '../i18n';
import type { Fallacy } from '../types';
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
/* Emblemas de falacia: uno por falacia, delante de la etiqueta. */
.badges { display: inline-flex; gap: 3px; }
.badges:empty { display: none; }
.badge {
  font: inherit;
  font-size: 11px;
  line-height: 1;
  padding: 1px 4px;
  border-radius: 4px;
  border: 1px solid var(--lf-warn);
  color: var(--lf-warn);
  background: transparent;
  cursor: help;
}
.badge:hover, .badge[aria-expanded="true"] { background: var(--lf-warn-bg); }
.badge:focus-visible { outline: 2px solid var(--lf-warn); outline-offset: 1px; }
/* El popover es hermano de .box (que recorta con overflow) y cuelga del host,
   así que puede sobresalir de la caja del párrafo. */
.pop {
  position: absolute;
  z-index: 2147483001;
  box-sizing: border-box;
  width: max-content;
  max-width: min(380px, 100%);
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--lf-border);
  background: var(--lf-bg);
  color: var(--lf-fg);
  box-shadow: 0 8px 28px rgba(0,0,0,0.22);
  font: 13px/1.45 system-ui, -apple-system, sans-serif;
  text-align: left;
  direction: ltr;
  hyphens: none;
}
.pop h4 { display: flex; align-items: center; gap: 6px; margin: 0 0 4px; font-size: 13px; font-weight: 600; }
.pop h4 .kind { font-weight: 500; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--lf-muted); }
.pop h4 button { margin-left: auto; }
.pop dl { margin: 0; }
.pop dt { margin-top: 6px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--lf-muted); }
.pop dd { margin: 2px 0 0; }
.pop blockquote { margin: 0; padding-left: 8px; border-left: 2px solid var(--lf-warn); font-style: italic; }
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
  private theme: Theme;
  private badgesEl!: HTMLElement;
  private popEl: HTMLElement | null = null;
  private popFor: Fallacy | null = null;
  private pinned = false;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(id: number, elements: HTMLElement[], theme: Theme, private callbacks: OverlayCallbacks) {
    this.id = id;
    this.elements = elements;
    this.theme = theme;
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
    this.applyThemeVars(this.box);
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

    this.badgesEl = document.createElement('span');
    this.badgesEl.className = 'badges';

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

    head.append(this.badgesEl, this.tagEl, this.retryBtn, this.eyeBtn);

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'body';
    this.setSkeleton();

    this.box.append(head, this.bodyEl);
    this.shadow.append(style, this.box);
  }

  /**
   * Variables de tema. Van en cada raíz visual (caja y popover) porque el host
   * lleva `all: initial` y no conviene depender de la herencia a través de él.
   */
  private applyThemeVars(element: HTMLElement): void {
    const theme = this.theme;
    // Fondo de la página teñido con un 10 % de celeste: opaco, para tapar el
    // texto original, pero reconocible como "esto lo ha puesto la extensión".
    element.style.setProperty('--lf-bg', theme.overlayBg);
    element.style.setProperty('--lf-fg', theme.fg);
    element.style.setProperty('--lf-border', theme.border);
    element.style.setProperty('--lf-hover', theme.hover);
    element.style.setProperty('--lf-accent', theme.accent);
    element.style.setProperty('--lf-muted', theme.dark ? '#9aa2b1' : '#6b7280');
    element.style.setProperty('--lf-error', theme.dark ? '#ff8f8f' : '#b42318');
    // Ámbar para las falacias: distinto del acento (información) y del error.
    element.style.setProperty('--lf-warn', theme.dark ? '#f5b24a' : '#b45309');
    element.style.setProperty('--lf-warn-bg', theme.dark ? 'rgba(245,178,74,0.18)' : 'rgba(180,83,9,0.12)');
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

  setSummary(summary: string, format: 'bullets' | 'text', fallacies: Fallacy[] = []): void {
    this.state = 'ready';
    this.retryBtn.hidden = true;
    this.tagEl.textContent = t('overlayTagSummary');
    this.setFallacies(fallacies);
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
    this.setFallacies([]);
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
    this.setFallacies([]);
    this.tagEl.textContent = t('overlayTagSummary');
    this.retryBtn.hidden = true;
    this.setSkeleton();
    this.fit();
  }

  /* ------------------------------ Falacias ------------------------------ */

  /** Un emblema por falacia. Al pasar el ratón, enfocar o clicar se abre el detalle. */
  setFallacies(fallacies: Fallacy[]): void {
    this.closePopover();
    this.badgesEl.replaceChildren(...fallacies.map((fallacy) => this.badge(fallacy)));
  }

  getFallacies(): Fallacy[] {
    return Array.from(this.badgesEl.children, (el) => (el as HTMLElement & { fallacy: Fallacy }).fallacy);
  }

  private badge(fallacy: Fallacy): HTMLButtonElement {
    const btn = document.createElement('button') as HTMLButtonElement & { fallacy: Fallacy };
    btn.className = 'badge';
    btn.type = 'button';
    // Un icono por tipo de falacia: se distinguen sin abrir el popover.
    btn.textContent = fallacyIcon(fallacy.kind);
    btn.dataset.kind = fallacy.kind;
    btn.title = fallacy.name;
    btn.setAttribute('aria-label', t('fallacyBadgeLabel', fallacy.name));
    btn.setAttribute('aria-expanded', 'false');
    btn.fallacy = fallacy;
    btn.addEventListener('mouseenter', () => this.openPopover(fallacy, btn, false));
    btn.addEventListener('focus', () => this.openPopover(fallacy, btn, false));
    btn.addEventListener('mouseleave', () => this.scheduleClose());
    btn.addEventListener('blur', () => this.scheduleClose());
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Clic: fija el popover para poder leerlo con calma; otro clic lo cierra.
      if (this.pinned && this.popFor === fallacy) this.closePopover();
      else this.openPopover(fallacy, btn, true);
    });
    return btn;
  }

  private openPopover(fallacy: Fallacy, anchor: HTMLElement, pin: boolean): void {
    this.cancelClose();
    if (this.popFor === fallacy && this.popEl) {
      if (pin) this.pinned = true;
      return;
    }
    // Un popover fijado no se sustituye por uno de hover; sí por otro clic.
    if (this.pinned && !pin) return;
    this.closePopover();

    const pop = document.createElement('div');
    pop.className = 'pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', t('fallacyTitle'));
    this.applyThemeVars(pop);

    const h4 = document.createElement('h4');
    const kind = document.createElement('span');
    kind.className = 'kind';
    kind.textContent = t('fallacyTitle');
    const name = document.createElement('span');
    name.textContent = `${fallacyIcon(fallacy.kind)} ${fallacy.name}`;
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '✕';
    close.title = t('fallacyClose');
    close.setAttribute('aria-label', t('fallacyClose'));
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closePopover();
    });
    h4.append(kind, name, close);

    const dl = document.createElement('dl');
    if (fallacy.quote) {
      const dt = document.createElement('dt');
      dt.textContent = t('fallacyQuoteLabel');
      const dd = document.createElement('dd');
      const quote = document.createElement('blockquote');
      quote.textContent = `“${fallacy.quote}”`;
      dd.appendChild(quote);
      dl.append(dt, dd);
    }
    const dtWhy = document.createElement('dt');
    dtWhy.textContent = t('fallacyWhyLabel');
    const ddWhy = document.createElement('dd');
    ddWhy.textContent = fallacy.explanation;
    dl.append(dtWhy, ddWhy);

    pop.append(h4, dl);
    pop.addEventListener('mouseenter', () => this.cancelClose());
    pop.addEventListener('mouseleave', () => this.scheduleClose());
    pop.addEventListener('click', (e) => e.stopPropagation());

    // Posición bajo el emblema, alineado a su borde derecho, en coordenadas del host.
    const host = this.host.getBoundingClientRect();
    const rect = anchor.getBoundingClientRect();
    pop.style.top = `${rect.bottom - host.top + 4}px`;
    pop.style.right = `${Math.max(0, host.right - rect.right)}px`;

    this.shadow.appendChild(pop);
    this.popEl = pop;
    this.popFor = fallacy;
    this.pinned = pin;
    anchor.setAttribute('aria-expanded', 'true');
    document.addEventListener('keydown', this.onKeydown);
    if (pin) setTimeout(() => document.addEventListener('click', this.onDocumentClick, { once: true }), 0);
  }

  private scheduleClose(): void {
    if (this.pinned) return;
    this.cancelClose();
    // Pequeño margen para poder pasar del emblema al popover sin que se cierre.
    this.closeTimer = setTimeout(() => this.closePopover(), 150);
  }

  private cancelClose(): void {
    if (this.closeTimer !== null) clearTimeout(this.closeTimer);
    this.closeTimer = null;
  }

  private onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.closePopover();
  };

  private onDocumentClick = (): void => this.closePopover();

  closePopover(): void {
    this.cancelClose();
    this.popEl?.remove();
    this.popEl = null;
    this.popFor = null;
    this.pinned = false;
    for (const badge of this.badgesEl.children) badge.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', this.onKeydown);
    document.removeEventListener('click', this.onDocumentClick);
  }

  isPopoverOpen(): boolean {
    return this.popEl !== null;
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
    this.closePopover();
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
    this.closePopover();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.host.remove();
    if (this.previousPosition !== null) {
      this.block.style.position = this.previousPosition;
      if (!this.block.getAttribute('style')) this.block.removeAttribute('style');
    }
  }
}
