import { Readability } from '@mozilla/readability';
import { describe, expect, it } from 'vitest';
import { extract } from '../lib/extract/blocks';

/**
 * Readability es dependencia SOLO de desarrollo: aquí se usa como referencia de
 * calidad contra la que medir el extractor propio, que opera sobre el DOM vivo.
 * Si esta comparación se degrada, el porte de las heurísticas ha perdido fidelidad.
 */

function words(n: number, seed: string): string {
  return Array.from({ length: n }, (_, i) => (i % 11 === 10 ? `${seed}${i},` : `${seed}${i}`)).join(' ');
}

const ARTICLE_HTML = `
<!doctype html>
<html lang="es">
  <head><title>El valle y la niebla</title></head>
  <body>
    <header class="site-header">
      <nav><a href="/">Inicio</a><a href="/blog">Blog</a><a href="/sobre">Sobre</a></nav>
    </header>
    <div class="wrapper">
      <aside class="sidebar related">
        <h3>También te puede interesar</h3>
        <ul><li><a href="/1">Otro artículo</a></li><li><a href="/2">Y otro más</a></li></ul>
      </aside>
      <main>
        <article class="post-content entry">
          <h1>El valle y la niebla</h1>
          <p class="intro">${words(140, 'intro')}</p>
          <p>${words(180, 'cuerpo')}</p>
          <h2>La segunda parte</h2>
          <p>${words(220, 'segunda')}</p>
          <p>Corto.</p>
          <blockquote>${words(130, 'cita')}</blockquote>
          <p>${words(160, 'final')}</p>
        </article>
      </main>
    </div>
    <div class="comments" id="disqus_thread">
      <p>${words(200, 'comentario')}</p>
    </div>
    <footer class="site-footer"><p>${words(60, 'pie')}</p></footer>
  </body>
</html>`;

function load(html: string): Document {
  const doc = document.implementation.createHTMLDocument('test');
  doc.documentElement.innerHTML = html
    .replace(/^[\s\S]*?<html[^>]*>/i, '')
    .replace(/<\/html>[\s\S]*$/i, '');
  return doc;
}

describe('extractor propio vs Readability', () => {
  it('identifica el mismo contenido principal que Readability', () => {
    const mine = load(ARTICLE_HTML);
    const theirs = load(ARTICLE_HTML);

    const result = extract(mine.body, { minWords: 100, skipAnchorCheck: true });
    const parsed = new Readability(theirs).parse();

    expect(result.container).not.toBeNull();
    expect(parsed).not.toBeNull();

    const theirText = (parsed!.textContent ?? '').replace(/\s+/g, ' ');

    // Todo lo que anotamos debe estar dentro de lo que Readability considera artículo.
    for (const block of result.blocks) {
      const firstWords = block.text.replace(/\s+/g, ' ').split(' ').slice(0, 5).join(' ');
      expect(theirText).toContain(firstWords);
    }
  });

  it('descarta navegación, comentarios y pie, igual que Readability', () => {
    const doc = load(ARTICLE_HTML);
    const result = extract(doc.body, { minWords: 100, skipAnchorCheck: true });
    const allText = result.blocks.map((b) => b.text).join(' ');

    expect(allText).not.toContain('comentario0');
    expect(allText).not.toContain('pie0');
    expect(allText).not.toContain('Inicio');
    expect(allText).not.toContain('También te puede interesar');
  });

  it('anota los bloques largos y une los cortos al vecino más pequeño', () => {
    const doc = load(ARTICLE_HTML);
    const result = extract(doc.body, { minWords: 100, skipAnchorCheck: true });
    const texts = result.blocks.map((b) => b.text);

    expect(texts.some((t) => t.startsWith('intro0'))).toBe(true);
    expect(texts.some((t) => t.startsWith('cuerpo0'))).toBe(true);
    expect(texts.some((t) => t.startsWith('segunda0'))).toBe(true);
    expect(texts.some((t) => t.startsWith('final0'))).toBe(true);
    // "Corto." no llega al umbral, pero no se queda fuera: se une a la cita
    // (130 palabras), que es más pequeña que el párrafo anterior (220).
    const rescued = result.blocks.find((b) => b.text.startsWith('Corto.'));
    expect(rescued?.text).toContain('cita0');
    expect(rescued?.merged).toBe(true);
    expect(result.blocks).toHaveLength(5);
  });

  it('no marca degradación en un artículo bien estructurado', () => {
    const doc = load(ARTICLE_HTML);
    const result = extract(doc.body, { minWords: 100, skipAnchorCheck: true });
    expect(result.degradeReason).toBeNull();
  });
});
