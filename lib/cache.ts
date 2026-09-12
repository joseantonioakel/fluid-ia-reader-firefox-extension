import type { Config, ProviderId } from './types';
import { PROMPT_VERSION } from './pipeline/prompts';

/**
 * Caché de resúmenes en IndexedDB.
 * Se guarda el resumen y un hash del original: el texto de la página nunca se persiste.
 */

const DB_NAME = 'lector-fluido';
const DB_VERSION = 1;
const STORE = 'summaries';

export interface CacheEntry {
  key: string;
  summary: string;
  createdAt: number;
  lastAccessedAt: number;
  bytes: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('lastAccessedAt', 'lastAccessedAt');
        store.createIndex('createdAt', 'createdAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = fn(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

async function sha256(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const TRACKING_PARAMS = /^(utm_|fbclid|gclid|mc_cid|mc_eid|igshid|ref_?src)/i;

export function normalizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.hash = '';
    const params = [...url.searchParams.keys()];
    for (const key of params) {
      if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

/**
 * Huella de la configuración que afecta al resultado. Cambiarla invalida la caché,
 * de modo que ajustar formato, ratio, idioma, proveedor o modelo regenera resúmenes.
 */
export function configFingerprint(
  config: Config,
  provider: ProviderId,
  model: string,
  language: string,
): string {
  return [
    `v${PROMPT_VERSION}`,
    config.summaryFormat,
    config.summaryRatio.toFixed(3),
    language,
    provider,
    model,
  ].join('|');
}

export async function cacheKey(
  url: string,
  blockText: string,
  fingerprint: string,
): Promise<string> {
  return sha256(`${normalizeUrl(url)}|${await sha256(blockText)}|${fingerprint}`);
}

export async function getCached(key: string): Promise<string | null> {
  try {
    const entry = await tx<CacheEntry | undefined>('readonly', (store) => store.get(key));
    if (!entry) return null;
    // Refrescar el acceso para el LRU, sin bloquear la lectura.
    void tx('readwrite', (store) => store.put({ ...entry, lastAccessedAt: Date.now() }));
    return entry.summary;
  } catch {
    return null;
  }
}

export async function putCached(key: string, summary: string): Promise<void> {
  try {
    const entry: CacheEntry = {
      key,
      summary,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      bytes: summary.length * 2 + key.length,
    };
    await tx('readwrite', (store) => store.put(entry));
  } catch {
    // La caché es un acelerador: si falla, el pipeline sigue.
  }
}

export async function getAllEntries(): Promise<CacheEntry[]> {
  try {
    return await tx<CacheEntry[]>('readonly', (store) => store.getAll());
  } catch {
    return [];
  }
}

export async function clearCache(): Promise<void> {
  await tx('readwrite', (store) => store.clear());
}

export async function cacheStats(): Promise<{ entries: number; bytes: number }> {
  const all = await getAllEntries();
  return { entries: all.length, bytes: all.reduce((sum, e) => sum + e.bytes, 0) };
}

/** Purga por TTL y expulsión LRU al superar el tope de tamaño. */
export async function pruneCache(config: Config): Promise<void> {
  const all = await getAllEntries();
  if (all.length === 0) return;

  const ttlMs = config.cacheTtlDays * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - ttlMs;
  const expired = all.filter((e) => e.createdAt < cutoff);
  for (const entry of expired) {
    await tx('readwrite', (store) => store.delete(entry.key));
  }

  const remaining = all.filter((e) => e.createdAt >= cutoff);
  const maxBytes = config.maxCacheMb * 1024 * 1024;
  let total = remaining.reduce((sum, e) => sum + e.bytes, 0);
  if (total <= maxBytes) return;

  const byLru = [...remaining].sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
  for (const entry of byLru) {
    if (total <= maxBytes) break;
    await tx('readwrite', (store) => store.delete(entry.key));
    total -= entry.bytes;
  }
}
