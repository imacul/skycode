// OpenRouter provider implementation
// Supports open-weight models (Llama, Mistral, etc.) via OpenRouter API
import type {
  BaseProvider,
  ChatRequestOptions,
  ChatResponse,
  ChatStreamChunk,
  ModelInfo,
  ProviderConfig,
} from './base';
import type { Message } from '../store/conversation';

/**
 * OpenRouter-specific configuration
 */
export interface OpenRouterConfig extends ProviderConfig {
  /** OpenRouter API key */
  apiKey?: string;
  /** Custom site URL for OpenRouter (default: https://openrouter.ai/api/v1) */
  baseUrl?: string;
  /** Site name for OpenRouter rankings */
  siteName?: string;
  /** Site URL for OpenRouter rankings */
  siteUrl?: string;
  /** App name for OpenRouter */
  appName?: string;
}

/**
 * OpenRouter API request body
 */
interface OpenRouterRequest {
  model: string;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  stop?: string[];
  // OpenRouter-specific
  app_name?: string;
}

/**
 * OpenRouter API response
 */
interface OpenRouterResponse {
  id: string;
  model: string;
  created: number;
  content: Array<{ text?: string; type: string }>;
  role: string;
  finish_reason: string | null;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * OpenRouter stream chunk
 */
interface OpenRouterStreamChunk {
  id: string;
  model: string;
  created: number;
  content: Array<{ text?: string; type: string }>;
  role: string;
  finish_reason: string | null;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * OpenRouter model list response
 */
interface OpenRouterModel {
  id: string;
  name: string;
  created: number;
  description: string;
  context_length: number;
  pricing: {
    prompt: number;
    completion: number;
  };
  tags: string[];
}

/**
 * Known open-weight models available via OpenRouter
 */
export const OPEN_WEIGHT_MODELS = [
  {
    id: 'meta-llama/llama-3.1-70b-instruct',
    name: 'Llama 3.1 70B Instruct',
    description: 'Meta Llama 3.1 70B parameter instruct model',
    contextLength: 128000,
    tags: ['open-weights', 'meta', 'llama', '70b'],
  },
  {
    id: 'meta-llama/llama-3.1-8b-instruct',
    name: 'Llama 3.1 8B Instruct',
    description: 'Meta Llama 3.1 8B parameter instruct model',
    contextLength: 128000,
    tags: ['open-weights', 'meta', 'llama', '8b'],
  },
  {
    id: 'mistralai/mistral-7b-instruct',
    name: 'Mistral 7B Instruct',
    description: 'Mistral AI 7B parameter instruct model',
    contextLength: 32000,
    tags: ['open-weights', 'mistral', '7b'],
  },
  {
    id: 'mistralai/mixtral-8x7b-instruct',
    name: 'Mixtral 8x7B Instruct',
    description: 'Mistral AI mixture of experts 8x7B model',
    contextLength: 32000,
    tags: ['open-weights', 'mistral', 'mixtral', '47b'],
  },
  {
    id: 'openchat/openchat-7b',
    name: 'OpenChat 7B',
    description: 'OpenChat 7B parameter model',
    contextLength: 8192,
    tags: ['open-weights', 'openchat', '7b'],
  },
  {
    id: 'google/gemma-7b-it',
    name: 'Gemma 7B IT',
    description: 'Google Gemma 7B instruction-tuned model',
    contextLength: 8192,
    tags: ['open-weights', 'google', 'gemma', '7b'],
  },
  {
    id: 'phi-3-mini-4k-instruct',
    name: 'Phi-3 Mini 4K Instruct',
    description: 'Microsoft Phi-3 mini 4K context model',
    contextLength: 4096,
    tags: ['open-weights', 'microsoft', 'phi-3', '3.8b'],
  },
  {
    id: 'phi-3-small-8k-instruct',
    name: 'Phi-3 Small 8K Instruct',
    description: 'Microsoft Phi-3 small 8K context model',
    contextLength: 8192,
    tags: ['open-weights', 'microsoft', 'phi-3', '7b'],
  },
];

/**
 * OpenRouter Provider
 * Implements the BaseProvider interface for OpenRouter API
 */
export class OpenRouterProvider implements BaseProvider {
  readonly name = 'openrouter';
  private config: OpenRouterConfig;
  private initialized = false;

  constructor(config: OpenRouterConfig = {}) {
    this.config = {
      baseUrl: 'https://openrouter.ai/api/v1',
      timeout: 120000, // 2 minutes
      ...config,
    };
  }

  /**
   * Initialize the provider
   */
  async initialize(config: OpenRouterConfig): Promise<void> {
    this.config = {
      ...this.config,
      ...config,
    };

    // Validate configuration
    if (!this.config.apiKey) {
      // Try to get from environment
      this.config.apiKey = process.env.OPENROUTER_API_KEY;
    }

    this.initialized = true;
  }

  /**
   * Check if provider is configured
   */
  isConfigured(): boolean {
    return this.initialized && !!this.config.apiKey;
  }

  /**
   * Get provider configuration
   */
  getConfig(): ProviderConfig {
    return { ...this.config };
  }

  /**
   * Convert internal message format to OpenRouter format
   */
  private convertMessages(messages: Message[]): OpenRouterRequest['messages'] {
    return messages.map((msg) => ({
      role: msg.role as 'user' | 'assistant' | 'system',
      content: msg.content,
    }));
  }

