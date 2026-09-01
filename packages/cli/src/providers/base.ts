// Base provider interface for AI model providers
import type { Message } from '../store/conversation';

/**
 * Provider configuration options
 */
export interface ProviderConfig {
  /** API base URL */
  baseUrl?: string;
  /** API key for authentication */
  apiKey?: string;
  /** Default model to use */
  model?: string;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Additional headers */
  headers?: Record<string, string>;
}

/**
 * Request options for chat completion
 */
export interface ChatRequestOptions {
  /** List of messages in the conversation */
  messages: Message[];
  /** Model to use (overrides default) */
  model?: string;
  /** Temperature (0-2) */
  temperature?: number;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Stream the response */
  stream?: boolean;
  /** Stop sequences */
  stop?: string[];
  /** Additional provider-specific options */
  [key: string]: unknown;
}

/**
 * Response from chat completion
 */
export interface ChatResponse {
  /** Generated content */
  content: string;
  /** Model used */
  model: string;
  /** Finish reason (stop, length, error, etc.) */
  finishReason: string;
  /** Usage statistics */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** Raw response from provider */
  rawResponse?: unknown;
}

/**
 * Streaming chunk from chat completion
 */
export interface ChatStreamChunk {
  /** Content delta */
  content: string;
  /** Finish reason (if complete) */
  finishReason?: string;
  /** Usage statistics (if available) */
  usage?: ChatResponse['usage'];
}

/**
 * Available models from provider
 */
export interface ModelInfo {
  id: string;
  name: string;
  description: string;
  contextLength: number;
  pricing?: {
    prompt: number;
    completion: number;
  };
  tags?: string[];
}

/**
 * Base provider interface
 * All AI model providers must implement this interface
 */
export interface BaseProvider {
  /** Provider name (e.g., 'openrouter', 'anthropic', 'local') */
  readonly name: string;

  /** Initialize the provider with configuration */
  initialize(config: ProviderConfig): Promise<void>;

  /** Check if provider is configured and ready */
  isConfigured(): boolean;

  /** Get provider configuration */
  getConfig(): ProviderConfig;

  /** Send chat completion request */
  chat(request: ChatRequestOptions): Promise<ChatResponse>;

  /** Stream chat completion */
  chatStream(
    request: ChatRequestOptions,
    onChunk: (chunk: ChatStreamChunk) => void
  ): Promise<void>;

  /** List available models */
  listModels(): Promise<ModelInfo[]>;

  /** Get model information by ID */
  getModel(modelId: string): Promise<ModelInfo | undefined>;

  /** Validate API key */
  validateApiKey(apiKey: string): Promise<boolean>;

  /** Close any open connections */
  close(): Promise<void>;
}

/**
 * Provider factory type
 */
export type ProviderFactory = (config?: ProviderConfig) => BaseProvider;

/**
 * Provider registry
 * Maps provider names to their factories
 */
export interface ProviderRegistry {
  [key: string]: ProviderFactory;
}

/**
 * Error types for providers
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class AuthenticationError extends ProviderError {
  constructor(provider: string, message: string = 'Authentication failed') {
    super(message, provider, 'AUTHENTICATION_ERROR');
    this.name = 'AuthenticationError';
  }
}

export class RateLimitError extends ProviderError {
  constructor(
    provider: string,
    message: string = 'Rate limit exceeded',
    public readonly retryAfter?: number
  ) {
    super(message, provider, 'RATE_LIMIT_ERROR');
    this.name = 'RateLimitError';
  }
}

export class ModelNotFoundError extends ProviderError {
  constructor(provider: string, modelId: string) {
    super(`Model not found: ${modelId}`, provider, 'MODEL_NOT_FOUND');
    this.name = 'ModelNotFoundError';
  }
}
