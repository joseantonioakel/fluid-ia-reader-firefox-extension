import { browser } from '#imports';

/**
 * Logging para depurar la extensión desde la consola del navegador.
 *
 * Dónde mirar cada consola:
 *   - content script → DevTools de la propia página (F12)
 *   - background     → Firefox: about:debugging → Este Firefox → Inspeccionar
 *                      Chrome:  chrome://extensions → "service worker"
 *   - popup/opciones → clic derecho sobre la ventana → Inspeccionar
 *
 * `warn` y `error` se emiten SIEMPRE. `debug`/`info` dependen del flag
 * `debugLogging`, activo por defecto mientras la extensión esté en desarrollo.
 */

const PREFIX = '[Lector Fluido]';
const STORAGE_KEY = 'debugLogging';

let enabled = true;

export function setLogEnabled(value: boolean): void {
  enabled = value;
}

export function isLogEnabled(): boolean {
  return enabled;
}

/**
 * Lee el flag de storage y se suscribe a sus cambios, para poder activar o
 * desactivar el detalle sin recargar la extensión.
 */
export async function initLogging(scope: string): Promise<void> {
  try {
    const stored = await browser.storage.local.get('config');
    const config = stored.config as { debugLogging?: boolean } | undefined;
    enabled = config?.debugLogging ?? true;
  } catch {
    enabled = true;
  }

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.config) return;
    const next = changes.config.newValue as { debugLogging?: boolean } | undefined;
    enabled = next?.debugLogging ?? true;
  });

  if (enabled) {
    console.log(
      `%c${PREFIX} ${scope} activo`,
      'color:#2f6bff;font-weight:bold',
      `· v${browser.runtime.getManifest().version}`,
    );
  }
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  /** Agrupa un objeto de datos legible en la consola. */
  table(label: string, data: Record<string, unknown>): void;
  /** Mide y registra la duración de una operación. */
  timed<T>(label: string, fn: () => Promise<T>): Promise<T>;
  /** Deriva un logger hijo con contexto adicional (p. ej. un id de ejecución). */
  child(suffix: string): Logger;
}

export function createLogger(scope: string): Logger {
  const tag = `${PREFIX} ${scope}`;

  const logger: Logger = {
    debug(...args) {
      if (enabled) console.debug(tag, ...args);
    },
    info(...args) {
      if (enabled) console.log(tag, ...args);
    },
    warn(...args) {
      console.warn(tag, ...args);
    },
    error(...args) {
      console.error(tag, ...args);
    },
    table(label, data) {
      if (!enabled) return;
      console.groupCollapsed(`${tag} ${label}`);
      console.table(data);
      console.groupEnd();
    },
    async timed(label, fn) {
      const started = performance.now();
      try {
        const result = await fn();
        if (enabled) console.log(tag, `${label} ✓ ${Math.round(performance.now() - started)} ms`);
        return result;
      } catch (error) {
        console.warn(tag, `${label} ✗ ${Math.round(performance.now() - started)} ms`, error);
        throw error;
      }
    },
    child(suffix) {
      return createLogger(`${scope}:${suffix}`);
    },
  };

  return logger;
}

/** Identificador corto para correlacionar los mensajes de una misma ejecución. */
export function newRunId(): string {
  return Math.random().toString(36).slice(2, 7);
}
