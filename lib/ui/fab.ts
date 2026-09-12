import { t } from '../i18n';
import type { Theme } from './theme';

const FAB_CSS = `
:host { all: initial; }
/* Pestaña pegada al borde derecho. Plegada solo muestra el icono; al pasar el
   ratón, con el foco o mientras trabaja, se despliega hacia la izquierda con la
   etiqueta y el menú. El icono va en el extremo derecho para que no se mueva
   bajo el puntero al desplegarse (si lo hiciera, el hover parpadearía). */
.fab {
  position: fixed;
  right: 0;
  z-index: 2147483500;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 9px 0 10px;
  border: 1px solid var(--lf-border);
  border-right: none;
  border-radius: 18px 0 0 18px;
  background: var(--lf-bg);
  color: var(--lf-fg);
  font: 500 12px/1 system-ui, -apple-system, sans-serif;
  box-shadow: 0 2px 10px rgba(0,0,0,0.18);
  cursor: pointer;
  user-select: none;
  touch-action: none;
  white-space: nowrap;
  opacity: 0.88;
}
.fab:hover, .fab:focus-within, .fab[data-busy="true"], .fab[data-open="true"] { opacity: 1; }
.label, .menu-btn { display: none; }
.fab:hover .label, .fab:focus-within .label, .fab[data-busy="true"] .label, .fab[data-open="true"] .label,
.fab:hover .menu-btn, .fab:focus-within .menu-btn, .fab[data-open="true"] .menu-btn { display: inline-block; }
.fab[data-busy="true"] { cursor: progress; }
.icon { font-size: 16px; line-height: 1; }
.spin { display: inline-block; animation: lf-spin 1s linear infinite; }
@keyframes lf-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
.menu-btn {
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 14px;
  cursor: pointer;
  padding: 4px 3px;
  opacity: 0.6;
}
.menu-btn:hover { opacity: 1; }
.menu {
  position: fixed;
  right: 8px;
  z-index: 2147483501;
  min-width: 210px;
  padding: 5px;
  border: 1px solid var(--lf-border);
  border-radius: 10px;
  background: var(--lf-bg);
  color: var(--lf-fg);
  box-shadow: 0 8px 28px rgba(0,0,0,0.22);
  font: 13px/1.3 system-ui, -apple-system, sans-serif;
}
.menu button {
  display: block;
  width: 100%;
  text-align: left;
  padding: 8px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.menu button:hover { background: var(--lf-hover); }
.menu hr { border: none; border-top: 1px solid var(--lf-border); margin: 4px 2px; }
@media print { :host { display: none !important; } }
`;

export interface FabAction {
  label: string;
  onSelect(): void;
  separatorBefore?: boolean;
}

/** Posición del widget: siempre pegado al borde derecho, solo varía la altura. */
export interface FabPosition {
  bottom: number;
}

export interface FabOptions {
  theme: Theme;
  onPrimary(): void;
  getMenu(): FabAction[];
  initialPosition: FabPosition;
  onMove(position: FabPosition): void;
}

const FAB_HEIGHT = 36;
const EDGE_MARGIN = 8;

export class FloatingButton {
  private host: HTMLElement;
  private shadow: ShadowRoot;
  private fab!: HTMLElement;
  private labelEl!: HTMLElement;
  private iconEl!: HTMLElement;
  private menuEl: HTMLElement | null = null;
  private dragged = false;

  constructor(private options: FabOptions) {
    this.host = document.createElement('div');
    this.host.id = 'lector-fluido-fab';
    this.host.style.setProperty('all', 'initial', 'important');
    this.shadow = this.host.attachShadow({ mode: 'closed' });
    this.build();
    document.documentElement.appendChild(this.host);
  }

