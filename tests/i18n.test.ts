import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { localizeDocument, richText, t } from '../lib/i18n';

type Catalog = Record<string, { message: string }>;

const LOCALES_DIR = join(process.cwd(), 'public/_locales');
const SUPPORTED = ['es', 'en', 'fr', 'de'];

function catalog(lang: string): Catalog {
  return JSON.parse(readFileSync(join(LOCALES_DIR, lang, 'messages.json'), 'utf8')) as Catalog;
}

function placeholders(message: string): string[] {
  return [...message.matchAll(/\$\d/g)].map((m) => m[0]).sort();
}

describe('catálogos de idioma', () => {
  const es = catalog('es');

  it('existen exactamente los cuatro idiomas soportados', () => {
    const dirs = readdirSync(LOCALES_DIR).sort();
    expect(dirs).toEqual([...SUPPORTED].sort());
  });

  it.each(SUPPORTED.filter((l) => l !== 'es'))('%s tiene las mismas claves que el español', (lang) => {
    const other = catalog(lang);
    expect(Object.keys(other).sort()).toEqual(Object.keys(es).sort());
  });

  it.each(SUPPORTED.filter((l) => l !== 'es'))('%s conserva los marcadores $1, $2… de cada mensaje', (lang) => {
    const other = catalog(lang);
    for (const [key, { message }] of Object.entries(es)) {
      expect(placeholders(other[key]!.message), key).toEqual(placeholders(message));
    }
  });

  it.each(SUPPORTED)('%s no tiene mensajes vacíos', (lang) => {
    for (const [key, { message }] of Object.entries(catalog(lang))) {
      expect(message.trim(), key).not.toBe('');
    }
  });

  it('el marcado ligero está equilibrado en todos los idiomas', () => {
    for (const lang of SUPPORTED) {
      for (const [key, { message }] of Object.entries(catalog(lang))) {
        expect((message.match(/\*\*/g) ?? []).length % 2, `${lang}:${key}`).toBe(0);
        expect((message.match(/`/g) ?? []).length % 2, `${lang}:${key}`).toBe(0);
      }
    }
  });
});

describe('t', () => {
  it('sustituye los marcadores posicionales', () => {
    expect(t('fabBusyTitle', 3, 10)).toBe('Resumiendo 3 de 10');
    expect(t('noBlocksMessage', 100)).toBe('No hay bloques de más de 100 palabras en esta página.');
  });

  it('una clave sin traducción sale como tal, no en blanco', () => {
    expect(t('claveInexistente' as never)).toBe('claveInexistente');
  });
});

describe('richText', () => {
  it('convierte **negrita** y `código` en elementos, sin innerHTML', () => {
    const fragment = richText('Elige **IA local** o abre `about:debugging` <b>x</b>.');
    const div = document.createElement('div');
    div.append(fragment);
    expect(div.querySelector('strong')?.textContent).toBe('IA local');
    expect(div.querySelector('code')?.textContent).toBe('about:debugging');
    // El texto que parece HTML se queda como texto.
    expect(div.querySelector('b')).toBeNull();
    expect(div.textContent).toBe('Elige IA local o abre about:debugging <b>x</b>.');
  });
});

describe('localizeDocument', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('rellena texto, marcado, title y placeholder según los atributos data-i18n', () => {
    document.body.innerHTML = `
      <h1 data-i18n="optSectionPrivacy">x</h1>
      <p data-i18n-rich="optWelcomeStep1"></p>
      <button data-i18n-title="optRemoveRevoke"></button>
      <input data-i18n-placeholder="optKeyPlaceholder" />`;
    localizeDocument();
    expect(document.querySelector('h1')?.textContent).toBe('Privacidad');
    expect(document.querySelector('p strong')?.textContent).toBe('IA local');
    expect(document.querySelector('button')?.title).toBe('Quitar y revocar el permiso');
    expect(document.querySelector('input')?.placeholder).toBe('Pega aquí tu clave');
    expect(document.documentElement.lang).toBe('es');
  });
});
