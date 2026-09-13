import { browser } from '#imports';
import type { Config, ProviderId } from './types';

const CONFIG_KEY = 'config';
const SECRETS_KEY = 'secrets';

export const DEFAULT_CONFIG: Config = {
  minWords: 100,
  summaryRatio: 0.125,
  summaryFormat: 'proportional',
  language: 'auto',
  provider: 'browser-builtin',
  fallbackProvider: 'gemini-free',
  models: {
    'gemini-free': 'gemini-2.5-flash-lite',
    gemini: 'gemini-2.5-flash',
    openrouter: 'google/gemini-2.5-flash-lite',
    openai: 'gpt-5-mini',
    anthropic: 'claude-sonnet-5',
  },
  callStrategy: 'auto',
  batchSize: null,
  extractionMode: 'auto',
  readerModeOrigins: [],
  enabledOrigins: [],
  cloudConsentGiven: false,
  geminiFreeConsentGiven: false,
  cacheTtlDays: 30,
  maxCacheMb: 50,
  debugLogging: true,
  detectFallacies: true,
};

/** Rangos de validación. Mantener alineado con la página de opciones. */
const LIMITS = {
  minWords: [20, 1000],
  summaryRatio: [0.05, 0.5],
  cacheTtlDays: [1, 365],
  maxCacheMb: [5, 500],
} as const;

function clamp(value: number, [min, max]: readonly [number, number]): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function validateConfig(raw: Partial<Config>): Partial<Config> {
  const out: Partial<Config> = { ...raw };
  if (typeof raw.minWords === 'number') out.minWords = Math.round(clamp(raw.minWords, LIMITS.minWords));
  if (typeof raw.summaryRatio === 'number') out.summaryRatio = clamp(raw.summaryRatio, LIMITS.summaryRatio);
  if (typeof raw.cacheTtlDays === 'number') out.cacheTtlDays = Math.round(clamp(raw.cacheTtlDays, LIMITS.cacheTtlDays));
  if (typeof raw.maxCacheMb === 'number') out.maxCacheMb = Math.round(clamp(raw.maxCacheMb, LIMITS.maxCacheMb));
  if (raw.batchSize != null) out.batchSize = Math.max(1, Math.round(raw.batchSize));
  return out;
}

export async function getConfig(): Promise<Config> {
  const stored = await browser.storage.local.get(CONFIG_KEY);
  const value = (stored[CONFIG_KEY] ?? {}) as Partial<Config>;
  return { ...DEFAULT_CONFIG, ...value, models: { ...DEFAULT_CONFIG.models, ...(value.models ?? {}) } };
}

export async function setConfig(patch: Partial<Config>): Promise<Config> {
  const current = await getConfig();
  const next: Config = { ...current, ...validateConfig(patch) };
  if (patch.models) next.models = { ...current.models, ...patch.models };
  await browser.storage.local.set({ [CONFIG_KEY]: next });
  return next;
}

/* --------------------------- Credenciales ---------------------------
 * Las claves viven SOLO en storage.local y nunca se envían al content script.
 * Todas las llamadas de red salen del background.
 * ------------------------------------------------------------------- */

type Secrets = Partial<Record<ProviderId, string>>;

export async function getSecret(provider: ProviderId): Promise<string | null> {
  const stored = await browser.storage.local.get(SECRETS_KEY);
  const secrets = (stored[SECRETS_KEY] ?? {}) as Secrets;
  return secrets[provider] ?? null;
}

export async function setSecret(provider: ProviderId, key: string): Promise<void> {
  const stored = await browser.storage.local.get(SECRETS_KEY);
  const secrets = (stored[SECRETS_KEY] ?? {}) as Secrets;
  if (key) secrets[provider] = key;
  else delete secrets[provider];
  await browser.storage.local.set({ [SECRETS_KEY]: secrets });
}

export async function listConfiguredProviders(): Promise<ProviderId[]> {
  const stored = await browser.storage.local.get(SECRETS_KEY);
  const secrets = (stored[SECRETS_KEY] ?? {}) as Secrets;
  return Object.keys(secrets) as ProviderId[];
}

/**
 * Resolución del idioma del resumen.
 * 'auto' → español si aparece entre los idiomas preferidos, si no el de la interfaz.
 */
export function resolveLanguage(config: Config, preferred: readonly string[], uiLanguage: string): string {
  if (config.language !== 'auto') return config.language;
  if (preferred.some((l) => l.toLowerCase().startsWith('es'))) return 'es';
  return uiLanguage.split('-')[0] || 'en';
}
