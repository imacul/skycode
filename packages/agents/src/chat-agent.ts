// Chat Agent - General conversation agent
import type {
  BaseAgent,
  AgentConfig,
  AgentContext,
  AgentRequest,
  AgentResponse,
  AgentMode,
  AgentCapability,
  BaseProvider,
  Message,
  ChatAgentConfig,
} from './types';

/**
 * Default chat agent configuration
 */
export const DEFAULT_CHAT_AGENT_CONFIG: ChatAgentConfig = {
  name: 'chat-agent',
  description: 'A general-purpose AI assistant for conversation, documentation, and knowledge queries.',
  capabilities: ['chat', 'documentation', 'search'],
  defaultMode: 'chat',
  systemPrompt: `You are a helpful, knowledgeable AI assistant. Your role is to:
- Answer questions accurately and clearly
- Provide helpful explanations and examples
- Assist with documentation and learning
- Help solve problems step-by-step

Be concise but thorough. Use markdown formatting for clarity. Cite sources when possible.`,
  chatSettings: {
    responseLength: 'medium',
    includeThinking: false,
    includeSources: true,
  },
};

/**
 * Mode-specific prompts for chat agent
 */
const MODE_PROMPTS: Record<AgentMode, string> = {
  chat: 'Engage in general conversation. Be helpful, accurate, and friendly.',
  code: 'Provide code examples and technical explanations when relevant.',
  debug: 'Help troubleshoot and solve problems methodically.',
  explain: 'Explain concepts clearly with examples and analogies.',
  refactor: 'N/A',
  test: 'N/A',
  search: 'Search for information and provide comprehensive answers with sources.',
  plan: 'Create comprehensive plans and strategies.',
  build: 'Create implementation plans and technical roadmaps.',
  business: 'Provide business strategy and analysis.',
};

/**
 * Response length settings
 */
const RESPONSE_LENGTH_TOKENS: Record<'short' | 'medium' | 'long', number> = {
  short: 512,
  medium: 2048,
  long: 4096,
};

/**
 * Get system message
 */
function getSystemMessage(provider: string, model: string, content: string): Message {
  return {
    id: `system_${Date.now()}`,
    role: 'system',
    content,
    timestamp: new Date(),
  };
}

/**
 * Chat Agent implementation
 */
export class ChatAgent implements BaseAgent {
  readonly config: ChatAgentConfig;
  private context: AgentContext;
  private currentMode: AgentMode;

  constructor(config: Partial<ChatAgentConfig> = {}) {
    this.config = {
      ...DEFAULT_CHAT_AGENT_CONFIG,
      ...config,
    } as ChatAgentConfig;
    this.currentMode = this.config.defaultMode || 'chat';
    
    this.context = {
      conversation: null,
      messages: [],
      settings: {},
      provider: null,
      model: '',
      workingDirectory: typeof process !== 'undefined' ? process.cwd() : '/',
      env: typeof process !== 'undefined' ? { ...process.env } : {},
    };
  }

  /**
   * Initialize the agent
   */
  async initialize(context: Partial<AgentContext>): Promise<void> {
    this.context = {
      ...this.context,
      ...context,
    };

    if (!this.context.provider) {
      throw new Error('ChatAgent requires a provider to be set in context');
    }

    if (!this.context.model) {
      this.context.model = this.config.model || 'meta-llama/llama-3.1-70b-instruct';
    }
  }

  /**
   * Get the system message
   */
  private getSystemMessage(): Message {
    const modePrompt = MODE_PROMPTS[this.currentMode];
    const systemPrompt = this.config.systemPrompt || DEFAULT_CHAT_AGENT_CONFIG.systemPrompt;
    
    const fullPrompt = this.config.chatSettings?.includeThinking
      ? `${systemPrompt}\n\nAlways show your thinking process step-by-step.`
      : systemPrompt;

    return getSystemMessage(
      this.context.provider?.name || 'openrouter',
      this.context.model,
      `${fullPrompt}\n\n${modePrompt}`
    );
  }

  /**
   * Build messages for the provider
   */
  private buildProviderMessages(request: AgentRequest): Message[] {
    const systemMessage = this.getSystemMessage();
    const messages = [systemMessage];

    // Add conversation history
    if (this.context.conversation) {
      messages.push(...this.context.conversation.messages);
    }

    // Add current messages from context
    if (this.context.messages.length > 0) {
      messages.push(...this.context.messages);
    }

    // Add user input
    messages.push({
      id: `user_${Date.now()}`,
      role: 'user',
      content: request.input,
      timestamp: new Date(),
      metadata: undefined,
    });

    return messages;
  }

