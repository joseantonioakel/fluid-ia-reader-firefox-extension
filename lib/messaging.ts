import { browser } from '#imports';

/**
 * Mensajería que funciona igual en Firefox y en Chrome.
 *
 * WXT expone `chrome` tal cual en Chrome, sin polyfill. Y en Chrome un listener
 * de `runtime.onMessage` que DEVUELVE una promesa no responde nada: el emisor
 * recibe `undefined`. Solo Firefox entiende ese estilo. El estilo que entienden
 * los dos es el clásico: llamar a `sendResponse` y devolver `true` para
 * mantener el canal abierto hasta que llegue la respuesta.
 *
 * Este envoltorio deja escribir los manejadores con promesas y traduce por
 * debajo al estilo clásico.
 */

type Sender = Parameters<Parameters<typeof browser.runtime.onMessage.addListener>[0]>[1];

export type MessageHandler<M> = (message: M, sender: Sender) => unknown | Promise<unknown>;

/** `undefined` significa "este mensaje no es para mí": el canal se cierra sin responder. */
export function onMessage<M>(handler: MessageHandler<M>): void {
  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse: (r: unknown) => void) => {
    let result: unknown;
    try {
      result = handler(message as M, sender);
    } catch (error) {
      sendResponse(errorResponse(error));
      return false;
    }
    if (result === undefined) return false;
    Promise.resolve(result).then(sendResponse, (error: unknown) => sendResponse(errorResponse(error)));
    return true;
  });
}

/**
 * Un manejador que revienta no puede dejar al emisor esperando para siempre:
 * se le devuelve un error con la misma forma que los del pipeline.
 */
function errorResponse(error: unknown): { ok: false; error: string; code: 'unknown' } {
  return { ok: false, error: error instanceof Error ? error.message : String(error), code: 'unknown' };
}

/**
 * El service worker de Chrome muere a los 30 s sin actividad, y una llamada a
 * un proveedor puede tardar más. Mientras haya trabajo en curso, una llamada
 * trivial a la API de extensiones cada 20 s reinicia ese reloj. En Firefox el
 * background no se apaga así, pero la llamada es inocua.
 */
export function keepAliveWhile(isBusy: () => boolean): void {
  const interval = setInterval(() => {
    if (!isBusy()) {
      clearInterval(interval);
      return;
    }
    void browser.runtime.getPlatformInfo().catch(() => undefined);
  }, 20_000);
}
