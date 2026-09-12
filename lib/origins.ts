import { browser } from '#imports';
import { createLogger } from './log';

const log = createLogger('origins');

/**
 * Los host permissions son opcionales y se conceden por dominio. Por eso el
 * content script NO se declara en el manifiesto: se registra en tiempo de
 * ejecución solo para los orígenes que el usuario ha habilitado.
 */

const SCRIPT_ID = 'lector-fluido-content';
const CONTENT_JS = '/content-scripts/content.js' as const;

export function originPatternFor(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return `${parsed.protocol}//${parsed.hostname}/*`;
  } catch {
    return null;
  }
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export async function hasPermission(pattern: string): Promise<boolean> {
  try {
    return await browser.permissions.contains({ origins: [pattern] });
  } catch {
    return false;
  }
}

/**
 * Sincroniza el content script registrado con la lista de orígenes habilitados,
 * descartando aquellos cuyo permiso ya no esté concedido.
 */
export async function syncContentScripts(origins: string[]): Promise<string[]> {
  const granted: string[] = [];
  for (const origin of origins) {
    if (await hasPermission(origin)) granted.push(origin);
  }

  const existing = await browser.scripting
    .getRegisteredContentScripts({ ids: [SCRIPT_ID] })
    .catch(() => [] as { id: string }[]);

  if (granted.length === 0) {
    if (existing.length > 0) {
      await browser.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] }).catch(() => undefined);
    }
    return granted;
  }

  const definition = {
    id: SCRIPT_ID,
    matches: granted,
    js: [CONTENT_JS],
    runAt: 'document_idle' as const,
    allFrames: false,
    persistAcrossSessions: true,
  };

  try {
    if (existing.length > 0) {
      await browser.scripting.updateContentScripts([definition]);
      log.info('content script actualizado para', granted);
    } else {
      await browser.scripting.registerContentScripts([definition]);
      log.info('content script registrado para', granted);
    }
  } catch (error) {
    log.error('No se pudo registrar el content script:', error, definition);
  }
  return granted;
}

/** Inyecta el content script en una pestaña ya abierta, sin esperar a recargarla. */
export async function injectIntoTab(tabId: number): Promise<boolean> {
  try {
    await browser.scripting.executeScript({ target: { tabId }, files: [CONTENT_JS] });
    log.info('inyectado en la pestaña', tabId);
    return true;
  } catch (error) {
    log.error('No se pudo inyectar en la pestaña', tabId, error);
    return false;
  }
}

/** Patrones actualmente registrados, para el diagnóstico. */
export async function listRegisteredScripts(): Promise<string[]> {
  try {
    const scripts = await browser.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    return scripts.flatMap((s) => s.matches ?? []);
  } catch (error) {
    log.warn('no se pudieron listar los scripts registrados', error);
    return [];
  }
}
