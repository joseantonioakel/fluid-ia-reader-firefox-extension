import { t } from '../i18n';
import type { Theme } from './theme';

export interface ToastAction {
  label: string;
  onSelect(): void;
}

const TOAST_CSS = `
:host { all: initial; }
.toast {
  position: fixed;
  right: 24px;
  bottom: 84px;
  z-index: 2147483502;
  max-width: 340px;
  padding: 12px 14px;
  border: 1px solid var(--lf-border);
  border-radius: 10px;
  background: var(--lf-bg);
  color: var(--lf-fg);
  font: 13px/1.45 system-ui, -apple-system, sans-serif;
  box-shadow: 0 8px 28px rgba(0,0,0,0.22);
  animation: lf-slide 160ms ease-out;
}
@keyframes lf-slide { from { transform: translateY(8px); opacity: 0; } to { transform: none; opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .toast { animation: none; } }
.actions { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
button {
  font: inherit;
  cursor: pointer;
  border: 1px solid var(--lf-border);
  border-radius: 6px;
  padding: 5px 10px;
  background: transparent;
  color: inherit;
}
button.primary { background: var(--lf-accent); border-color: var(--lf-accent); color: #fff; }
button:hover { filter: brightness(1.06); }
@media print { :host { display: none !important; } }
`;

export function showToast(
  theme: Theme,
  message: string,
  actions: ToastAction[] = [],
  timeoutMs = 9000,
): () => void {
  const host = document.createElement('div');
  host.style.setProperty('all', 'initial', 'important');
  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = TOAST_CSS;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  toast.style.setProperty('--lf-bg', theme.bg);
  toast.style.setProperty('--lf-fg', theme.fg);
  toast.style.setProperty('--lf-border', theme.border);
  toast.style.setProperty('--lf-accent', theme.accent);
  toast.append(document.createTextNode(message));

  const close = () => {
    clearTimeout(timer);
    host.remove();
  };

  if (actions.length) {
    const row = document.createElement('div');
    row.className = 'actions';
    actions.forEach((action, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      if (index === 0) btn.className = 'primary';
      btn.textContent = action.label;
      btn.addEventListener('click', () => {
        close();
        action.onSelect();
      });
      row.appendChild(btn);
    });
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.textContent = t('toastClose');
    dismiss.addEventListener('click', close);
    row.appendChild(dismiss);
    toast.appendChild(row);
  }

  shadow.append(style, toast);
  document.documentElement.appendChild(host);

  const timer = setTimeout(close, timeoutMs);
  return close;
}