  /**
   * Convert OpenRouter response to internal format
   */
  private convertResponse(
    response: OpenRouterResponse | OpenRouterStreamChunk
  ): ChatResponse {
    const content = response.content
      ?.map((c) => c.text || '')
      .join('')
      .trim();

    return {
      content: content || '',
      model: response.model,
      finishReason: response.finish_reason || 'stop',
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
      rawResponse: response,
    };
  }

  /**
   * Send chat completion request
   */
  async chat(request: ChatRequestOptions): Promise<ChatResponse> {
    if (!this.isConfigured()) {
      throw new Error('OpenRouter provider not configured. Set OPENROUTER_API_KEY.');
    }

    const model = request.model || this.config.model || OPEN_WEIGHT_MODELS[0].id;
    const messages = this.convertMessages(request.messages);

    const body: OpenRouterRequest = {
      model,
      messages,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      stream: false,
      stop: request.stop,
    };

    // Add OpenRouter-specific headers
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.apiKey}`,
      ...(this.config.siteName && { 'HTTP-Referer': this.config.siteUrl || '' }),
      ...(this.config.appName && { 'X-App-Name': this.config.appName }),
      ...this.config.headers,
    };

    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(request.timeout || this.config.timeout || 120000),
    });

    if (!response.ok) {
      const error = await response.text();
      if (response.status === 401) {
        throw new Error('Invalid OpenRouter API key');
      }
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        throw new Error(
          `Rate limit exceeded${retryAfter ? `. Retry after ${retryAfter}s` : ''}`
        );
      }
      throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as OpenRouterResponse;
    return this.convertResponse(data);
  }

  /**
   * Stream chat completion
   */
  async chatStream(
    request: ChatRequestOptions,
    onChunk: (chunk: ChatStreamChunk) => void
  ): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('OpenRouter provider not configured. Set OPENROUTER_API_KEY.');
    }

    const model = request.model || this.config.model || OPEN_WEIGHT_MODELS[0].id;
    const messages = this.convertMessages(request.messages);

    const body: OpenRouterRequest = {
      model,
      messages,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      stream: true,
      stop: request.stop,
    };

    // Add OpenRouter-specific headers
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.apiKey}`,
      ...(this.config.siteName && { 'HTTP-Referer': this.config.siteUrl || '' }),
      ...(this.config.appName && { 'X-App-Name': this.config.appName }),
      ...this.config.headers,
    };

    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(request.timeout || this.config.timeout || 120000),
    });

    if (!response.ok) {
      const error = await response.text();
      if (response.status === 401) {
        throw new Error('Invalid OpenRouter API key');
      }
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        throw new Error(
          `Rate limit exceeded${retryAfter ? `. Retry after ${retryAfter}s` : ''}`
        );
      }
      throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
    }

    if (!response.body) {
      throw new Error('No response body for streaming');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finishReason: string | undefined;
    let usage: ChatResponse['usage'] | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      while (buffer.includes('\n\n')) {
        const endIndex = buffer.indexOf('\n\n');
        const line = buffer.slice(0, endIndex);
        buffer = buffer.slice(endIndex + 2);

        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            finishReason = 'stop';
            break;
          }

          try {
            const chunk = JSON.parse(data) as OpenRouterStreamChunk;

            // Handle usage if present
            if (chunk.usage) {
              usage = {
                promptTokens: chunk.usage.prompt_tokens,
                completionTokens: chunk.usage.completion_tokens,
                totalTokens: chunk.usage.total_tokens,
              };
            }

            // Handle finish reason
            if (chunk.finish_reason) {
              finishReason = chunk.finish_reason;
            }

            // Extract content
            const content = chunk.content
              ?.map((c) => c.text || '')
              .join('');

            if (content) {
              onChunk({
                content,
                finishReason,
                usage,
              });
            }
          } catch (e) {
            console.error('Error parsing stream chunk:', e);
          }
        }
      }
    }

    // Send final chunk with finish reason
    if (finishReason) {
      onChunk({
        content: '',
        finishReason,
        usage,
      });
    }
  }

  /**
   * List available models from OpenRouter
   */
  async listModels(): Promise<ModelInfo[]> {
    if (!this.isConfigured()) {
      return OPEN_WEIGHT_MODELS;
    }

    try {
      const headers = {
        Authorization: `Bearer ${this.config.apiKey}`,
        ...this.config.headers,
      };

      const response = await fetch(`${this.config.baseUrl}/models`, {
        headers,
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        // Fall back to known open-weight models
        return OPEN_WEIGHT_MODELS;
      }

      const data = (await response.json()) as {
        data: OpenRouterModel[];
      };

      return data.data.map((model) => ({
        id: model.id,
        name: model.name,
        description: model.description,
        contextLength: model.context_length,
        pricing: {
          prompt: model.pricing?.prompt,
          completion: model.pricing?.completion,
        },
        tags: model.tags,
      }));
    } catch {
      // Fall back to known open-weight models on error
      return OPEN_WEIGHT_MODELS;
    }
  }

  /**
   * Get model information by ID
   */
  async getModel(modelId: string): Promise<ModelInfo | undefined> {
    const models = await this.listModels();
    return models.find((m) => m.id === modelId);
  }

  /**
   * Validate API key
   */
  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const headers = {
        Authorization: `Bearer ${apiKey}`,
      };

      const response = await fetch(`${this.config.baseUrl}/models`, {
        headers,
        signal: AbortSignal.timeout(10000),
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Close connections
   */
  async close(): Promise<void> {
    // Nothing to close for HTTP-based provider
  }
}

/**
 * Factory function for OpenRouter provider
 */
export function createOpenRouterProvider(config?: OpenRouterConfig): BaseProvider {
  return new OpenRouterProvider(config);
}
