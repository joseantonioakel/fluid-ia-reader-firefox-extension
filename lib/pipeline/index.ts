import { t } from '../i18n';
import { cacheKey, configFingerprint, getCached, putCached } from '../cache';
import type { Logger } from '../log';
import { getProvider } from '../providers';
import { ProviderError, type SummarizerProvider } from '../providers/types';
import type {
  ArticlePayload,
  BlockPayload,
  BlockSummary,
  Config,
  ErrorCode,
  ProviderId,
  SummarizeResult,
} from '../types';
import { compressesEnough, countWords } from '../words';
import { getScheduler, withRetry } from './scheduler';

export interface PipelineDeps {
  getSecret(provider: ProviderId): Promise<string | null>;
  onPartial?(summaries: BlockSummary[]): void;
  signal: AbortSignal;
  log?: Logger;
}

const noopLog: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  table() {},
  async timed(_label, fn) {
    return fn();
  },
  child() {
    return noopLog;
  },
};

interface Attempt {
  provider: SummarizerProvider;
  apiKey: string | null;
  model: string;
}

const TOKENS_PER_WORD = 1.6;

function estimateOutputTokens(blocks: BlockPayload[]): number {
  return Math.round(blocks.reduce((sum, b) => sum + b.targetWords, 0) * TOKENS_PER_WORD) + 200;
}

/**
 * Divide los bloques en lotes. Con batchSize null se intenta una sola llamada,
 * y solo se parte si la salida estimada excede el presupuesto del proveedor.
 */
export function planBatches(
  blocks: BlockPayload[],
  batchSize: number | null,
  outputTokenBudget: number,
): BlockPayload[][] {
  if (blocks.length === 0) return [];
  const size = batchSize ?? blocks.length;
  const chunks: BlockPayload[][] = [];
  for (let i = 0; i < blocks.length; i += size) {
    chunks.push(blocks.slice(i, i + size));
  }

  const split = (chunk: BlockPayload[]): BlockPayload[][] => {
    if (chunk.length <= 1) return [chunk];
    if (estimateOutputTokens(chunk) <= outputTokenBudget) return [chunk];
    const mid = Math.ceil(chunk.length / 2);
    return [...split(chunk.slice(0, mid)), ...split(chunk.slice(mid))];
  };

  return chunks.flatMap(split);
}

function isRetryable(error: unknown): boolean {
  return error instanceof ProviderError ? error.retryable : false;
}

