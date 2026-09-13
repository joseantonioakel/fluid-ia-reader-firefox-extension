import { t } from '../i18n';
import type { ProviderId } from '../types';
import {
  GEMINI_RESPONSE_SCHEMA,
  buildBatchPrompt,
  buildBlockPrompt,
  buildOutlinePrompt,
} from '../pipeline/prompts';
import {
  ProviderError,
  coerceBatchResponse,
  errorFromStatus,
  loggedFetch,
  parseJsonLoose,
  type BatchRequest,
  type BatchResponse,
  type BlockRequest,
  type OutlineRequest,
  type SummarizerProvider,
} from './types';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GeminiCandidate {
  content?: { parts?: { text?: string }[] };
  finishReason?: string;
}

async function callGemini(
  apiKey: string,
  model: string,
  prompt: string,
  signal: AbortSignal,
  structured: boolean,
  maxOutputTokens: number,
): Promise<string> {
  const response = await loggedFetch(
    'gemini',
    `${ENDPOINT}/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        // La clave va en cabecera, nunca en la URL: evita que acabe en logs o historiales.
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens,
          // Fallo conocido de la familia 2.5: los tokens de razonamiento consumen
          // maxOutputTokens y devuelven respuestas vacías. Se desactiva explícitamente.
          thinkingConfig: { thinkingBudget: 0 },
          ...(structured
            ? { responseMimeType: 'application/json', responseSchema: GEMINI_RESPONSE_SCHEMA }
            : {}),
        },
      }),
    },
    prompt.length,
  );

  if (!response.ok) {
    throw errorFromStatus(response.status, await response.text().catch(() => ''));
  }

  const data = (await response.json()) as { candidates?: GeminiCandidate[]; promptFeedback?: unknown };
  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';

  if (!text.trim()) {
    // Una respuesta vacía es un fallo reintentable, nunca un resultado válido.
    const reason = candidate?.finishReason ?? t('reasonNoContent');
    throw new ProviderError(t('errEmptyModelResponseReason', reason), 'empty-response', true);
  }
  return text;
}

function makeGeminiProvider(id: ProviderId, displayName: string, free: boolean): SummarizerProvider {
  return {
    id,
    displayName,
    strategy: 'batch',
    requiresApiKey: true,
    requiresCloudConsent: true,
    supportsStructuredOutput: true,
    // Free tier: 1 llamada por artículo mantiene el consumo muy por debajo de los ~15 RPM.
    rateLimit: free
      ? { concurrency: 1, requestsPerMinute: 15, requestsPerDay: 1000 }
      : { concurrency: 4, requestsPerMinute: null, requestsPerDay: null },
    outputTokenBudget: 25_000,

    async isAvailable() {
      return { available: true };
    },

    async summarizeBatch(req: BatchRequest): Promise<BatchResponse> {
      if (!req.apiKey) throw new ProviderError(t('errMissingKey', 'Google AI Studio'), 'no-provider', false);
      const prompt = buildBatchPrompt(req.article, req.blocks, req.format, req.language, req.includeTldr, req.detectFallacies);
      const raw = await callGemini(req.apiKey, req.model, prompt, req.signal, true, 32_000);
      return coerceBatchResponse(parseJsonLoose(raw));
    },

    async buildOutline(req: OutlineRequest): Promise<string> {
      if (!req.apiKey) throw new ProviderError(t('errMissingKey', 'Google AI Studio'), 'no-provider', false);
      return (
        await callGemini(req.apiKey, req.model, buildOutlinePrompt(req.article, req.language), req.signal, false, 800)
      ).trim();
    },

    async summarizeBlock(req: BlockRequest): Promise<string> {
      if (!req.apiKey) throw new ProviderError(t('errMissingKey', 'Google AI Studio'), 'no-provider', false);
      const prompt = buildBlockPrompt(req.block, req.outline, req.previousText, req.format, req.language);
      return (await callGemini(req.apiKey, req.model, prompt, req.signal, false, 600)).trim();
    },
  };
}

export const geminiFreeProvider = makeGeminiProvider(
  'gemini-free',
  'Gemini (free tier)',
  true,
);

export const geminiProvider = makeGeminiProvider('gemini', 'Gemini (de pago)', false);
