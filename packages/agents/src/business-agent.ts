// Business Agent - Specialized for business strategy and planning
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
  BusinessAgentConfig,
} from './types';

/**
 * Default business agent configuration
 */
export const DEFAULT_BUSINESS_AGENT_CONFIG: BusinessAgentConfig = {
  name: 'business-agent',
  description: 'A specialized AI agent for business strategy, planning, and analysis.',
  capabilities: ['chat', 'documentation', 'search', 'plan', 'business'],
  defaultMode: 'business',
  systemPrompt: `You are an expert business strategist and consultant. Your role is to help with:
- Business planning and strategy
- Market analysis and research
- Product development and go-to-market
- Financial modeling and projections
- Competitive analysis
- Business process optimization
- Startup advice and growth strategies

Always provide actionable, data-driven insights. Use frameworks like SWOT, Porter's Five Forces, Business Model Canvas, and Lean Startup methodology.`,
  businessSettings: {
    framework: 'comprehensive',
    includeData: true,
    includeActionItems: true,
    includeMetrics: true,
  },
};

/**
 * Mode-specific system prompts for business agent
 */
const MODE_PROMPTS: Record<AgentMode, string> = {
  chat: 'Engage in business conversation. Provide strategic insights and practical advice.',
  explain: 'Explain business concepts clearly with examples and frameworks.',
  plan: 'Create comprehensive business plans with clear action items, timelines, and success metrics.',
  business: 'Provide expert business analysis and strategy. Use frameworks and data-driven approaches.',
  search: 'Research business topics and provide comprehensive market analysis.',
  code: 'N/A',
  debug: 'N/A',
  refactor: 'N/A',
  test: 'N/A',
  build: 'N/A',
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
 * Business Agent implementation
 */
export class BusinessAgent implements BaseAgent {
  readonly config: BusinessAgentConfig;
  private context: AgentContext;
  private currentMode: AgentMode;

  constructor(config: Partial<BusinessAgentConfig> = {}) {
    this.config = {
      ...DEFAULT_BUSINESS_AGENT_CONFIG,
      ...config,
    } as BusinessAgentConfig;
    this.currentMode = this.config.defaultMode || 'business';
    
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
      throw new Error('BusinessAgent requires a provider to be set in context');
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
    const systemPrompt = this.config.systemPrompt || DEFAULT_BUSINESS_AGENT_CONFIG.systemPrompt;
    
    return getSystemMessage(
      this.context.provider?.name || 'openrouter',
      this.context.model,
      `${systemPrompt}\n\n${modePrompt}`
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
      content: this.formatUserInput(request),
      timestamp: new Date(),
      metadata: undefined,
    });

    return messages;
  }

  /**
   * Format user input based on mode
   */
  private formatUserInput(request: AgentRequest): string {
    const input = request.input;
    const mode = request.mode || this.currentMode;

    switch (mode) {
      case 'plan':
        return `BUSINESS PLAN MODE: Create a comprehensive plan for:\n\n${input}`;
      case 'business':
        return `BUSINESS ANALYSIS: Analyze and provide strategic insights for:\n\n${input}`;
      case 'explain':
        return `EXPLAIN BUSINESS CONCEPT: Explain the following business concept:\n\n${input}`;
      case 'search':
        return `BUSINESS RESEARCH: Research and provide insights on:\n\n${input}`;
      default:
        return input;
    }
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

    try {
      const maxTokens = (request.context as any)?.maxTokens || 4096;
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
      throw new Error(`BusinessAgent processing failed: ${error instanceof Error ? error.message : String(error)}`);
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

    try {
      const maxTokens = (request.context as any)?.maxTokens || 4096;
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
      case 'plan':
        suggestions.push('What are the next steps?');
        suggestions.push('Can you create a timeline?');
        suggestions.push('What resources will I need?');
        break;
      case 'business':
        suggestions.push('What are the risks?');
        suggestions.push('How can I validate this?');
        suggestions.push('What are the alternatives?');
        break;
      case 'explain':
        suggestions.push('Can you give me an example?');
        suggestions.push('How does this apply to my situation?');
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
    return this.config.capabilities || DEFAULT_BUSINESS_AGENT_CONFIG.capabilities;
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
 * Factory function for BusinessAgent
 */
export function createBusinessAgent(config?: Partial<BusinessAgentConfig>): BaseAgent {
  return new BusinessAgent(config);
}