function codeOf(error: unknown): ErrorCode {
  return error instanceof ProviderError ? error.code : 'unknown';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Aplica la regla de descarte por compresión insuficiente. */
function keepIfCompresses(summary: string, block: BlockPayload): boolean {
  return compressesEnough(countWords(summary), block.words);
}

export async function summarizeArticle(
  article: ArticlePayload,
  config: Config,
  language: string,
  deps: PipelineDeps,
): Promise<SummarizeResult> {
  const log = deps.log ?? noopLog;
  const attempts = await resolveAttempts(config, deps);
  if (attempts.length === 0) {
    log.error(
      'ningún proveedor utilizable: revisa credencial y consentimiento en Opciones ' +
        '(los motivos exactos van en el aviso anterior).',
    );
    return { ok: false, error: t('errNoProviderConfigured'), code: 'no-provider' };
  }

  /* ---------------------- 1. Caché ---------------------- */
  const primary = attempts[0]!;
  const fingerprint = configFingerprint(config, primary.provider.id, primary.model, language);
  const cached: BlockSummary[] = [];
  const pending: BlockPayload[] = [];
  const keyByBlock = new Map<number, string>();

  for (const block of article.blocks) {
    const key = await cacheKey(article.url, block.text, fingerprint);
    keyByBlock.set(block.id, key);
    const hit = await getCached(key);
    if (hit) cached.push({ id: block.id, summary: hit.summary, ...(hit.fallacies.length ? { fallacies: hit.fallacies } : {}) });
    else pending.push(block);
  }

  log.info('caché', { hits: cached.length, pendientes: pending.length, huella: fingerprint });

  if (pending.length === 0) {
    return {
      ok: true,
      tldr: null,
      summaries: cached,
      failed: [],
      providerUsed: primary.provider.id,
      usedFallback: false,
      strategyUsed: primary.provider.strategy,
      fromCache: cached.length,
      calls: 0,
    };
  }
  if (cached.length > 0) deps.onPartial?.(cached);

  /* ------------- 2. Escalera de degradación ------------- */
  let lastError: unknown = null;

  for (let i = 0; i < attempts.length; i += 1) {
    const attempt = attempts[i]!;
    const usedFallback = i > 0;
    const strategy = resolveStrategy(config, attempt.provider);
    log.info(
      `intento ${i + 1}/${attempts.length}: ${attempt.provider.id} · estrategia ${strategy}` +
        (usedFallback ? ' (RESPALDO)' : ''),
    );
    try {
      const result =
        strategy === 'batch'
          ? await runBatch(article, pending, attempt, config, language, deps)
          : await runPerBlock(article, pending, attempt, config, language, deps);

      const kept: BlockSummary[] = [];
      const inventados: number[] = [];
      const pocaCompresión: { id: number; resumen: number; original: number }[] = [];
      for (const summary of result.summaries) {
        const block = pending.find((b) => b.id === summary.id);
        if (!block) {
          inventados.push(summary.id); // id que no existe: se ignora ese resumen
          continue;
        }
        if (!keepIfCompresses(summary.summary, block)) {
          pocaCompresión.push({
            id: block.id,
            resumen: countWords(summary.summary),
            original: block.words,
          });
          continue;
        }
        kept.push(summary);
        const key = keyByBlock.get(summary.id);
        if (key) void putCached(key, summary.summary, summary.fallacies ?? []);
      }
      if (inventados.length) log.warn('el modelo devolvió ids inexistentes', inventados);
      if (pocaCompresión.length) log.info('descartados por compresión insuficiente', pocaCompresión);

      const answered = new Set(result.summaries.map((s) => s.id));
      const failed = [
        ...result.failed,
        ...pending
          .filter((b) => !answered.has(b.id))
          .map((b) => ({ id: b.id, error: t('blockNoSummary') })),
      ];

      return {
        ok: true,
        tldr: result.tldr,
        summaries: [...cached, ...kept],
        failed,
        providerUsed: attempt.provider.id,
        usedFallback,
        strategyUsed: result.strategyUsed,
        fromCache: cached.length,
        calls: result.calls,
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      lastError = error;
      const code = codeOf(error);
      log.warn(`intento con ${attempt.provider.id} falló [${code}]:`, messageOf(error));
      // Un fallo de configuración no se arregla reintentando con otro modelo del mismo tipo,
      // pero sí puede resolverlo el proveedor de respaldo: seguimos la escalera.
      if (code === 'no-provider' && i === attempts.length - 1) break;
    }
  }

  return { ok: false, error: messageOf(lastError), code: codeOf(lastError) };
}

function resolveStrategy(config: Config, provider: SummarizerProvider): 'batch' | 'per-block' {
  if (provider.strategy === 'per-block') return 'per-block'; // forzada por el proveedor
  if (config.callStrategy === 'per-block') return 'per-block';
  return 'batch';
}

/**
 * Selecciona proveedor principal y respaldo, **registrando el motivo de cada
 * descarte**. Sin esto, "no hay proveedor configurado" es indepurable.
 */
async function resolveAttempts(config: Config, deps: PipelineDeps): Promise<Attempt[]> {
  const log = deps.log ?? noopLog;
  const ids: ProviderId[] = [config.provider];
  if (config.fallbackProvider && config.fallbackProvider !== config.provider) {
    ids.push(config.fallbackProvider);
  }

  const attempts: Attempt[] = [];
  const rejected: Record<string, string> = {};

  for (const id of ids) {
    const provider = getProvider(id);
    if (!provider) {
      rejected[id] = 'proveedor desconocido';
      continue;
    }
    const availability = await provider.isAvailable();
    if (!availability.available) {
      rejected[id] = `no disponible: ${availability.reason ?? 'sin motivo'}`;
      continue;
    }
    const apiKey = provider.requiresApiKey ? await deps.getSecret(id) : null;
    if (provider.requiresApiKey && !apiKey) {
      rejected[id] = 'falta la credencial (configúrala en Opciones)';
      continue;
    }
    if (provider.requiresCloudConsent && !config.cloudConsentGiven) {
      rejected[id] = 'falta el consentimiento de envío a la nube (Opciones → Privacidad)';
      continue;
    }
    if (id === 'gemini-free' && !config.geminiFreeConsentGiven) {
      rejected[id] = 'falta el consentimiento específico del free tier de Gemini';
      continue;
    }
    attempts.push({ provider, apiKey, model: config.models[id] ?? '' });
  }

  if (Object.keys(rejected).length > 0) log.warn('proveedores descartados', rejected);
  log.info(
    'proveedores utilizables',
    attempts.map((a) => `${a.provider.id} (${a.model || 'modelo por defecto'})`),
  );
  return attempts;
}

interface RunResult {
  tldr: string | null;
  summaries: BlockSummary[];
  failed: { id: number; error: string }[];
  strategyUsed: 'batch' | 'per-block';
  calls: number;
}

/* --------------------------- Estrategia batch --------------------------- */

async function runBatch(
  article: ArticlePayload,
  blocks: BlockPayload[],
  attempt: Attempt,
  config: Config,
  language: string,
  deps: PipelineDeps,
): Promise<RunResult> {
  const { provider } = attempt;
  const log = deps.log ?? noopLog;
  if (!provider.summarizeBatch) throw new ProviderError(t('errNoBatchMode'), 'unavailable', false);

  const scheduler = getScheduler(provider.id, provider.rateLimit);
  const batches = planBatches(blocks, config.batchSize, provider.outputTokenBudget);
  log.info('plan batch', {
    lotes: batches.length,
    tamaños: batches.map((b) => b.length),
    batchSize: config.batchSize ?? '(sin límite)',
    presupuestoSalida: provider.outputTokenBudget,
    límite: provider.rateLimit,
  });

  const summaries: BlockSummary[] = [];
  let tldr: string | null = null;
  let calls = 0;

  const runOne = async (chunk: BlockPayload[], includeTldr: boolean): Promise<void> => {
    const response = await scheduler.run(() =>
      withRetry(
        () => {
          calls += 1;
          return provider.summarizeBatch!({
            article,
            blocks: chunk,
            format: config.summaryFormat,
            language,
            includeTldr,
            // La detección de falacias solo existe en batch: el prompt per-block
            // devuelve texto plano y la IA local no razona sobre argumentos.
            detectFallacies: config.detectFallacies,
            apiKey: attempt.apiKey,
            model: attempt.model,
            signal: deps.signal,
          });
        },
        {
          attempts: 3,
          isRetryable,
          onThrottle: () => scheduler.notifyThrottled(),
          signal: deps.signal,
        },
      ),
    );
    if (includeTldr && response.tldr) tldr = response.tldr;
    summaries.push(...response.summaries);
    deps.onPartial?.(response.summaries);
  };

  for (let index = 0; index < batches.length; index += 1) {
    const chunk = batches[index]!;
    try {
      await runOne(chunk, index === 0);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      // Escalón 2 de la degradación: partir el lote en dos y reintentar.
      if (chunk.length > 1) {
        const mid = Math.ceil(chunk.length / 2);
        log.warn(
          `lote de ${chunk.length} bloques falló (${messageOf(error)}); ` +
            `partiendo en ${mid} + ${chunk.length - mid}`,
        );
        await runOne(chunk.slice(0, mid), index === 0);
        await runOne(chunk.slice(mid), false);
      } else {
        log.error('lote de 1 bloque falló definitivamente:', messageOf(error));
        throw error;
      }
    }
  }

  return { tldr, summaries, failed: [], strategyUsed: 'batch', calls };
}

/* ------------------------- Estrategia per-block ------------------------- */

async function runPerBlock(
  article: ArticlePayload,
  blocks: BlockPayload[],
  attempt: Attempt,
  config: Config,
  language: string,
  deps: PipelineDeps,
): Promise<RunResult> {
  const { provider } = attempt;
  const log = deps.log ?? noopLog;
  if (!provider.summarizeBlock) throw new ProviderError(t('errNoPerBlockMode'), 'unavailable', false);

  const scheduler = getScheduler(provider.id, provider.rateLimit);
  log.info('plan per-block', {
    bloques: blocks.length,
    concurrencia: scheduler.concurrency,
    límite: provider.rateLimit,
  });
  let calls = 0;

  // Paso 1 — esquema global, contexto compartido por todos los bloques.
  let outline = '';
  if (provider.buildOutline) {
    try {
      outline = await scheduler.run(() => {
        calls += 1;
        return provider.buildOutline!({
          article,
          language,
          apiKey: attempt.apiKey,
          model: attempt.model,
          signal: deps.signal,
        });
      });
    } catch {
      // Sin esquema se pierde coherencia, no funcionalidad.
      outline = article.title ? `TESIS: ${article.title}` : '';
    }
  }

  const summaries: BlockSummary[] = [];
  const failed: { id: number; error: string }[] = [];
  const byId = new Map(article.blocks.map((b) => [b.id, b]));

  // Paso 2 — cola FIFO en orden del documento, para poblar de arriba abajo.
  const queue = [...blocks];
  const workers = Array.from({ length: Math.max(1, scheduler.concurrency) }, async () => {
    for (;;) {
      const block = queue.shift();
      if (!block) return;
      const previous = byId.get(block.id - 1)?.text ?? null;
      try {
        const summary = await scheduler.run(() =>
          withRetry(
            () => {
              calls += 1;
              return provider.summarizeBlock!({
                block,
                outline,
                previousText: previous,
                format: config.summaryFormat,
                language,
                apiKey: attempt.apiKey,
                model: attempt.model,
                signal: deps.signal,
              });
            },
            { attempts: 3, isRetryable, onThrottle: () => scheduler.notifyThrottled(), signal: deps.signal },
          ),
        );
        const entry = { id: block.id, summary };
        summaries.push(entry);
        deps.onPartial?.([entry]);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        log.warn(`bloque ${block.id} falló:`, messageOf(error));
        failed.push({ id: block.id, error: messageOf(error) });
      }
    }
  });

  await Promise.all(workers);

  if (summaries.length === 0 && failed.length > 0) {
    throw new ProviderError(failed[0]!.error, 'unknown', false);
  }

  return { tldr: null, summaries, failed, strategyUsed: 'per-block', calls };
}
