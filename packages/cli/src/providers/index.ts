// Provider exports and registry
import type { BaseProvider, ProviderFactory, ProviderRegistry } from './base';
import { OpenRouterProvider, createOpenRouterProvider, OPEN_WEIGHT_MODELS } from './openrouter';
import { LocalLLMProvider, createLocalLLMProvider, LOCAL_MODELS } from './local';
import { AnthropicProvider, createAnthropicProvider, ANTHROPIC_MODELS } from './anthropic';
import { OpenAIProvider, createOpenAIProvider, OPENAI_MODELS } from './openai';

// Provider registry
export const PROVIDERS: ProviderRegistry = {
  openrouter: createOpenRouterProvider,
  local: createLocalLLMProvider,
  anthropic: createAnthropicProvider,
  openai: createOpenAIProvider,
  // Add more providers here as they are implemented
};

// Named exports
export { BaseProvider, ProviderFactory, ProviderRegistry } from './base';
export {
  OpenRouterProvider,
  createOpenRouterProvider,
  OPEN_WEIGHT_MODELS,
  type OpenRouterConfig,
} from './openrouter';
export {
  LocalLLMProvider,
  createLocalLLMProvider,
  LOCAL_MODELS,
  type LocalLLMConfig,
} from './local';
export {
  AnthropicProvider,
  createAnthropicProvider,
  ANTHROPIC_MODELS,
  type AnthropicConfig,
} from './anthropic';
export {
  OpenAIProvider,
  createOpenAIProvider,
  OPENAI_MODELS,
  type OpenAIConfig,
} from './openai';
export type { ChatRequestOptions, ChatResponse, ChatStreamChunk, ModelInfo } from './base';

// Default export
const providers = PROVIDERS;
export default providers;
