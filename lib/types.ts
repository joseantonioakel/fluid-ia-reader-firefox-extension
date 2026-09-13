/** Tipos compartidos entre content script, background y páginas de la extensión. */

export type ProviderId =
  | 'browser-builtin'
  | 'gemini-free'
  | 'gemini'
  | 'openrouter'
  | 'openai'
  | 'anthropic';

export type SummaryFormat = 'proportional' | 'sentences' | 'bullets';
export type CallStrategy = 'auto' | 'batch' | 'per-block';
export type ExtractionMode = 'auto' | 'inplace' | 'reader';

export interface Config {
  /** Umbral mínimo de palabras para que un bloque reciba overlay. */
  minWords: number;
  /** Proporción objetivo del resumen respecto al original. */
  summaryRatio: number;
  summaryFormat: SummaryFormat;
  /** 'auto' = español si está entre navigator.languages, si no el idioma de la UI. */
  language: 'auto' | string;
  provider: ProviderId;
  fallbackProvider: ProviderId | null;
  /** Modelo por proveedor. */
  models: Partial<Record<ProviderId, string>>;
  callStrategy: CallStrategy;
  /** Bloques por llamada en estrategia batch. null = sin límite (una sola llamada). */
  batchSize: number | null;
  extractionMode: ExtractionMode;
  /** Dominios donde se fuerza el Modo B. */
  readerModeOrigins: string[];
  /** Orígenes con la extensión habilitada. */
  enabledOrigins: string[];
  cloudConsentGiven: boolean;
  /** Consentimiento específico del free tier de Gemini (usa datos para entrenar). */
  geminiFreeConsentGiven: boolean;
  cacheTtlDays: number;
  maxCacheMb: number;
  /** Detalle de depuración en la consola. Activo por defecto en desarrollo. */
  debugLogging: boolean;
  /** Pedir al modelo que señale falacias lógicas en el texto original de cada bloque. */
  detectFallacies: boolean;
}

export const SUMMARY_MIN_WORDS = 15;
export const SUMMARY_MAX_WORDS = 100;
/** Si el resumen supera esta fracción del original, el bloque no recibe overlay. */
export const MAX_COMPRESSION_RATIO = 0.6;

export interface BlockPayload {
  id: number;
  text: string;
  words: number;
  targetWords: number;
}

export interface ArticlePayload {
  title: string;
  /** Texto completo del artículo, usado como contexto en la estrategia batch. */
  fullText: string;
  blocks: BlockPayload[];
  url: string;
  lang: string;
}

/** Falacia lógica detectada en el texto ORIGINAL de un bloque. */
export interface Fallacy {
  /** Nombre de la falacia, en el idioma del resumen. */
  name: string;
  /** Fragmento literal del bloque donde se incurre en ella. */
  quote: string;
  /** Por qué el razonamiento falla. */
  explanation: string;
}

export interface BlockSummary {
  id: number;
  summary: string;
  /** Ausente o vacío cuando no se detectó ninguna, o cuando el proveedor no las busca. */
  fallacies?: Fallacy[];
}

export interface SummarizeOk {
  ok: true;
  tldr: string | null;
  summaries: BlockSummary[];
  /** Bloques que fallaron individualmente. */
  failed: { id: number; error: string }[];
  providerUsed: ProviderId;
  /** True si se usó el proveedor de respaldo. */
  usedFallback: boolean;
  strategyUsed: 'batch' | 'per-block';
  fromCache: number;
  calls: number;
}

export interface SummarizeErr {
  ok: false;
  error: string;
  code: ErrorCode;
}

export type ErrorCode =
  | 'no-provider'
  | 'no-consent'
  | 'unauthorized'
  | 'quota'
  | 'rate-limit'
  | 'network'
  | 'empty-response'
  | 'unavailable'
  | 'unknown';

export type SummarizeResult = SummarizeOk | SummarizeErr;

/* ---------------------------- Mensajería ---------------------------- */

export type Message =
  | { kind: 'summarize'; article: ArticlePayload }
  | { kind: 'get-config' }
  | { kind: 'set-config'; patch: Partial<Config> }
  | { kind: 'get-status' }
  | { kind: 'provider-status' }
  | { kind: 'clear-cache' }
  | { kind: 'cache-stats' }
  | { kind: 'start-oauth'; provider: 'openrouter' }
  | { kind: 'set-secret'; provider: ProviderId; key: string }
  | { kind: 'test-provider'; provider: ProviderId }
  | { kind: 'open-options' }
  | { kind: 'run-on-tab' }
  | { kind: 'partial'; summaries: BlockSummary[] }
  | { kind: 'ping' }
  | { kind: 'debug-extract' }
  | { kind: 'diagnose'; tabId?: number }
  // El popup NO es una pestaña: `sender.tab` llega undefined, así que el tabId
  // debe viajar explícitamente para poder inyectar en la página activa.
  | { kind: 'toggle-origin'; origin: string; enabled: boolean; tabId?: number };

export interface Diagnosis {
  version: string;
  url: string | null;
  originPattern: string | null;
  permissionGranted: boolean;
  originEnabled: boolean;
  contentScriptAlive: boolean;
  registeredScripts: string[];
  provider: ProviderId;
  providerAvailable: boolean;
  providerConfigured: boolean;
  providerReason?: string;
  consentOk: boolean;
  /** Estado de la extracción según el content script, si respondió. */
  extraction: Record<string, unknown> | null;
  problems: string[];
}

export interface ProviderStatus {
  id: ProviderId;
  displayName: string;
  available: boolean;
  configured: boolean;
  reason?: string;
}
