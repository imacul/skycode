// OpenAI provider implementation
import type {
  BaseProvider,
  ChatRequestOptions,
  ChatResponse,
  ChatStreamChunk,
  ModelInfo,
  ProviderConfig,
} from './base';

/**
 * OpenAI configuration
 */
export interface OpenAIConfig extends ProviderConfig {
  /** OpenAI API key */
  apiKey?: string;
  /** Custom API URL (for Azure, local, etc.) */
  baseUrl?: string;
  /** Organization ID */
  organization?: string;
  /** API version (for Azure) */
  apiVersion?: string;
}

/**
 * Known OpenAI models
 */
export const OPENAI_MODELS: ModelInfo[] = [
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: 'Fast, cost-efficient, and smart',
    contextLength: 128000,
    pricing: {
      prompt: 0.0000015,
      completion: 0.000006,
    },
    tags: ['openai', 'gpt-4', 'mini'],
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'Reasoning model that is faster and 50% cheaper',
    contextLength: 128000,
    pricing: {
      prompt: 0.000005,
      completion: 0.000015,
    },
    tags: ['openai', 'gpt-4', 'reasoning'],
  },
  {
    id: 'gpt-4-turbo',
    name: 'GPT-4 Turbo',
    description: 'Fast and cost-efficient',
    contextLength: 128000,
    pricing: {
      prompt: 0.00001,
      completion: 0.00003,
    },
    tags: ['openai', 'gpt-4', 'turbo'],
  },
  {
    id: 'gpt-4',
    name: 'GPT-4',
    description: 'Most capable model',
    contextLength: 8192,
    pricing: {
      prompt: 0.00003,
      completion: 0.00006,
    },
    tags: ['openai', 'gpt-4'],
  },
  {
    id: 'gpt-3.5-turbo',
    name: 'GPT-3.5 Turbo',
    description: 'Fast and cost-efficient',
    contextLength: 16384,
    pricing: {
      prompt: 0.0000015,
      completion: 0.000002,
    },
    tags: ['openai', 'gpt-3.5', 'turbo'],
  },
  {
    id: 'gpt-3.5-turbo-16k',
    name: 'GPT-3.5 Turbo 16K',
    description: 'Extended context',
    contextLength: 16384,
    pricing: {
      prompt: 0.000003,
      completion: 0.000004,
    },
    tags: ['openai', 'gpt-3.5', '16k'],
  },
  {
    id: 'o1-preview',
    name: 'o1 Preview',
    description: 'Reasoning model with extended thinking',
    contextLength: 128000,
    pricing: {
      prompt: 0.000015,
      completion: 0.00006,
    },
    tags: ['openai', 'o1', 'reasoning'],
  },
  {
    id: 'o1-mini',
    name: 'o1 Mini',
    description: 'Faster reasoning model',
    contextLength: 128000,
    pricing: {
      prompt: 0.0000015,
      completion: 0.000006,
    },
    tags: ['openai', 'o1', 'mini', 'reasoning'],
  },
];

/**
 * OpenAI API request body
 */
interface OpenAIRequest {
  model: string;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
  temperature?: number;
  max_tokens?: number;
  stop?: string | string[];
  stream?: boolean;
  // Additional options
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  user?: string;
}

/**
 * OpenAI API response
 */
interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string | null;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * OpenAI stream chunk
 */
interface OpenAIStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * OpenAI Provider
 */
export class OpenAIProvider implements BaseProvider {
  readonly name = 'openai';
  private config: OpenAIConfig;
  private initialized = false;

  constructor(config: OpenAIConfig = {}) {
    this.config = {
      baseUrl: 'https://api.openai.com/v1',
      timeout: 120000,
      ...config,
    };
  }

