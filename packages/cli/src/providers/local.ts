// Local LLM provider (Ollama, LM Studio, etc.)
import type {
  BaseProvider,
  ChatRequestOptions,
  ChatResponse,
  ChatStreamChunk,
  ModelInfo,
  ProviderConfig,
} from './base';

/**
 * Local LLM configuration
 */
export interface LocalLLMConfig extends ProviderConfig {
  /** Base URL for local LLM server */
  baseUrl?: string;
  /** API key (optional, for authenticated local servers) */
  apiKey?: string;
  /** Model to use */
  model?: string;
  /** Custom headers */
  headers?: Record<string, string>;
}

/**
 * Known local models and their defaults
 */
export const LOCAL_MODELS: ModelInfo[] = [
  {
    id: 'llama3.1:70b-instruct',
    name: 'Llama 3.1 70B Instruct',
    description: 'Meta Llama 3.1 70B parameter instruct model (Ollama)',
    contextLength: 128000,
    tags: ['local', 'ollama', 'llama', '70b'],
  },
  {
    id: 'llama3.1:8b-instruct',
    name: 'Llama 3.1 8B Instruct',
    description: 'Meta Llama 3.1 8B parameter instruct model (Ollama)',
    contextLength: 128000,
    tags: ['local', 'ollama', 'llama', '8b'],
  },
  {
    id: 'llama3:70b-instruct',
    name: 'Llama 3 70B Instruct',
    description: 'Meta Llama 3 70B parameter instruct model (Ollama)',
    contextLength: 8192,
    tags: ['local', 'ollama', 'llama', '70b'],
  },
  {
    id: 'llama3:8b-instruct',
    name: 'Llama 3 8B Instruct',
    description: 'Meta Llama 3 8B parameter instruct model (Ollama)',
    contextLength: 8192,
    tags: ['local', 'ollama', 'llama', '8b'],
  },
  {
    id: 'mistral:7b-instruct',
    name: 'Mistral 7B Instruct',
    description: 'Mistral AI 7B parameter instruct model (Ollama)',
    contextLength: 32000,
    tags: ['local', 'ollama', 'mistral', '7b'],
  },
  {
    id: 'mixtral:8x7b-instruct',
    name: 'Mixtral 8x7B Instruct',
    description: 'Mistral AI mixture of experts 8x7B model (Ollama)',
    contextLength: 32000,
    tags: ['local', 'ollama', 'mixtral'],
  },
  {
    id: 'gemma:7b-instruct',
    name: 'Gemma 7B Instruct',
    description: 'Google Gemma 7B instruction-tuned model (Ollama)',
    contextLength: 8192,
    tags: ['local', 'ollama', 'gemma', '7b'],
  },
  {
    id: 'phi3:3.8b-mini-instruct',
    name: 'Phi-3 Mini 3.8B Instruct',
    description: 'Microsoft Phi-3 mini model (Ollama)',
    contextLength: 4096,
    tags: ['local', 'ollama', 'phi-3', '3.8b'],
  },
  {
    id: 'phi3:7b-small-instruct',
    name: 'Phi-3 Small 7B Instruct',
    description: 'Microsoft Phi-3 small model (Ollama)',
    contextLength: 8192,
    tags: ['local', 'ollama', 'phi-3', '7b'],
  },
  {
    id: 'qwen2:7b-instruct',
    name: 'Qwen 2 7B Instruct',
    description: 'Alibaba Qwen 2 7B parameter model (Ollama)',
    contextLength: 32000,
    tags: ['local', 'ollama', 'qwen', '7b'],
  },
];

/**
 * Ollama API request body
 */
interface OllamaRequest {
  model: string;
  prompt?: string;
  messages?: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  stop?: string[];
  // Ollama-specific
  options?: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    num_predict?: number;
    stop?: string[];
  };
}

/**
 * Ollama API response
 */
interface OllamaResponse {
  model: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

/**
 * Ollama stream chunk
 */
interface OllamaStreamChunk {
  model: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

/**
 * LM Studio API response format
 */
interface LMStudioResponse {
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
 * Detect local LLM server type
 */
function detectServerType(baseUrl: string): 'ollama' | 'lmstudio' | 'openai-compatible' {
  if (baseUrl.includes('lmstudio') || baseUrl.includes('1234')) {
    return 'lmstudio';
  }
  if (baseUrl.includes('ollama') || baseUrl.includes('11434')) {
    return 'ollama';
  }
  return 'openai-compatible';
}

/**
 * Local LLM Provider
 * Supports Ollama, LM Studio, and OpenAI-compatible local servers
 */
export class LocalLLMProvider implements BaseProvider {
  readonly name = 'local';
  private config: LocalLLMConfig;
  private serverType: 'ollama' | 'lmstudio' | 'openai-compatible';
  private initialized = false;

