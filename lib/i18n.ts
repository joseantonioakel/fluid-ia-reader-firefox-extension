import { browser } from '#imports';

/**
 * Internacionalización sobre `browser.i18n`, el mecanismo estándar de las
 * extensiones: los catálogos viven en `public/_locales/<idioma>/messages.json`
 * y el navegador elige el idioma según su propia configuración, con `es` como
 * respaldo (`default_locale` del manifiesto).
 *
 * `MessageKey` se deriva del catálogo español, que es la fuente de verdad: una
 * clave que no exista ahí no compila. Una prueba comprueba que los demás
 * idiomas tienen exactamente las mismas claves y los mismos marcadores.
 */
export type MessageKey = keyof typeof import('../public/_locales/es/messages.json');

/** Traduce una clave, sustituyendo `$1`, `$2`… por los argumentos. */
export function t(key: MessageKey, ...substitutions: (string | number)[]): string {
  const text = browser.i18n.getMessage(key, substitutions.map(String));
  // Una clave sin traducción sale como tal: se ve en pantalla y se arregla,
  // en vez de dejar un hueco en blanco que nadie nota.
  return text || key;
}

/** Idioma de la interfaz del navegador, sin región: `es-ES` → `es`. */
export function uiLanguage(): string {
  return (browser.i18n.getUILanguage() || 'es').split('-')[0] || 'es';
}

/**
 * Marcado ligero de los catálogos: `**negrita**` y `` `código` ``. Se resuelve
 * construyendo nodos, nunca con innerHTML, así que el texto del catálogo no
 * puede inyectar nada aunque un día venga de fuera.
 */
export function richText(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const pattern = /\*\*(.+?)\*\*|`(.+?)`/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) fragment.append(text.slice(last, index));
    const element = document.createElement(match[1] !== undefined ? 'strong' : 'code');
    element.textContent = match[1] ?? match[2] ?? '';
    fragment.append(element);
    last = index + match[0].length;
  }
  if (last < text.length) fragment.append(text.slice(last));
  return fragment;
}

/**
 * Traduce una página estática. Los elementos declaran la clave en atributos:
 *   data-i18n="clave"              → contenido de texto
 *   data-i18n-rich="clave"         → contenido con marcado ligero
 *   data-i18n-title="clave"        → atributo title
 *   data-i18n-placeholder="clave"  → atributo placeholder
 * También fija `lang` en la raíz para que el navegador aplique guiones y
 * tipografía del idioma correcto.
 */
export function localizeDocument(root: ParentNode = document): void {
  if (root === document) document.documentElement.lang = uiLanguage();
  for (const element of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    element.textContent = t(element.dataset.i18n as MessageKey);
  }
  for (const element of root.querySelectorAll<HTMLElement>('[data-i18n-rich]')) {
    element.replaceChildren(richText(t(element.dataset.i18nRich as MessageKey)));
  }
  for (const element of root.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
    element.title = t(element.dataset.i18nTitle as MessageKey);
  }
  for (const element of root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]')) {
    element.placeholder = t(element.dataset.i18nPlaceholder as MessageKey);
  }
}
