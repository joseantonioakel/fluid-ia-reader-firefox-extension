import { t } from '../i18n';

/**
 * Modo B — Vista de lectura.
 *
 * Cuando el anclaje in-place no es fiable, clonamos y saneamos el contenedor del
 * artículo y lo renderizamos dentro de un Shadow DOM propio. Sobre ese markup el
 * anclaje de overlays es determinista: sin CSS hostil, sin position inesperada,
 * sin transforms, sin guerras de z-index.
 */

const ALLOWED_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'UL', 'OL', 'LI', 'DL', 'DT', 'DD',
  'BLOCKQUOTE', 'PRE', 'CODE', 'KBD', 'SAMP', 'VAR',
  'A', 'EM', 'STRONG', 'B', 'I', 'U', 'S', 'SUP', 'SUB', 'SPAN',
  'FIGURE', 'FIGCAPTION', 'IMG', 'PICTURE', 'SOURCE',
  'BR', 'HR', 'DIV', 'SECTION', 'ARTICLE', 'MARK', 'TIME', 'SMALL',
  'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'CAPTION',
]);

const ALLOWED_ATTRS = new Set(['href', 'src', 'srcset', 'alt', 'title', 'datetime', 'colspan', 'rowspan']);

/** Elimina todo lo que no sea contenido: scripts, estilos, handlers, elementos posicionados. */
export function sanitize(node: Element): void {
  for (const child of Array.from(node.children)) {
    if (!ALLOWED_TAGS.has(child.tagName)) {
      child.remove();
      continue;
    }
    for (const attr of Array.from(child.attributes)) {
      const name = attr.name.toLowerCase();
      if (!ALLOWED_ATTRS.has(name) || name.startsWith('on')) {
        child.removeAttribute(attr.name);
      }
    }
    // Enlaces siempre a pestaña nueva y sin filtrar el referrer de la vista de lectura.
    if (child.tagName === 'A') {
      child.setAttribute('target', '_blank');
      child.setAttribute('rel', 'noopener noreferrer');
    }
    sanitize(child);
  }
}

const READER_CSS = `
:host { all: initial; }
.wrap {
  position: fixed;
  inset: 0;
  z-index: 2147483646;
  overflow-y: auto;
  background: var(--lf-bg);
  color: var(--lf-fg);
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 19px;
  line-height: 1.7;
  -webkit-font-smoothing: antialiased;
}
.bar {
  position: sticky;
  top: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  background: var(--lf-bar);
  border-bottom: 1px solid var(--lf-border);
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 13px;
  backdrop-filter: blur(8px);
}
.bar strong { font-weight: 600; }
.bar button {
  font: inherit;
  cursor: pointer;
  border: 1px solid var(--lf-border);
  background: transparent;
  color: inherit;
  border-radius: 6px;
  padding: 5px 10px;
}
.bar button:hover { background: var(--lf-hover); }
article {
  max-width: 42em;
  margin: 0 auto;
  padding: 40px 24px 96px;
}
article h1 { font-size: 1.9em; line-height: 1.25; margin: 0 0 0.6em; }
article h2 { font-size: 1.4em; margin: 1.6em 0 0.5em; }
article h3 { font-size: 1.15em; margin: 1.4em 0 0.4em; }
article p, article li, article blockquote, article dd { margin: 0 0 1.1em; position: relative; }
article img { max-width: 100%; height: auto; display: block; margin: 1.2em auto; }
article a { color: var(--lf-link); }
article blockquote {
  border-left: 3px solid var(--lf-border);
  padding-left: 1em;
  font-style: italic;
}
article pre {
  overflow-x: auto;
  background: var(--lf-hover);
  padding: 12px;
  border-radius: 8px;
  font-size: 0.85em;
}
@media print { .bar { display: none; } }
`;

export interface ReaderView {
  host: HTMLElement;
  /** Raíz sobre la que ejecutar la extracción de bloques. */
  root: HTMLElement;
  close(): void;
}

export interface ReaderOptions {
  title: string;
  container: HTMLElement;
  theme: { bg: string; fg: string; bar: string; border: string; hover: string; link: string };
  onClose(): void;
}

export function openReaderView(options: ReaderOptions): ReaderView {
  const host = document.createElement('div');
  host.id = 'lector-fluido-reader';
  host.style.setProperty('all', 'initial', 'important');
  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = READER_CSS;
  shadow.appendChild(style);

  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  const theme = options.theme;
  wrap.style.setProperty('--lf-bg', theme.bg);
  wrap.style.setProperty('--lf-fg', theme.fg);
  wrap.style.setProperty('--lf-bar', theme.bar);
  wrap.style.setProperty('--lf-border', theme.border);
  wrap.style.setProperty('--lf-hover', theme.hover);
  wrap.style.setProperty('--lf-link', theme.link);

  const bar = document.createElement('div');
  bar.className = 'bar';
  const label = document.createElement('strong');
  label.textContent = t('readerTitle');
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = t('readerClose');
  bar.append(label, closeBtn);

  const article = document.createElement('article');
  if (options.title) {
    const h1 = document.createElement('h1');
    h1.textContent = options.title;
    article.appendChild(h1);
  }

  const clone = options.container.cloneNode(true) as HTMLElement;
  sanitize(clone);
  // El propio contenedor puede traer atributos de estilo; se descartan.
  for (const attr of Array.from(clone.attributes)) clone.removeAttribute(attr.name);
  article.appendChild(clone);

  wrap.append(bar, article);
  shadow.appendChild(wrap);
  document.documentElement.appendChild(host);

  // Congelar el scroll de la página de fondo mientras la vista está abierta.
  const previousOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = 'hidden';

  const close = () => {
    document.documentElement.style.overflow = previousOverflow;
    host.remove();
    options.onClose();
  };
  closeBtn.addEventListener('click', close);

  return { host, root: article, close };
}
