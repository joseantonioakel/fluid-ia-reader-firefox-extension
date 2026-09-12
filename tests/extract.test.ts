import { beforeEach, describe, expect, it } from 'vitest';
import { extract, isEligibleBlock } from '../lib/extract/blocks';
import { findArticleContainer, getLinkDensity, isUnlikelyCandidate } from '../lib/extract/score';

/** Genera un párrafo con el número de palabras pedido y comas realistas. */
function paragraph(words: number, seed = 'palabra'): string {
  const parts: string[] = [];
  for (let i = 0; i < words; i += 1) {
    parts.push(i % 12 === 11 ? `${seed}${i},` : `${seed}${i}`);
  }
  return parts.join(' ');
}

function setBody(html: string): void {
  document.body.innerHTML = html;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('findArticleContainer', () => {
  it('elige el contenedor del artículo y descarta la navegación', () => {
    setBody(`
      <nav class="site-nav"><a href="/a">Uno</a><a href="/b">Dos</a><a href="/c">Tres</a></nav>
      <div id="content" class="post-body">
        <p>${paragraph(150)}</p>
        <p>${paragraph(160)}</p>
        <p>${paragraph(140)}</p>
      </div>
      <footer class="site-footer"><p>${paragraph(40)}</p></footer>
    `);

    const candidate = findArticleContainer(document.body);
    expect(candidate).not.toBeNull();
    expect(candidate!.element.id).toBe('content');
  });

  it('prefiere el contenedor con clase positiva frente a un sidebar puntuado', () => {
    setBody(`
      <div class="sidebar-widget"><p>${paragraph(120)}</p></div>
      <article class="entry-content"><p>${paragraph(120)}</p><p>${paragraph(130)}</p></article>
    `);

    const candidate = findArticleContainer(document.body);
    expect(candidate!.element.className).toContain('entry-content');
  });
});

describe('isUnlikelyCandidate', () => {
  it('descarta contenedores de comentarios y banners', () => {
    const el = document.createElement('div');
    el.className = 'comment-list';
    expect(isUnlikelyCandidate(el)).toBe(true);
  });

  it('perdona los que también parecen contenido (escape hatch de Readability)', () => {
    const el = document.createElement('div');
    el.className = 'sidebar article-body';
    expect(isUnlikelyCandidate(el)).toBe(false);
  });

  it('nunca descarta el body', () => {
    const el = document.createElement('body');
    el.className = 'footer';
    expect(isUnlikelyCandidate(el)).toBe(false);
  });
});

describe('getLinkDensity', () => {
  it('da ~1 en un menú de solo enlaces', () => {
    const el = document.createElement('div');
    el.innerHTML = '<a href="/a">Inicio</a> <a href="/b">Blog</a>';
    expect(getLinkDensity(el)).toBeGreaterThan(0.9);
  });

  it('da ~0 en un párrafo sin enlaces', () => {
    const el = document.createElement('p');
    el.textContent = paragraph(50);
    expect(getLinkDensity(el)).toBe(0);
  });

  it('penaliza a la mitad las anclas internas', () => {
    const el = document.createElement('div');
    el.innerHTML = '<a href="#seccion">abcdefghij</a>';
    // Coeficiente 0.3 para enlaces internos.
    expect(getLinkDensity(el)).toBeCloseTo(0.3, 5);
  });
});

describe('isEligibleBlock', () => {
  it('rechaza un párrafo que es casi todo código', () => {
    const root = document.createElement('div');
    root.innerHTML = `<p><code>${'x'.repeat(200)}</code> texto</p>`;
    const block = root.querySelector('p')!;
    expect(isEligibleBlock(block, root)).toBe(false);
  });

  it('rechaza un párrafo dominado por enlaces', () => {
    const root = document.createElement('div');
    root.innerHTML = `<p><a href="/x">${'a'.repeat(200)}</a> b</p>`;
    const block = root.querySelector('p')!;
    expect(isEligibleBlock(block, root)).toBe(false);
  });

  it('rechaza bloques dentro de figure o table', () => {
    const root = document.createElement('div');
    root.innerHTML = `<figure><p>${paragraph(200)}</p></figure>`;
    const block = root.querySelector('p')!;
    expect(isEligibleBlock(block, root)).toBe(false);
  });

  it('acepta un párrafo normal', () => {
    const root = document.createElement('div');
    root.innerHTML = `<p>${paragraph(200)}</p>`;
    const block = root.querySelector('p')!;
    expect(isEligibleBlock(block, root)).toBe(true);
  });

  it('rechaza un div que contiene otros bloques', () => {
    const root = document.createElement('div');
    root.innerHTML = `<div id="outer"><p>${paragraph(150)}</p></div>`;
    const outer = root.querySelector('#outer') as HTMLElement;
    expect(isEligibleBlock(outer, root)).toBe(false);
  });
});

describe('extract', () => {
  it('filtra por el umbral de palabras configurado', () => {
    setBody(`
      <article class="post-content">
        <p id="largo1">${paragraph(150)}</p>
        <p id="corto">${paragraph(30)}</p>
        <p id="largo2">${paragraph(200)}</p>
      </article>
    `);

    const result = extract(document.body, { minWords: 100, skipAnchorCheck: true });
    const ids = result.blocks.map((b) => b.element.id);
    expect(ids).toEqual(['largo1', 'largo2']);
    expect(result.totalCandidates).toBe(3);
  });

  it('respeta un umbral más bajo', () => {
    setBody(`
      <article class="post-content">
        <p>${paragraph(150)}</p>
        <p>${paragraph(60)}</p>
        <p>${paragraph(200)}</p>
      </article>
    `);
    const result = extract(document.body, { minWords: 50, skipAnchorCheck: true });
    expect(result.blocks).toHaveLength(3);
  });

  it('no duplica texto cuando hay bloques anidados: gana el contenedor exterior', () => {
    setBody(`
      <article class="post-content">
        <blockquote id="cita"><p id="interno">${paragraph(150)}</p></blockquote>
        <p id="suelto">${paragraph(150)}</p>
      </article>
    `);
    const result = extract(document.body, { minWords: 100, skipAnchorCheck: true });

    // El blockquote es la unidad semántica: se anota entero, no su <p> interior,
    // para que el mismo texto no se resuma (ni se cobre) dos veces.
    const tags = result.blocks.map((b) => b.element.tagName);
    expect(tags).toEqual(['BLOCKQUOTE', 'P']);
    expect(result.blocks.map((b) => b.element.id)).toEqual(['cita', 'suelto']);

    // El texto de la cita aparece una sola vez en el contexto enviado al modelo.
    const ocurrencias = result.fullText.split('palabra0').length - 1;
    expect(ocurrencias).toBe(2); // una por bloque, sin duplicar la cita
  });

  it('señala degradación cuando no identifica artículo con confianza', () => {
    setBody('<div><p>Texto muy corto.</p></div>');
    const result = extract(document.body, { minWords: 100, skipAnchorCheck: true });
    expect(result.degradeReason).toBe('low-score');
  });

  it('señala degradación si hay mucho texto pero casi ningún bloque elegible', () => {
    // Un solo párrafo enorme dentro de una tabla: mucho texto, sin bloques anotables.
    setBody(`
      <div class="content">
        <table><tr><td>${paragraph(900)}</td></tr></table>
        <p>${paragraph(150)}</p>
      </div>
    `);
    const result = extract(document.body, { minWords: 100, skipAnchorCheck: true });
    expect(result.degradeReason).toBe('too-few-blocks');
  });

  it('devuelve el texto completo del artículo para usarlo como contexto', () => {
    setBody(`
      <article class="post-content">
        <p>Primero con bastantes palabras para pasar el filtro. ${paragraph(120)}</p>
        <p>Segundo bloque distinto. ${paragraph(120)}</p>
      </article>
    `);
    const result = extract(document.body, { minWords: 100, skipAnchorCheck: true });
    expect(result.fullText).toContain('Primero con bastantes palabras');
    expect(result.fullText).toContain('Segundo bloque distinto');
  });

  it('no encuentra contenedor en una página sin texto', () => {
    setBody('<div><img src="x.png" alt="" /></div>');
    const result = extract(document.body, { minWords: 100, skipAnchorCheck: true });
    expect(result.container).toBeNull();
    expect(result.blocks).toHaveLength(0);
  });
});