  /**
   * Process a request
   */
  async process(request: AgentRequest): Promise<AgentResponse> {
    this.validateRequest(request);

    const messages = this.buildProviderMessages(request);
    const startTime = Date.now();

    if (!this.context.provider) {
      throw new Error('Provider not initialized');
    }

    // Get max tokens based on response length setting
    const maxTokens = (request.context as any)?.maxTokens || RESPONSE_LENGTH_TOKENS[this.config.chatSettings?.responseLength || 'medium'];

    try {
      const response = await this.context.provider.chat({
        messages,
        model: this.context.model,
        temperature: 0.7,
        maxTokens,
      });

      const executionTime = Date.now() - startTime;

      return {
        content: response.content,
        type: this.detectResponseType(response.content),
        metadata: {
          model: response.model,
          provider: this.context.provider?.name || 'openrouter',
          finishReason: response.finishReason,
          tokensUsed: response.usage?.totalTokens || 0,
          executionTime,
        },
        suggestions: this.generateSuggestions(response.content, request),
      };
    } catch (error) {
      throw new Error(`ChatAgent processing failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Process a request with streaming
   */
  async processStream(request: AgentRequest): Promise<void> {
    this.validateRequest(request);

    const messages = this.buildProviderMessages(request);
    const startTime = Date.now();
    let fullContent = '';

    if (!this.context.provider) {
      throw new Error('Provider not initialized');
    }

    // Get max tokens based on response length setting
    const responseLength = this.config.chatSettings?.responseLength || 'medium';
    const maxTokens = (request.context as any)?.maxTokens || RESPONSE_LENGTH_TOKENS[responseLength];

    try {
      await this.context.provider.chatStream(
        {
          messages,
          model: this.context.model,
          temperature: 0.7,
          maxTokens,
          stream: true,
        },
        (chunk) => {
          fullContent += chunk.content;
          
          if (request.onStream) {
            request.onStream(chunk.content);
          }

          if (chunk.finishReason) {
            const executionTime = Date.now() - startTime;
            
            if (request.onComplete) {
              request.onComplete({
                content: fullContent,
                type: this.detectResponseType(fullContent),
                metadata: {
                  model: this.context.model,
                  provider: this.context.provider?.name || 'openrouter',
                  finishReason: chunk.finishReason,
                  tokensUsed: chunk.usage?.totalTokens || 0,
                  executionTime,
                },
                suggestions: this.generateSuggestions(fullContent, request),
              });
            }
          }
        }
      );
    } catch (error) {
      if (request.onError) {
        request.onError(error instanceof Error ? error : new Error(String(error)));
      }
      throw error;
    }
  }

  /**
   * Detect response type
   */
  private detectResponseType(content: string): AgentResponse['type'] {
    if (content.trim().startsWith('{') && content.trim().endsWith('}')) {
      try {
        JSON.parse(content);
        return 'json';
      } catch (e) {
        // Not valid JSON
      }
    }
    
    if (content.includes('```')) {
      return 'markdown';
    }
    
    return 'text';
  }

  /**
   * Generate follow-up suggestions
   */
  private generateSuggestions(content: string, request: AgentRequest): string[] {
    const suggestions: string[] = [];
    const mode = request.mode || this.currentMode;

    if (request.onStream) return suggestions;

    const lowerContent = content.toLowerCase();

    switch (mode) {
      case 'chat':
        if (content.length > 500) {
          suggestions.push('Can you summarize this?');
        }
        suggestions.push('Can you explain this further?');
        break;
      case 'explain':
        suggestions.push('Can you give me an example?');
        suggestions.push('What are the key points?');
        break;
      case 'search':
        suggestions.push('Can you find more information?');
        suggestions.push('What are the best resources?');
        break;
      default:
        if (content.length > 500) {
          suggestions.push('Can you summarize this?');
        }
        break;
    }

    return suggestions.slice(0, 3);
  }

  /**
   * Get agent capabilities
   */
  getCapabilities(): AgentCapability[] {
    return this.config.capabilities || DEFAULT_CHAT_AGENT_CONFIG.capabilities;
  }

  /**
   * Get current mode
   */
  getMode(): AgentMode {
    return this.currentMode;
  }

  /**
   * Set agent mode
   */
  setMode(mode: AgentMode): void {
    this.currentMode = mode;
  }

  /**
   * Update context
   */
  updateContext(updates: Partial<AgentContext>): void {
    this.context = {
      ...this.context,
      ...updates,
    };
  }

  /**
   * Get context
   */
  getContext(): AgentContext {
    return { ...this.context };
  }

  /**
   * Validate request
   */
  validateRequest(request: AgentRequest): { valid: boolean; error?: string } {
    if (!request.input || request.input.trim().length === 0) {
      return { valid: false, error: 'Input is required and cannot be empty' };
    }

    if (!this.context.provider) {
      return { valid: false, error: 'Provider not configured' };
    }

    return { valid: true };
  }

  /**
   * Cleanup
   */
  async cleanup(): Promise<void> {
    // Nothing to cleanup
  }
}

/**
 * Factory function for ChatAgent
 */
export function createChatAgent(config?: Partial<ChatAgentConfig>): BaseAgent {
  return new ChatAgent(config);
}
