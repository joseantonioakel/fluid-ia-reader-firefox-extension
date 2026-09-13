import { browser } from '#imports';
import { t } from '../i18n';
import { ProviderError, type BlockRequest, type OutlineRequest, type SummarizerProvider } from './types';

/**
 * IA nativa del navegador. Estrategia per-block obligatoria: estos modelos tienen
 * ventanas de contexto de pocos miles de tokens (en Firefox, ~1.024 de entrada) y
 * no emiten JSON estructurado, así que no pueden recibir el artículo completo.
 */

/* ----------------------------- Firefox ----------------------------- */

interface TrialMl {
  createEngine(options: Record<string, unknown>): Promise<unknown>;
  runEngine(options: Record<string, unknown>): Promise<unknown>;
  deleteCachedModels?(): Promise<unknown>;
}

function getTrialMl(): TrialMl | null {
  const api = (browser as unknown as { trial?: { ml?: TrialMl } }).trial?.ml;
  return api ?? null;
}

const FIREFOX_MODEL = 'Xenova/distilbart-cnn-6-6';
/** El modelo de Firefox acepta ~1.024 tokens de entrada; recortamos con margen. */
const FIREFOX_MAX_CHARS = 3200;

let firefoxEngineReady: Promise<void> | null = null;

async function ensureFirefoxEngine(ml: TrialMl): Promise<void> {
  if (!firefoxEngineReady) {
    firefoxEngineReady = ml
      .createEngine({ taskName: 'summarization', modelId: FIREFOX_MODEL, modelHub: 'huggingface' })
      .then(() => undefined)
      .catch((error: unknown) => {
        firefoxEngineReady = null;
        throw new ProviderError(t('errFirefoxEngine', String(error)), 'unavailable', false);
      });
  }
  return firefoxEngineReady;
}

function readFirefoxOutput(result: unknown): string {
  if (typeof result === 'string') return result;
  if (Array.isArray(result)) {
    const first = result[0] as Record<string, unknown> | undefined;
    const value = first?.summary_text ?? first?.generated_text ?? first?.text;
    if (typeof value === 'string') return value;
  }
  if (result && typeof result === 'object') {
    const value = (result as Record<string, unknown>).summary_text;
    if (typeof value === 'string') return value;
  }
  return '';
}

/* ------------------------------ Chrome ------------------------------ */

interface ChromeSummarizer {
  summarize(input: string, options?: { context?: string }): Promise<string>;
  destroy?(): void;
}

interface ChromeSummarizerFactory {
  availability(): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>;
  create(options: Record<string, unknown>): Promise<ChromeSummarizer>;
}

/**
 * La Summarizer API de Chrome solo acepta unos pocos idiomas de salida y
 * rechaza `create()` con los demás. Para esos se omite `outputLanguage`: el
 * resumen sale en el idioma del texto, que es mejor que ningún resumen.
 */
const CHROME_OUTPUT_LANGUAGES = new Set(['en', 'es', 'ja']);

export function chromeOutputLanguage(language: string): string | undefined {
  const base = language.split('-')[0]?.toLowerCase() ?? '';
  return CHROME_OUTPUT_LANGUAGES.has(base) ? base : undefined;
}

function getChromeSummarizer(): ChromeSummarizerFactory | null {
  const factory = (globalThis as unknown as { Summarizer?: ChromeSummarizerFactory }).Summarizer;
  return factory ?? null;
}

/* ----------------------------- Proveedor ----------------------------- */

export const browserBuiltinProvider: SummarizerProvider = {
  id: 'browser-builtin',
  get displayName() {
    return t('providerBrowserBuiltin');
  },
  strategy: 'per-block',
  requiresApiKey: false,
  requiresCloudConsent: false,
  supportsStructuredOutput: false,
  // On-device: el límite es la CPU/GPU, no una cuota.
  rateLimit: { concurrency: 2, requestsPerMinute: null, requestsPerDay: null },
  outputTokenBudget: 0,

  async isAvailable() {
    const chromeFactory = getChromeSummarizer();
    if (chromeFactory) {
      try {
        const status = await chromeFactory.availability();
        if (status === 'unavailable') {
          return { available: false, reason: t('reasonNanoUnsupported') };
        }
        if (status === 'downloadable' || status === 'downloading') {
          return { available: true, reason: t('reasonNanoDownload') };
        }
        return { available: true };
      } catch (error) {
        return { available: false, reason: String(error) };
      }
    }

    const ml = getTrialMl();
    if (ml) {
      return { available: true, reason: t('reasonFirefoxDistilbart') };
    }

    return { available: false, reason: t('reasonNoLocalAi') };
  },

  async buildOutline(req: OutlineRequest): Promise<string> {
    // Los modelos on-device no dan un esquema útil del artículo completo:
    // usamos el título como contexto mínimo y evitamos gastar una inferencia.
    return req.article.title ? `TESIS: ${req.article.title}` : '';
  },

  async summarizeBlock(req: BlockRequest): Promise<string> {
    const chromeFactory = getChromeSummarizer();
    if (chromeFactory) {
      const outputLanguage = chromeOutputLanguage(req.language);
      const summarizer = await chromeFactory.create({
        type: req.format === 'bullets' ? 'key-points' : 'tldr',
        format: req.format === 'bullets' ? 'markdown' : 'plain-text',
        length: req.block.targetWords <= 30 ? 'short' : 'medium',
        sharedContext: req.outline,
        ...(outputLanguage ? { outputLanguage } : {}),
      });
      try {
        const text = await summarizer.summarize(req.block.text, { context: req.outline });
        if (!text.trim()) throw new ProviderError(t('errLocalEmpty'), 'empty-response', true);
        return text.trim();
      } finally {
        summarizer.destroy?.();
      }
    }

    const ml = getTrialMl();
    if (!ml) throw new ProviderError(t('errLocalUnavailable'), 'unavailable', false);
    await ensureFirefoxEngine(ml);
    const input = req.block.text.slice(0, FIREFOX_MAX_CHARS);
    const result = await ml.runEngine({ args: [input] });
    const text = readFirefoxOutput(result).trim();
    if (!text) throw new ProviderError(t('errLocalEmpty'), 'empty-response', true);
    return text;
  },
};

/** Solicita el permiso opcional trialML (solo Firefox). */
export async function requestFirefoxMlPermission(): Promise<boolean> {
  try {
    return await browser.permissions.request({ permissions: ['trialML'] as never });
  } catch {
    return false;
  }
}

export async function hasFirefoxMlPermission(): Promise<boolean> {
  try {
    return await browser.permissions.contains({ permissions: ['trialML'] as never });
  } catch {
    return false;
  }
}
