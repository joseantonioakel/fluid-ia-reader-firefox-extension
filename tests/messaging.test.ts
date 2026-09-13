import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from '#imports';
import { onMessage } from '../lib/messaging';

/**
 * Simula el comportamiento de Chrome, que es el estricto: solo entrega la
 * respuesta si el listener llamó a `sendResponse` y devolvió `true`. Firefox
 * además acepta una promesa devuelta, así que lo que pasa aquí pasa en ambos.
 */
const listeners: unknown[] = [];

function sendLikeChrome(message: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    let answered = false;
    const sendResponse = (response: unknown) => {
      answered = true;
      resolve(response);
    };
    let keepOpen = false;
    for (const listener of listeners) {
      const fn = listener as (m: unknown, s: unknown, r: (x: unknown) => void) => unknown;
      const result = fn(message, { id: 'test' }, sendResponse);
      if (result === true) keepOpen = true;
    }
    // Chrome cierra el canal en cuanto el listener termina sin `true`.
    if (!keepOpen && !answered) resolve(undefined);
  });
}

beforeEach(() => {
  listeners.length = 0;
  vi.spyOn(browser.runtime.onMessage, 'addListener').mockImplementation((listener: unknown) => {
    listeners.push(listener);
  });
});

describe('onMessage', () => {
  it('entrega el valor de una promesa mediante sendResponse, como exige Chrome', async () => {
    onMessage<{ kind: string }>((m) => (m.kind === 'ping' ? Promise.resolve({ alive: true }) : undefined));
    expect(await sendLikeChrome({ kind: 'ping' })).toEqual({ alive: true });
  });

  it('entrega también los valores síncronos', async () => {
    onMessage<{ kind: string }>(() => ({ ok: true }));
    expect(await sendLikeChrome({ kind: 'x' })).toEqual({ ok: true });
  });

  it('un manejador que devuelve undefined no responde: el mensaje no era para él', async () => {
    onMessage(() => undefined);
    expect(await sendLikeChrome({ kind: 'ajeno' })).toBeUndefined();
  });

  it('una promesa rechazada se convierte en respuesta de error en vez de colgar al emisor', async () => {
    onMessage(() => Promise.reject(new Error('se rompió')));
    expect(await sendLikeChrome({ kind: 'x' })).toEqual({ ok: false, error: 'se rompió', code: 'unknown' });
  });

  it('una excepción síncrona también se convierte en respuesta de error', async () => {
    onMessage(() => {
      throw new Error('boom');
    });
    expect(await sendLikeChrome({ kind: 'x' })).toEqual({ ok: false, error: 'boom', code: 'unknown' });
  });

  it('el manejador recibe el mensaje y el emisor', async () => {
    const handler = vi.fn(() => 'ok');
    onMessage(handler);
    await sendLikeChrome({ kind: 'x' });
    expect(handler).toHaveBeenCalledWith({ kind: 'x' }, { id: 'test' });
  });
});
