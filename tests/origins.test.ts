import { describe, expect, it } from 'vitest';
import { hostnameOf, originPatternFor } from '../lib/origins';

describe('originPatternFor', () => {
  it('genera el patrón por dominio conservando el esquema', () => {
    expect(originPatternFor('https://ejemplo.com/blog/post?a=1#x')).toBe('https://ejemplo.com/*');
    expect(originPatternFor('http://ejemplo.com/')).toBe('http://ejemplo.com/*');
  });

  it('distingue subdominios: activar uno no activa el resto', () => {
    expect(originPatternFor('https://blog.ejemplo.com/x')).toBe('https://blog.ejemplo.com/*');
    expect(originPatternFor('https://ejemplo.com/x')).toBe('https://ejemplo.com/*');
  });

  it('rechaza esquemas donde no se puede inyectar', () => {
    expect(originPatternFor('about:debugging')).toBeNull();
    expect(originPatternFor('file:///Users/x/a.html')).toBeNull();
    expect(originPatternFor('moz-extension://abc/options.html')).toBeNull();
    expect(originPatternFor('chrome://extensions')).toBeNull();
    expect(originPatternFor('')).toBeNull();
  });
});

describe('hostnameOf', () => {
  it('extrae el host de una URL', () => {
    expect(hostnameOf('https://ejemplo.com/a/b')).toBe('ejemplo.com');
  });

  it('devuelve la entrada si no es una URL válida', () => {
    expect(hostnameOf('no-una-url')).toBe('no-una-url');
  });
});