  private build(): void {
    const style = document.createElement('style');
    style.textContent = FAB_CSS;

    this.fab = document.createElement('div');
    this.fab.className = 'fab';
    this.fab.setAttribute('role', 'button');
    this.fab.setAttribute('tabindex', '0');
    this.fab.setAttribute('aria-label', t('fabAriaLabel'));
    this.fab.title = t('fabTitle');
    const theme = this.options.theme;
    this.fab.style.setProperty('--lf-bg', theme.bg);
    this.fab.style.setProperty('--lf-fg', theme.fg);
    this.fab.style.setProperty('--lf-border', theme.border);
    this.fab.style.setProperty('--lf-hover', theme.hover);
    this.fab.style.bottom = `${this.clampBottom(this.options.initialPosition.bottom)}px`;

    const menuBtn = document.createElement('button');
    menuBtn.className = 'menu-btn';
    menuBtn.type = 'button';
    menuBtn.textContent = '⋮';
    menuBtn.title = t('fabMoreOptions');
    menuBtn.setAttribute('aria-label', t('fabMoreOptions'));
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMenu();
    });

    this.labelEl = document.createElement('span');
    this.labelEl.className = 'label';
    this.labelEl.textContent = t('fabSummarize');

    this.iconEl = document.createElement('span');
    this.iconEl.className = 'icon';
    this.iconEl.textContent = '📖';

    this.fab.append(menuBtn, this.labelEl, this.iconEl);
    this.fab.addEventListener('click', () => {
      if (this.dragged) return;
      this.closeMenu();
      this.options.onPrimary();
    });
    this.fab.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.options.onPrimary();
      }
    });
    // Clic derecho sobre la pestaña: el menú, sin tener que apuntar al ⋮.
    this.fab.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.toggleMenu();
    });
    this.enableDrag();

    this.shadow.append(style, this.fab);
  }

  private clampBottom(bottom: number): number {
    const max = Math.max(EDGE_MARGIN, window.innerHeight - FAB_HEIGHT - EDGE_MARGIN);
    return Math.round(Math.max(EDGE_MARGIN, Math.min(max, bottom)));
  }

  /** Arrastre vertical con pointer events; la posición se persiste vía onMove. */
  private enableDrag(): void {
    let startY = 0;
    let startBottom = 0;
    let dragging = false;

    this.fab.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).classList.contains('menu-btn')) return;
      if (e.button !== 0) return;
      dragging = true;
      this.dragged = false;
      startY = e.clientY;
      startBottom = Number.parseInt(this.fab.style.bottom || '24', 10);
      this.fab.setPointerCapture(e.pointerId);
    });

    this.fab.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dy = startY - e.clientY;
      if (Math.abs(dy) > 3) this.dragged = true;
      this.fab.style.bottom = `${this.clampBottom(startBottom + dy)}px`;
    });

    const end = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      this.fab.releasePointerCapture(e.pointerId);
      if (this.dragged) {
        this.options.onMove({ bottom: Number.parseInt(this.fab.style.bottom, 10) });
        // Evita que el click posterior al arrastre dispare la acción principal.
        setTimeout(() => (this.dragged = false), 0);
      }
    };
    this.fab.addEventListener('pointerup', end);
    this.fab.addEventListener('pointercancel', end);
  }

  private toggleMenu(): void {
    if (this.menuEl) {
      this.closeMenu();
      return;
    }
    const menu = document.createElement('div');
    menu.className = 'menu';
    const theme = this.options.theme;
    menu.style.setProperty('--lf-bg', theme.bg);
    menu.style.setProperty('--lf-fg', theme.fg);
    menu.style.setProperty('--lf-border', theme.border);
    menu.style.setProperty('--lf-hover', theme.hover);

    for (const action of this.options.getMenu()) {
      if (action.separatorBefore) menu.appendChild(document.createElement('hr'));
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = action.label;
      btn.addEventListener('click', () => {
        this.closeMenu();
        action.onSelect();
      });
      menu.appendChild(btn);
    }

    // El menú se abre hacia arriba, salvo que la pestaña esté tan alta que no
    // quepa: entonces se despliega hacia abajo.
    const rect = this.fab.getBoundingClientRect();
    if (rect.top > 280) menu.style.bottom = `${window.innerHeight - rect.top + 8}px`;
    else menu.style.top = `${rect.bottom + 8}px`;
    this.shadow.appendChild(menu);
    this.menuEl = menu;
    this.fab.dataset.open = 'true';

    setTimeout(() => document.addEventListener('click', this.onDocumentClick, { once: true }), 0);
  }

  private onDocumentClick = (): void => this.closeMenu();

  private closeMenu(): void {
    this.menuEl?.remove();
    this.menuEl = null;
    this.fab.dataset.open = 'false';
  }

  setBusy(done: number, total: number): void {
    this.fab.dataset.busy = 'true';
    this.iconEl.innerHTML = '';
    const spin = document.createElement('span');
    spin.className = 'spin';
    spin.textContent = '◌';
    this.iconEl.appendChild(spin);
    this.labelEl.textContent = total > 0 ? `${done}/${total}` : t('fabBusy');
    this.fab.title = total > 0 ? t('fabBusyTitle', done, total) : t('fabBusy');
  }

  /** Sin etiqueta vuelve al estado inicial: "Resumir" y el título por defecto. */
  setIdle(label?: string): void {
    this.fab.dataset.busy = 'false';
    this.iconEl.textContent = '📖';
    this.labelEl.textContent = label ?? t('fabSummarize');
    this.fab.title = label ?? t('fabTitle');
  }

  setLabel(label: string): void {
    this.labelEl.textContent = label;
  }

  destroy(): void {
    this.closeMenu();
    this.host.remove();
  }
}
