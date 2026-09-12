/**
 * Sustituto de `#imports` para las pruebas.
 *
 * En producción WXT resuelve ese alias; en Vitest lo apuntamos aquí para poder
 * probar módulos de `lib/` sin arrancar el pipeline de la extensión.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fakeBrowser } from 'wxt/testing/fake-browser';

/**
 * El navegador falso no implementa `i18n`. Se sirve el catálogo español, que es
 * el idioma por defecto, con la misma sustitución de `$1`, `$2`… que hace el
 * navegador: así las pruebas ven exactamente los textos que vería el usuario.
 */
// Ruta desde el directorio del proyecto: bajo jsdom, import.meta.url no es file:.
const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'public/_locales/es/messages.json'), 'utf8'),
) as Record<string, { message: string }>;

const i18n = {
  getMessage(key: string, substitutions?: string | string[]): string {
    const template = messages[key]?.message ?? '';
    const subs = substitutions === undefined ? [] : Array.isArray(substitutions) ? substitutions : [substitutions];
    return template.replace(/\$(\d)/g, (_, n: string) => subs[Number(n) - 1] ?? '');
  },
  getUILanguage: () => 'es',
  getAcceptLanguages: async () => ['es'],
};

export const browser = Object.assign(fakeBrowser, { i18n }) as typeof fakeBrowser & { i18n: typeof i18n };

export function defineBackground<T>(definition: T): T {
  return definition;
}

export function defineContentScript<T>(definition: T): T {
  return definition;
}