  constructor(config: LocalLLMConfig = {}) {
    this.config = {
      baseUrl: 'http://localhost:11434', // Default to Ollama
      timeout: 120000,
      ...config,
    };
    this.serverType = detectServerType(this.config.baseUrl || '');
  }

  /**
   * Initialize the provider
   */
  async initialize(config: LocalLLMConfig): Promise<void> {
    this.config = {
      ...this.config,
      ...config,
    };

    this.serverType = detectServerType(this.config.baseUrl || '');
    this.initialized = true;
  }

  /**
   * Check if provider is configured
   */
  isConfigured(): boolean {
    return this.initialized && !!this.config.baseUrl;
  }

  /**
   * Get provider configuration
   */
  getConfig(): ProviderConfig {
    return { ...this.config };
  }

  /**
   * Check if model exists locally
   */
  private async checkModelExists(model: string): Promise<boolean> {
    if (this.serverType !== 'ollama') return true;

    try {
      const headers = {
        'Content-Type': 'application/json',
        ...this.config.headers,
      };

      if (this.config.apiKey) {
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
      }

      const response = await fetch(`${this.config.baseUrl}/api/tags`, {
        headers,
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        const data = await response.json();
        const models = (data as { models: Array<{ name: string }> }).models || [];
        return models.some((m: { name: string }) => m.name === model);
      }
    } catch {
      // If we can't check, assume it exists
    }
    return true;
  }

  /**
   * Convert messages to Ollama format
   */
  private convertToOllamaMessages(messages: Array<{ role: string; content: string }>): string {
    return messages.map((msg) => `${msg.role}: ${msg.content}`).join('\n');
  }

  /**
   * Convert to OpenAI-compatible format
   */
  private convertToOpenAIMessages(messages: Array<{ role: string; content: string }>) {
    return messages;
  }

  /**
   * Send chat completion request
   */
  async chat(request: ChatRequestOptions): Promise<ChatResponse> {
    if (!this.isConfigured()) {
      throw new Error('Local LLM provider not configured. Set baseUrl to your local server.');
    }

    const model = request.model || this.config.model || LOCAL_MODELS[0].id;

    // Check if model exists (for Ollama)
    if (this.serverType === 'ollama') {
      const exists = await this.checkModelExists(model);
      if (!exists) {
        throw new Error(`Model ${model} not found. Pull it first with: ollama pull ${model}`);
      }
    }

    const headers = {
      'Content-Type': 'application/json',
      ...this.config.headers,
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    try {
      if (this.serverType === 'ollama') {
        // Ollama uses /api/chat endpoint
        const body = {
          model,
          messages: request.messages,
          stream: false,
          options: {
            temperature: request.temperature,
            top_p: 0.9,
            top_k: 50,
            num_predict: request.maxTokens || 4096,
            stop: request.stop,
          },
        };

        const response = await fetch(`${this.config.baseUrl}/api/chat`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(request.timeout || this.config.timeout || 120000),
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Ollama API error: ${response.status} - ${error}`);
        }

        const data = await response.json();
        return {
          content: data.message?.content || data.response || '',
          model: data.model,
          finishReason: data.done ? 'stop' : 'unknown',
          usage: {
            promptTokens: data.prompt_eval_count || 0,
            completionTokens: data.eval_count || 0,
            totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
          },
          rawResponse: data,
        };
      } else if (this.serverType === 'lmstudio') {
        // LM Studio uses OpenAI-compatible format
        const body = {
          model,
          messages: request.messages,
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          stop: request.stop,
          stream: false,
        };

        const response = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(request.timeout || this.config.timeout || 120000),
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`LM Studio API error: ${response.status} - ${error}`);
        }

        const data = await response.json();
        return {
          content: data.choices?.[0]?.message?.content || '',
          model: data.model,
          finishReason: data.choices?.[0]?.finish_reason || 'unknown',
          usage: data.usage,
          rawResponse: data,
        };
      } else {
        // OpenAI-compatible
        const body = {
          model,
          messages: request.messages,
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          stop: request.stop,
          stream: false,
        };

        const response = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(request.timeout || this.config.timeout || 120000),
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Local LLM API error: ${response.status} - ${error}`);
        }

        const data = await response.json();
        return {
          content: data.choices?.[0]?.message?.content || '',
          model: data.model,
          finishReason: data.choices?.[0]?.finish_reason || 'unknown',
          usage: data.usage,
          rawResponse: data,
        };
      }
    } catch (error) {
      throw new Error(`Local LLM request failed: ${error instanceof Error ? error.message : String(error)}`);
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
      throw new Error('Local LLM provider not configured.');
    }

    const model = request.model || this.config.model || LOCAL_MODELS[0].id;

    const headers = {
      'Content-Type': 'application/json',
      ...this.config.headers,
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    try {
      if (this.serverType === 'ollama') {
        // Ollama streaming
        const body = {
          model,
          messages: request.messages,
          stream: true,
          options: {
            temperature: request.temperature,
            top_p: 0.9,
            top_k: 50,
            num_predict: request.maxTokens || 4096,
            stop: request.stop,
          },
        };

        const response = await fetch(`${this.config.baseUrl}/api/chat`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(request.timeout || this.config.timeout || 120000),
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Ollama API error: ${response.status} - ${error}`);
        }

        if (!response.body) {
          throw new Error('No response body for streaming');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finishReason: string | undefined;
        let promptTokens = 0;
        let completionTokens = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          while (buffer.includes('\n')) {
            const endIndex = buffer.indexOf('\n');
            const line = buffer.slice(0, endIndex);
            buffer = buffer.slice(endIndex + 1);

            if (line.trim()) {
              try {
                const chunk = JSON.parse(line) as OllamaStreamChunk;

                if (chunk.done) {
                  finishReason = 'stop';
                  onChunk({
                    content: '',
                    finishReason,
                    usage: {
                      promptTokens,
                      completionTokens: chunk.eval_count || 0,
                      totalTokens: promptTokens + (chunk.eval_count || 0),
                    },
                  });
                  break;
                }

                if (chunk.response) {
                  onChunk({
                    content: chunk.response,
                    finishReason: undefined,
                  });
                }

                if (chunk.prompt_eval_count !== undefined) {
                  promptTokens = chunk.prompt_eval_count;
                }
              } catch (e) {
                console.error('Error parsing Ollama stream chunk:', e);
              }
            }
          }
        }
      } else {
        // OpenAI-compatible streaming (LM Studio, etc.)
        const body = {
          model,
          messages: request.messages,
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          stop: request.stop,
          stream: true,
        };

        const response = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(request.timeout || this.config.timeout || 120000),
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Local LLM API error: ${response.status} - ${error}`);
        }

        if (!response.body) {
          throw new Error('No response body for streaming');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finishReason: string | undefined;

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
                onChunk({
                  content: '',
                  finishReason,
                });
                break;
              }

              try {
                const chunk = JSON.parse(data) as LMStudioResponse;

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
                  onChunk({
                    content: '',
                    finishReason,
                    usage: chunk.usage,
                  });
                }
              } catch (e) {
                console.error('Error parsing stream chunk:', e);
              }
            }
          }
        }
      }
    } catch (error) {
      throw new Error(`Local LLM streaming failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * List available models
   */
  async listModels(): Promise<ModelInfo[]> {
    if (this.serverType === 'ollama') {
      try {
        const headers = {
          'Content-Type': 'application/json',
          ...this.config.headers,
        };

        if (this.config.apiKey) {
          headers['Authorization'] = `Bearer ${this.config.apiKey}`;
        }

        const response = await fetch(`${this.config.baseUrl}/api/tags`, {
          headers,
          signal: AbortSignal.timeout(10000),
        });

        if (response.ok) {
          const data = await response.json();
          const models = (data as { models: Array<{ name: string; digest: string; size: number }> }).models || [];
          return models.map((m) => ({
            id: m.name,
            name: m.name.replace(/[-:]/g, ' '),
            description: `Local model: ${m.name}`,
            contextLength: this.getContextLength(m.name),
            tags: ['local', 'ollama'],
          }));
        }
      } catch {
        // Fall back to known models
      }
    }

    return LOCAL_MODELS;
  }

  /**
   * Get context length for a model
   */
  private getContextLength(modelId: string): number {
    const model = LOCAL_MODELS.find((m) => m.id === modelId);
    return model?.contextLength || 8192;
  }

  /**
   * Get model information by ID
   */
  async getModel(modelId: string): Promise<ModelInfo | undefined> {
    const models = await this.listModels();
    return models.find((m) => m.id === modelId);
  }

  /**
   * Validate API key (not typically needed for local)
   */
  async validateApiKey(apiKey: string): Promise<boolean> {
    return true; // Local servers usually don't require API keys
  }

  /**
   * Close connections
   */
  async close(): Promise<void> {
    // Nothing to close
  }
}

/**
 * Factory function for Local LLM provider
 */
export function createLocalLLMProvider(config?: LocalLLMConfig): BaseProvider {
  return new LocalLLMProvider(config);
}
