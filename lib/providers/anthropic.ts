import { t } from '../i18n';
import { JSON_SCHEMA, buildBatchPrompt, buildBlockPrompt, buildOutlinePrompt } from '../pipeline/prompts';
import {
  ProviderError,
  coerceBatchResponse,
  errorFromStatus,
  loggedFetch,
  type BatchRequest,
  type BatchResponse,
  type BlockRequest,
  type OutlineRequest,
  type SummarizerProvider,
} from './types';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';

interface AnthropicContent {
  type: string;
  text?: string;
  input?: unknown;
  name?: string;
}

async function callAnthropic(
  apiKey: string,
  model: string,
  prompt: string,
  signal: AbortSignal,
  maxTokens: number,
  tool?: { name: string; schema: unknown },
): Promise<AnthropicContent[]> {
  const response = await loggedFetch('anthropic', ENDPOINT, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // Requisito para invocar la API desde un contexto de navegador.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }],
      ...(tool
        ? {
            tools: [{ name: tool.name, description: 'Devuelve los resúmenes.', input_schema: tool.schema }],
            tool_choice: { type: 'tool', name: tool.name },
          }
        : {}),
    }),
  }, prompt.length);

  if (!response.ok) {
    throw errorFromStatus(response.status, await response.text().catch(() => ''));
  }
  const data = (await response.json()) as { content?: AnthropicContent[] };
  const content = data.content ?? [];
  if (content.length === 0) {
    throw new ProviderError(t('errEmptyModelResponse'), 'empty-response', true);
  }
  return content;
}

export const anthropicProvider: SummarizerProvider = {
  id: 'anthropic',
  displayName: 'Anthropic (Claude)',
  strategy: 'batch',
  requiresApiKey: true,
  requiresCloudConsent: true,
  supportsStructuredOutput: true,
  rateLimit: { concurrency: 4, requestsPerMinute: null, requestsPerDay: null },
  outputTokenBudget: 25_000,

  async isAvailable() {
    return { available: true };
  },

  async summarizeBatch(req: BatchRequest): Promise<BatchResponse> {
    if (!req.apiKey) throw new ProviderError(t('errMissingKey', 'Anthropic'), 'no-provider', false);
    const prompt = buildBatchPrompt(req.article, req.blocks, req.format, req.language, req.includeTldr);
    // Anthropic no tiene response_format: la salida estructurada se fuerza con tool_choice.
    const content = await callAnthropic(req.apiKey, req.model, prompt, req.signal, 16_000, {
      name: 'devolver_resumenes',
      schema: JSON_SCHEMA,
    });
    const toolUse = content.find((c) => c.type === 'tool_use');
    if (!toolUse?.input) {
      throw new ProviderError(t('errToolMissing'), 'empty-response', true);
    }
    return coerceBatchResponse(toolUse.input);
  },

  async buildOutline(req: OutlineRequest): Promise<string> {
    if (!req.apiKey) throw new ProviderError(t('errMissingKey', 'Anthropic'), 'no-provider', false);
    const content = await callAnthropic(
      req.apiKey,
      req.model,
      buildOutlinePrompt(req.article, req.language),
      req.signal,
      800,
    );
    return content.map((c) => c.text ?? '').join('').trim();
  },

  async summarizeBlock(req: BlockRequest): Promise<string> {
    if (!req.apiKey) throw new ProviderError(t('errMissingKey', 'Anthropic'), 'no-provider', false);
    const prompt = buildBlockPrompt(req.block, req.outline, req.previousText, req.format, req.language);
    const content = await callAnthropic(req.apiKey, req.model, prompt, req.signal, 600);
    return content.map((c) => c.text ?? '').join('').trim();
  },
};
