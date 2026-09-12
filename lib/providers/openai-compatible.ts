import { t } from '../i18n';
import type { ProviderId } from '../types';
import { JSON_SCHEMA, buildBatchPrompt, buildBlockPrompt, buildOutlinePrompt } from '../pipeline/prompts';
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

interface ChatChoice {
  message?: { content?: string | null };
  finish_reason?: string;
}

interface Options {
  id: ProviderId;
  displayName: string;
  endpoint: string;
  extraHeaders?: Record<string, string>;
}

async function callChat(
  options: Options,
  apiKey: string,
  model: string,
  prompt: string,
  signal: AbortSignal,
  structured: boolean,
  maxTokens: number,
): Promise<string> {
  const response = await loggedFetch(options.id, options.endpoint, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...options.extraHeaders,
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
      ...(structured
        ? {
            response_format: {
              type: 'json_schema',
              json_schema: { name: 'block_summaries', strict: true, schema: JSON_SCHEMA },
            },
          }
        : {}),
    }),
  }, prompt.length);

  if (!response.ok) {
    throw errorFromStatus(response.status, await response.text().catch(() => ''));
  }

  const data = (await response.json()) as { choices?: ChatChoice[]; error?: { message?: string } };
  if (data.error?.message) {
    throw new ProviderError(data.error.message, 'unknown', true);
  }
  const text = data.choices?.[0]?.message?.content ?? '';
  if (!text.trim()) {
    throw new ProviderError(t('errEmptyModelResponse'), 'empty-response', true);
  }
  return text;
}

function makeProvider(options: Options, concurrency: number): SummarizerProvider {
  return {
    id: options.id,
    displayName: options.displayName,
    strategy: 'batch',
    requiresApiKey: true,
    requiresCloudConsent: true,
    supportsStructuredOutput: true,
    rateLimit: { concurrency, requestsPerMinute: null, requestsPerDay: null },
    outputTokenBudget: 25_000,

    async isAvailable() {
      return { available: true };
    },

    async summarizeBatch(req: BatchRequest): Promise<BatchResponse> {
      if (!req.apiKey) throw new ProviderError(t('errMissingKey', options.displayName), 'no-provider', false);
      const prompt = buildBatchPrompt(req.article, req.blocks, req.format, req.language, req.includeTldr);
      const raw = await callChat(options, req.apiKey, req.model, prompt, req.signal, true, 16_000);
      return coerceBatchResponse(parseJsonLoose(raw));
    },

    async buildOutline(req: OutlineRequest): Promise<string> {
      if (!req.apiKey) throw new ProviderError(t('errMissingKey', options.displayName), 'no-provider', false);
      const prompt = buildOutlinePrompt(req.article, req.language);
      return (await callChat(options, req.apiKey, req.model, prompt, req.signal, false, 800)).trim();
    },

    async summarizeBlock(req: BlockRequest): Promise<string> {
      if (!req.apiKey) throw new ProviderError(t('errMissingKey', options.displayName), 'no-provider', false);
      const prompt = buildBlockPrompt(req.block, req.outline, req.previousText, req.format, req.language);
      return (await callChat(options, req.apiKey, req.model, prompt, req.signal, false, 600)).trim();
    },
  };
}

export const openRouterProvider = makeProvider(
  {
    id: 'openrouter',
    displayName: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    extraHeaders: {
      'HTTP-Referer': 'https://github.com/lector-fluido',
      'X-Title': 'Lector Fluido',
    },
  },
  4,
);

export const openAiProvider = makeProvider(
  {
    id: 'openai',
    displayName: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
  },
  4,
);
