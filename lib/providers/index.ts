import type { ProviderId } from '../types';
import { anthropicProvider } from './anthropic';
import { browserBuiltinProvider } from './browser-builtin';
import { geminiFreeProvider, geminiProvider } from './gemini';
import { openAiProvider, openRouterProvider } from './openai-compatible';
import type { SummarizerProvider } from './types';

export const PROVIDERS: Record<ProviderId, SummarizerProvider> = {
  'browser-builtin': browserBuiltinProvider,
  'gemini-free': geminiFreeProvider,
  gemini: geminiProvider,
  openrouter: openRouterProvider,
  openai: openAiProvider,
  anthropic: anthropicProvider,
};

export const PROVIDER_ORDER: ProviderId[] = [
  'browser-builtin',
  'gemini-free',
  'openrouter',
  'gemini',
  'openai',
  'anthropic',
];

export function getProvider(id: ProviderId): SummarizerProvider {
  return PROVIDERS[id];
}

export * from './types';
export { requestFirefoxMlPermission, hasFirefoxMlPermission } from './browser-builtin';
