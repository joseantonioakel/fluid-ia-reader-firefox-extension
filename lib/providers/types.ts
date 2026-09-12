import { t } from '../i18n';
import { createLogger } from '../log';
import type { ArticlePayload, BlockPayload, BlockSummary, ErrorCode, ProviderId, SummaryFormat } from '../types';

const httpLog = createLogger('http');

/**
 * `fetch` instrumentado: registra método, destino, estado y latencia de cada
 * petición a un proveedor, sin volcar nunca la credencial ni el cuerpo completo.
 */
export async function loggedFetch(
  providerId: string,
  url: string,
  init: RequestInit,
  promptChars: number,
): Promise<Response> {
  const started = performance.now();
  const endpoint = (() => {
    try {
      const parsed = new URL(url);
      return `${parsed.host}${parsed.pathname}`;
    } catch {
      return url;
    }
  })();

  httpLog.debug(`→ ${providerId} POST ${endpoint}`, `${promptChars} caracteres de prompt`);
  try {
    const response = await fetch(url, init);
    const ms = Math.round(performance.now() - started);
    const line = `← ${providerId} ${response.status} ${response.statusText} · ${ms} ms`;
    if (response.ok) httpLog.info(line);
    else httpLog.warn(line);
    return response;
  } catch (error) {
    httpLog.error(
      `✗ ${providerId} sin respuesta tras ${Math.round(performance.now() - started)} ms`,
      error,
    );
    throw new ProviderError(
      t('errNetwork', providerId, error instanceof Error ? error.message : String(error)),
      'network',
      true,
    );
  }
}

export interface RateLimit {
  concurrency: number;
  requestsPerMinute: number | null;
  requestsPerDay: number | null;
}

export interface BatchRequest {
  article: ArticlePayload;
  blocks: BlockPayload[];
  format: SummaryFormat;
  language: string;
  includeTldr: boolean;
  apiKey: string | null;
  model: string;
  signal: AbortSignal;
}

export interface BatchResponse {
  tldr: string;
  summaries: BlockSummary[];
}

export interface BlockRequest {
  block: BlockPayload;
  outline: string;
  previousText: string | null;
  format: SummaryFormat;
  language: string;
  apiKey: string | null;
  model: string;
  signal: AbortSignal;
}

export interface OutlineRequest {
  article: ArticlePayload;
  language: string;
  apiKey: string | null;
  model: string;
  signal: AbortSignal;
}

export interface SummarizerProvider {
  id: ProviderId;
  displayName: string;
  strategy: 'batch' | 'per-block';
  requiresApiKey: boolean;
  requiresCloudConsent: boolean;
  supportsStructuredOutput: boolean;
  rateLimit: RateLimit;
  /** Presupuesto prudente de tokens de salida por llamada batch. */
  outputTokenBudget: number;

  isAvailable(): Promise<{ available: boolean; reason?: string }>;
  summarizeBatch?(req: BatchRequest): Promise<BatchResponse>;
  buildOutline?(req: OutlineRequest): Promise<string>;
  summarizeBlock?(req: BlockRequest): Promise<string>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** Traduce un status HTTP al código de error del dominio. */
export function errorFromStatus(status: number, body: string): ProviderError {
  const detail = body.slice(0, 300);
  if (status === 401 || status === 403) {
    return new ProviderError(t('errUnauthorizedStatus', status, detail), 'unauthorized', false);
  }
  if (status === 402) {
    return new ProviderError(t('errQuotaStatus', status, detail), 'quota', false);
  }
  if (status === 429) {
    return new ProviderError(t('errRateLimitDetail', detail), 'rate-limit', true);
  }
  if (status >= 500) {
    return new ProviderError(t('errProviderFailed', status, detail), 'network', true);
  }
  return new ProviderError(t('errStatus', status, detail), 'unknown', false);
}

/**
 * Extrae JSON de una respuesta que puede venir envuelta en ```json … ```.
 * Solo se usa donde no hay decodificación restringida disponible.
 */
export function parseJsonLoose(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // continúa
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // continúa
    }
  }
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch {
      // continúa
    }
  }
  throw new ProviderError(t('errInvalidJson'), 'empty-response', true);
}

export function coerceBatchResponse(value: unknown): BatchResponse {
  if (typeof value !== 'object' || value === null) {
    throw new ProviderError(t('errUnexpectedShape'), 'empty-response', true);
  }
  const obj = value as Record<string, unknown>;
  const rawSummaries = Array.isArray(obj.summaries) ? obj.summaries : [];
  const summaries: BlockSummary[] = [];
  for (const entry of rawSummaries) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const id = typeof e.id === 'number' ? e.id : Number.parseInt(String(e.id), 10);
    const summary = typeof e.summary === 'string' ? e.summary.trim() : '';
    if (Number.isFinite(id) && summary) summaries.push({ id, summary });
  }
  if (summaries.length === 0) {
    throw new ProviderError(t('errNoSummaries'), 'empty-response', true);
  }
  return { tldr: typeof obj.tldr === 'string' ? obj.tldr.trim() : '', summaries };
}
