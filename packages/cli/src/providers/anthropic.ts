// Anthropic provider implementation
import type {
  BaseProvider,
  ChatRequestOptions,
  ChatResponse,
  ChatStreamChunk,
  ModelInfo,
  ProviderConfig,
} from './base';

/**
 * Anthropic configuration
 */
export interface AnthropicConfig extends ProviderConfig {
  /** Anthropic API key */
  apiKey?: string;
  /** Custom API URL */
  baseUrl?: string;
  /** API version */
  apiVersion?: string;
}

/**
 * Known Anthropic models
 */
export const ANTHROPIC_MODELS: ModelInfo[] = [
  {
    id: 'claude-3-5-sonnet-20241022',
    name: 'Claude 3.5 Sonnet',
    description: 'Claude 3.5 Sonnet - Fast and intelligent',
    contextLength: 200000,
    pricing: {
      prompt: 0.000003,
      completion: 0.000015,
    },
    tags: ['anthropic', 'claude', '3.5', 'sonnet'],
  },
  {
    id: 'claude-3-5-sonnet-20240620',
    name: 'Claude 3.5 Sonnet (2024-06-20)',
    description: 'Claude 3.5 Sonnet',
    contextLength: 200000,
    pricing: {
      prompt: 0.000003,
      completion: 0.000015,
    },
    tags: ['anthropic', 'claude', '3.5', 'sonnet'],
  },
  {
    id: 'claude-3-opus-20240229',
    name: 'Claude 3 Opus',
    description: 'Claude 3 Opus - Most powerful model',
    contextLength: 200000,
    pricing: {
      prompt: 0.000015,
      completion: 0.000075,
    },
    tags: ['anthropic', 'claude', '3', 'opus'],
  },
  {
    id: 'claude-3-sonnet-20240229',
    name: 'Claude 3 Sonnet',
    description: 'Claude 3 Sonnet - Balanced performance',
    contextLength: 200000,
    pricing: {
      prompt: 0.000003,
      completion: 0.000015,
    },
    tags: ['anthropic', 'claude', '3', 'sonnet'],
  },
  {
    id: 'claude-3-haiku-20240307',
    name: 'Claude 3 Haiku',
    description: 'Claude 3 Haiku - Fast and efficient',
    contextLength: 200000,
    pricing: {
      prompt: 0.00000025,
      completion: 0.00000125,
    },
    tags: ['anthropic', 'claude', '3', 'haiku'],
  },
  {
    id: 'claude-2:1',
    name: 'Claude 2.1',
    description: 'Claude 2.1 - Previous generation',
    contextLength: 200000,
    pricing: {
      prompt: 0.000008,
      completion: 0.000024,
    },
    tags: ['anthropic', 'claude', '2.1'],
  },
  {
    id: 'claude-2:0',
    name: 'Claude 2',
    description: 'Claude 2 - Previous generation',
    contextLength: 100000,
    pricing: {
      prompt: 0.000008,
      completion: 0.000024,
    },
    tags: ['anthropic', 'claude', '2'],
  },
  {
    id: 'claude-instant-1:2',
    name: 'Claude Instant 1.2',
    description: 'Claude Instant - Fast and cost-effective',
    contextLength: 100000,
    pricing: {
      prompt: 0.00000163,
      completion: 0.00000551,
    },
    tags: ['anthropic', 'claude', 'instant'],
  },
];

/**
 * Anthropic API request body (Messages API)
 */
interface AnthropicRequest {
  anthropic_version: string;
  max_tokens: number;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string | Array<{
      type: 'text' | 'image';
      source: {
        type: 'base64';
        media_type: string;
        data: string;
      };
    }>;
  }>;
  temperature?: number;
  stop_sequences?: string[];
  top_p?: number;
  top_k?: number;
}

/**
 * Anthropic API response
 */
interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{
    type: 'text';
    text: string;
  }>;
  model: string;
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * Anthropic stream chunk types
 */
interface AnthropicStreamChunk {
  type: 'message_start' | 'message_delta' | 'message_stop';
  message?: {
    id: string;
    type: 'message';
    role: 'assistant';
    content?: Array<{
      type: 'text_delta';
      text: string;
    }>;
    model?: string;
    stop_reason?: string | null;
    stop_sequence?: string | null;
    usage?: {
      input_tokens: number;
      output_tokens: number;
    };
  };
}

/**
 * Anthropic Provider
 */
export class AnthropicProvider implements BaseProvider {
  readonly name = 'anthropic';
  private config: AnthropicConfig;
  private initialized = false;

  constructor(config: AnthropicConfig = {}) {
    this.config = {
      baseUrl: 'https://api.anthropic.com',
      apiVersion: '2023-06-01',
      timeout: 120000,
      ...config,
    };
  }