  /**
   * Initialize the provider
   */
  async initialize(config: OpenAIConfig): Promise<void> {
    this.config = {
      ...this.config,
      ...config,
    };

    // Validate configuration
    if (!this.config.apiKey) {
      this.config.apiKey = process.env.OPENAI_API_KEY;
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
   * Send chat completion request
   */
  async chat(request: ChatRequestOptions): Promise<ChatResponse> {
    if (!this.isConfigured()) {
      throw new Error('OpenAI provider not configured. Set OPENAI_API_KEY.');
    }

    const model = request.model || this.config.model || OPENAI_MODELS[0].id;
    const messages = request.messages;

    const body: OpenAIRequest = {
      model,
      messages,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      stop: request.stop,
      stream: false,
      top_p: 0.9,
      frequency_penalty: 0,
      presence_penalty: 0,
    };

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.apiKey}`,
      ...(this.config.organization && { 'OpenAI-Organization': this.config.organization }),
      ...this.config.headers,
    };

    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(request.timeout || this.config.timeout || 120000),
      });

      if (!response.ok) {
        const error = await response.text();
        if (response.status === 401) {
          throw new Error('Invalid OpenAI API key');
        }
        if (response.status === 429) {
          const retryAfter = response.headers.get('retry-after');
          throw new Error(
            `Rate limit exceeded${retryAfter ? `. Retry after ${retryAfter}s` : ''}`
          );
        }
        if (response.status === 404) {
          throw new Error(`Model not found: ${model}`);
        }
        throw new Error(`OpenAI API error: ${response.status} - ${error}`);
      }

      const data = await response.json();

      return {
        content: data.choices?.[0]?.message?.content || '',
        model: data.model,
        finishReason: data.choices?.[0]?.finish_reason || 'stop',
        usage: data.usage,
        rawResponse: data,
      };
    } catch (error) {
      throw new Error(`OpenAI request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Stream chat completion
   */
  async chatStream(
    request: ChatRequestOptions,
    onChunk: (chunk: ChatStreamChunk) => void
  ): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('OpenAI provider not configured.');
    }

    const model = request.model || this.config.model || OPENAI_MODELS[0].id;
    const messages = request.messages;

    const body: OpenAIRequest = {
      model,
      messages,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      stop: request.stop,
      stream: true,
      top_p: 0.9,
      frequency_penalty: 0,
      presence_penalty: 0,
    };

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.apiKey}`,
      ...(this.config.organization && { 'OpenAI-Organization': this.config.organization }),
      ...this.config.headers,
    };

    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(request.timeout || this.config.timeout || 120000),
      });

      if (!response.ok) {
        const error = await response.text();
        if (response.status === 401) {
          throw new Error('Invalid OpenAI API key');
        }
        if (response.status === 429) {
          const retryAfter = response.headers.get('retry-after');
          throw new Error(
            `Rate limit exceeded${retryAfter ? `. Retry after ${retryAfter}s` : ''}`
          );
        }
        throw new Error(`OpenAI API error: ${response.status} - ${error}`);
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
              const chunk = JSON.parse(data) as OpenAIStreamChunk;

              if (chunk.choices?.[0]?.delta?.content) {
                onChunk({
                  content: chunk.choices[0].delta.content,
                  finishReason: undefined,
                });
              }

              if (chunk.choices?.[0]?.finish_reason) {
                finishReason = chunk.choices[0].finish_reason;
              }

              if (chunk.usage) {
                usage = chunk.usage;
              }
            } catch (e) {
              console.error('Error parsing OpenAI stream chunk:', e);
            }
          }
        }
      }

      // Send final chunk with metadata
      if (finishReason) {
        onChunk({
          content: '',
          finishReason,
          usage,
        });
      }
    } catch (error) {
      throw new Error(`OpenAI streaming failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * List available models
   */
  async listModels(): Promise<ModelInfo[]> {
    if (!this.isConfigured()) {
      return OPENAI_MODELS;
    }

    try {
      const headers = {
        Authorization: `Bearer ${this.config.apiKey}`,
        ...this.config.headers,
      };

      const response = await fetch(`${this.config.baseUrl}/models`, {
        headers,
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        const data = await response.json();
        return data.data.map((model: {
          id: string;
          created: number;
          description?: string;
          context_length?: number;
        }) => ({
          id: model.id,
          name: model.id,
          description: model.description || '',
          contextLength: model.context_length || 8192,
          tags: ['openai'],
        }));
      }
    } catch {
      // Fall back to known models
    }

    return OPENAI_MODELS;
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
    // Nothing to close
  }
}

/**
 * Factory function for OpenAI provider
 */
export function createOpenAIProvider(config?: OpenAIConfig): BaseProvider {
  return new OpenAIProvider(config);
}
