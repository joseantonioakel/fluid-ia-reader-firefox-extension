import { beforeEach, describe, expect, it } from 'vitest';
import { extract, groupBlocks } from '../lib/extract/blocks';

function words(n: number, seed = 'p'): string {
  return Array.from({ length: n }, (_, i) => (i % 11 === 10 ? `${seed}${i},` : `${seed}${i}`)).join(' ');
}

/** Construye candidatos a partir de HTML, en el orden del documento. */
function candidatesFrom(html: string): { element: HTMLElement; text: string; words: number }[] {
  document.body.innerHTML = html;
  return Array.from(document.body.querySelectorAll<HTMLElement>('p, li')).map((element) => {
    const count = Number(element.dataset.words ?? '0');
    return { element, text: element.textContent ?? '', words: count };
  });
}

function p(id: string, count: number): string {
  return `<p id="${id}" data-words="${count}">${words(count)}</p>`;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('groupBlocks', () => {
  it('deja solos los párrafos que ya superan el umbral', () => {
    const blocks = groupBlocks(candidatesFrom(p('a', 150) + p('b', 200)), 100);
    expect(blocks).toHaveLength(2);
    expect(blocks.every((b) => !b.merged)).toBe(true);
    expect(blocks.map((b) => b.element.id)).toEqual(['a', 'b']);
  });

  it('fusiona párrafos cortos consecutivos hasta alcanzar el umbral', () => {
    const blocks = groupBlocks(candidatesFrom(p('a', 40) + p('b', 40) + p('c', 40)), 100);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.merged).toBe(true);
    expect(blocks[0]!.words).toBe(120);
    expect(blocks[0]!.elements.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    // El ancla del overlay es el primero del grupo.
    expect(blocks[0]!.element.id).toBe('a');
  });

  it('une los textos con separación de párrafo', () => {
    document.body.innerHTML = '<p id="a">Uno.</p><p id="b">Dos.</p>';
    const [a, b] = Array.from(document.body.querySelectorAll<HTMLElement>('p'));
    const blocks = groupBlocks(
      [
        { element: a!, text: 'Uno.', words: 60 },
        { element: b!, text: 'Dos.', words: 60 },
      ],
      100,
    );
    expect(blocks[0]!.text).toBe('Uno.\n\nDos.');
  });

  it('cierra el grupo en cuanto alcanza el umbral, sin acumular de más', () => {
    // 6 párrafos de 60 palabras: dos grupos de dos, y el resto vuelve a agrupar.
    const blocks = groupBlocks(
      candidatesFrom(p('a', 60) + p('b', 60) + p('c', 60) + p('d', 60)),
      100,
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.elements.map((e) => e.id)).toEqual(['a', 'b']);
    expect(blocks[1]!.elements.map((e) => e.id)).toEqual(['c', 'd']);
  });

  it('el resto que no llega al umbral se une al bloque adyacente', () => {
    const blocks = groupBlocks(candidatesFrom(p('a', 150) + p('b', 20) + p('c', 20)), 100);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.elements.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect(blocks[0]!.words).toBe(190);
  });

  it('un párrafo largo interrumpe la serie de cortos', () => {
    const blocks = groupBlocks(candidatesFrom(p('a', 50) + p('b', 150) + p('c', 50) + p('d', 60)), 100);
    // 'a' (50) no se sostiene solo y su único vecino es 'b'; 'c'+'d' se fusionan.
    expect(blocks.map((b) => b.elements.map((e) => e.id))).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('un corto suelto se une al vecino adyacente con menos palabras', () => {
    const blocks = groupBlocks(candidatesFrom(p('a', 300) + p('b', 20) + p('c', 150)), 100);
    expect(blocks.map((b) => b.elements.map((e) => e.id))).toEqual([['a'], ['b', 'c']]);
    // El ancla del bloque rescatado es el primero en orden de documento.
    expect(blocks[1]!.element.id).toBe('b');
  });

  it('en empate de palabras el corto se une al anterior', () => {
    const blocks = groupBlocks(candidatesFrom(p('a', 150) + p('b', 20) + p('c', 150)), 100);
    expect(blocks.map((b) => b.elements.map((e) => e.id))).toEqual([['a', 'b'], ['c']]);
  });

  it('NO fusiona a través de un encabezado: el salto de tema es real', () => {
    const blocks = groupBlocks(
      candidatesFrom(p('a', 60) + '<h2>Otra sección</h2>' + p('b', 60)),
      100,
    );
    // No son hermanos inmediatos, así que no se juntan; pero tampoco se pierden.
    expect(blocks.map((b) => b.elements.map((e) => e.id))).toEqual([['a'], ['b']]);
    expect(blocks.every((b) => !b.merged)).toBe(true);
  });

  it('NO fusiona a través de una figura intercalada', () => {
    const blocks = groupBlocks(
      candidatesFrom(p('a', 60) + '<figure><img src="x.png" alt=""></figure>' + p('b', 60)),
      100,
    );
    expect(blocks.map((b) => b.elements.map((e) => e.id))).toEqual([['a'], ['b']]);
  });

  it('NO fusiona párrafos de contenedores distintos', () => {
    const blocks = groupBlocks(
      candidatesFrom(`<div>${p('a', 60)}</div><div>${p('b', 60)}</div>`),
      100,
    );
    expect(blocks.map((b) => b.elements.map((e) => e.id))).toEqual([['a'], ['b']]);
  });

  it('un corto sin ningún vecino adyacente se resume solo antes que perderse', () => {
    const blocks = groupBlocks(candidatesFrom(p('a', 150) + '<h2>Sección</h2>' + p('b', 30) + '<h2>Otra</h2>'), 100);
    expect(blocks.map((b) => b.elements.map((e) => e.id))).toEqual([['a'], ['b']]);
  });

  it('fusiona elementos de lista consecutivos', () => {
    const blocks = groupBlocks(
      candidatesFrom('<ul><li data-words="40">a</li><li data-words="40">b</li><li data-words="40">c</li></ul>'),
      100,
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.elements).toHaveLength(3);
  });

  it('rescata el resto de dos o más cortos si suman al menos la mitad del umbral', () => {
    const blocks = groupBlocks(candidatesFrom(p('a', 150) + p('b', 30) + p('c', 30)), 100);
    expect(blocks).toHaveLength(2);
    expect(blocks[1]!.merged).toBe(true);
    expect(blocks[1]!.words).toBe(60);
    expect(blocks[1]!.elements.map((e) => e.id)).toEqual(['b', 'c']);
  });

  it('un corto suelto no se sostiene solo aunque supere la mitad del umbral', () => {
    const blocks = groupBlocks(candidatesFrom(p('a', 150) + p('b', 80)), 100);
    expect(blocks.map((b) => b.elements.map((e) => e.id))).toEqual([['a', 'b']]);
  });

  it('rescata un grupo cortado por un encabezado si tiene sustancia', () => {
    const blocks = groupBlocks(
      candidatesFrom(p('a', 40) + p('b', 40) + '<h2>Otra sección</h2>' + p('c', 40) + p('d', 40)),
      100,
    );
    expect(blocks.map((b) => b.elements.map((e) => e.id))).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('la acumulación cierra el grupo a los cinco párrafos', () => {
    const html = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((id) => p(id, 15)).join('');
    const blocks = groupBlocks(candidatesFrom(html), 100);
    // Dos grupos de cinco (75 palabras cada uno, que se sostienen solos).
    expect(blocks.map((b) => b.elements.map((e) => e.id))).toEqual([
      ['a', 'b', 'c', 'd', 'e'],
      ['f', 'g', 'h', 'i', 'j'],
    ]);
  });

  it('el rescate puede superar el tope antes que dejar un párrafo fuera', () => {
    const html = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => p(id, 15)).join('');
    const blocks = groupBlocks(candidatesFrom(html), 100);
    // a..e se cierran por el tope; f+g (30) no se sostienen y su único vecino es a..e.
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.elements.map((e) => e.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  });

  it('dos restos débiles adyacentes acaban juntos', () => {
    const html = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => p(id, 8)).join('');
    const blocks = groupBlocks(candidatesFrom(html), 100);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.elements).toHaveLength(6);
    expect(blocks[0]!.words).toBe(48);
  });

  it('asigna ids contiguos en orden de documento', () => {
    const blocks = groupBlocks(candidatesFrom(p('a', 150) + p('b', 60) + p('c', 60) + p('d', 200)), 100);
    expect(blocks.map((b) => b.id)).toEqual([0, 1, 2]);
  });
});

describe('extract con fusión', () => {
  it('agrupa los párrafos cortos de un artículo real', () => {
    document.body.innerHTML = `
      <article class="post-content">
        <p id="intro">${words(180, 'intro')}</p>
        <p id="c1">${words(45, 'c1')}</p>
        <p id="c2">${words(45, 'c2')}</p>
        <p id="c3">${words(45, 'c3')}</p>
        <p id="fin">${words(160, 'fin')}</p>
      </article>`;

    const result = extract(document.body, { minWords: 100, skipAnchorCheck: true });
    const grupos = result.blocks.map((b) => b.elements.map((e) => e.id));

    // c1+c2 alcanzan 90 < 100, así que entra también c3.
    expect(grupos).toEqual([['intro'], ['c1', 'c2', 'c3'], ['fin']]);
    expect(result.blocks[1]!.merged).toBe(true);
  });

  it('sin fusión, esos párrafos cortos se habrían perdido', () => {
    document.body.innerHTML = `
      <article class="post-content">
        <p>${words(180, 'largo')}</p>
        <p id="c1">${words(60, 'c1')}</p>
        <p id="c2">${words(60, 'c2')}</p>
      </article>`;

    const result = extract(document.body, { minWords: 100, skipAnchorCheck: true });
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[1]!.elements.map((e) => e.id)).toEqual(['c1', 'c2']);
  });
});