  /**
   * Initialize the provider
   */
  async initialize(config: AnthropicConfig): Promise<void> {
    this.config = {
      ...this.config,
      ...config,
    };

    // Validate configuration
    if (!this.config.apiKey) {
      this.config.apiKey = process.env.ANTHROPIC_API_KEY;
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
   * Convert internal message format to Anthropic format
   */
  private convertMessages(messages: Array<{ role: string; content: string }>): AnthropicRequest['messages'] {
    return messages.map((msg) => ({
      role: msg.role === 'system' ? 'user' : (msg.role as 'user' | 'assistant'),
      content: msg.content,
    }));
  }

  /**
   * Send chat completion request
   */
  async chat(request: ChatRequestOptions): Promise<ChatResponse> {
    if (!this.isConfigured()) {
      throw new Error('Anthropic provider not configured. Set ANTHROPIC_API_KEY.');
    }

    const model = request.model || this.config.model || ANTHROPIC_MODELS[0].id;
    const messages = this.convertMessages(request.messages);

    const body: AnthropicRequest = {
      anthropic_version: this.config.apiVersion || '2023-06-01',
      max_tokens: request.maxTokens || 4096,
      messages,
      temperature: request.temperature,
      stop_sequences: request.stop,
      top_p: 0.9,
      top_k: 5,
    };

    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey,
      'anthropic-version': this.config.apiVersion || '2023-06-01',
      ...this.config.headers,
    };

    try {
      const response = await fetch(`${this.config.baseUrl}/v1/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(request.timeout || this.config.timeout || 120000),
      });

      if (!response.ok) {
        const error = await response.text();
        if (response.status === 401) {
          throw new Error('Invalid Anthropic API key');
        }
        if (response.status === 429) {
          throw new Error('Rate limit exceeded');
        }
        throw new Error(`Anthropic API error: ${response.status} - ${error}`);
      }

      const data = await response.json();

      // Handle both response formats
      let content = '';
      let finishReason = 'stop';
      let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

      if (data.type === 'message') {
        content = data.content?.map((c: { type: string; text?: string }) => c.text || '').join('') || '';
        finishReason = data.stop_reason || 'end_turn';
        usage = {
          promptTokens: data.usage?.input_tokens || 0,
          completionTokens: data.usage?.output_tokens || 0,
          totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
        };
      }

      return {
        content,
        model: data.model || model,
        finishReason,
        usage,
        rawResponse: data,
      };
    } catch (error) {
      throw new Error(`Anthropic request failed: ${error instanceof Error ? error.message : String(error)}`);
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
      throw new Error('Anthropic provider not configured.');
    }

    const model = request.model || this.config.model || ANTHROPIC_MODELS[0].id;
    const messages = this.convertMessages(request.messages);

    const body: AnthropicRequest = {
      anthropic_version: this.config.apiVersion || '2023-06-01',
      max_tokens: request.maxTokens || 4096,
      messages,
      temperature: request.temperature,
      stop_sequences: request.stop,
      top_p: 0.9,
      top_k: 5,
    };

    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey,
      'anthropic-version': this.config.apiVersion || '2023-06-01',
      ...this.config.headers,
    };

    try {
      const response = await fetch(`${this.config.baseUrl}/v1/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...body, stream: true }),
        signal: AbortSignal.timeout(request.timeout || this.config.timeout || 120000),
      });

      if (!response.ok) {
        const error = await response.text();
        if (response.status === 401) {
          throw new Error('Invalid Anthropic API key');
        }
        if (response.status === 429) {
          throw new Error('Rate limit exceeded');
        }
        throw new Error(`Anthropic API error: ${response.status} - ${error}`);
      }

      if (!response.body) {
        throw new Error('No response body for streaming');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finishReason: string | undefined;
      let usage: ChatResponse['usage'] | undefined;
      let fullContent = '';

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
              const chunk = JSON.parse(data) as AnthropicStreamChunk;

              if (chunk.type === 'message_delta' && chunk.message?.content) {
                const text = chunk.message.content
                  .filter((c) => c.type === 'text_delta')
                  .map((c) => c.text)
                  .join('');
                fullContent += text;
                onChunk({ content: text, finishReason: undefined });
              }

              if (chunk.type === 'message_stop') {
                finishReason = chunk.message?.stop_reason || 'end_turn';
                usage = {
                  promptTokens: chunk.message?.usage?.input_tokens || 0,
                  completionTokens: chunk.message?.usage?.output_tokens || 0,
                  totalTokens: (chunk.message?.usage?.input_tokens || 0) + (chunk.message?.usage?.output_tokens || 0),
                };
              }
            } catch (e) {
              console.error('Error parsing Anthropic stream chunk:', e);
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
      throw new Error(`Anthropic streaming failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * List available models
   */
  async listModels(): Promise<ModelInfo[]> {
    return ANTHROPIC_MODELS;
  }

  /**
   * Get model information by ID
   */
  async getModel(modelId: string): Promise<ModelInfo | undefined> {
    return ANTHROPIC_MODELS.find((m) => m.id === modelId);
  }

  /**
   * Validate API key
   */
  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const headers = {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': this.config.apiVersion || '2023-06-01',
      };

      const response = await fetch(`${this.config.baseUrl}/v1/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          anthropic_version: this.config.apiVersion || '2023-06-01',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Hello' }],
        }),
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
 * Factory function for Anthropic provider
 */
export function createAnthropicProvider(config?: AnthropicConfig): BaseProvider {
  return new AnthropicProvider(config);
}
