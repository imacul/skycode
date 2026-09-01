// Planning Agent - Specialized for creating plans and strategies
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
  PlanningAgentConfig,
} from './types';

/**
 * Default planning agent configuration
 */
export const DEFAULT_PLANNING_AGENT_CONFIG: PlanningAgentConfig = {
  name: 'planning-agent',
  description: 'A specialized AI agent for creating detailed plans, roadmaps, and strategies.',
  capabilities: ['chat', 'documentation', 'search', 'plan', 'build'],
  defaultMode: 'plan',
  systemPrompt: `You are an expert planner and strategist. Your role is to help create:
- Detailed project plans and roadmaps
- Step-by-step implementation strategies
- Technical architecture plans
- Product development roadmaps
- Business strategy plans
- Personal development plans

Always create structured, actionable plans with clear milestones, timelines, and success criteria. Use frameworks like SMART goals, OKRs, and Agile methodologies.`,
  planningSettings: {
    includeTimeline: true,
    includeMilestones: true,
    includeResources: true,
    includeRisks: true,
    includeSuccessMetrics: true,
  },
};

/**
 * Mode-specific system prompts for planning agent
 */
const MODE_PROMPTS: Record<AgentMode, string> = {
  chat: 'Engage in planning conversation. Provide structured advice and actionable insights.',
  explain: 'Explain planning concepts and methodologies clearly.',
  plan: 'Create comprehensive, structured plans with clear steps, timelines, and success criteria.',
  build: 'Create implementation plans and technical roadmaps.',
  search: 'Research planning methodologies and provide best practices.',
  code: 'N/A',
  debug: 'N/A',
  refactor: 'N/A',
  test: 'N/A',
  business: 'N/A',
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
 * Planning Agent implementation
 */
export class PlanningAgent implements BaseAgent {
  readonly config: PlanningAgentConfig;
  private context: AgentContext;
  private currentMode: AgentMode;

  constructor(config: Partial<PlanningAgentConfig> = {}) {
    this.config = {
      ...DEFAULT_PLANNING_AGENT_CONFIG,
      ...config,
    } as PlanningAgentConfig;
    this.currentMode = this.config.defaultMode || 'plan';
    
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
      throw new Error('PlanningAgent requires a provider to be set in context');
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
    const systemPrompt = this.config.systemPrompt || DEFAULT_PLANNING_AGENT_CONFIG.systemPrompt;
    
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
        return `PLANNING MODE: Create a detailed plan for:\n\n${input}\n\nInclude timeline, milestones, resources, and success criteria.`;
      case 'build':
        return `BUILD MODE: Create an implementation plan for:\n\n${input}\n\nInclude technical steps, dependencies, and testing strategy.`;
      case 'explain':
        return `EXPLAIN PLANNING: Explain the planning process for:\n\n${input}`;
      case 'search':
        return `PLANNING RESEARCH: Research best practices for:\n\n${input}`;
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
        temperature: 0.3, // Lower temperature for more structured plans
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
      throw new Error(`PlanningAgent processing failed: ${error instanceof Error ? error.message : String(error)}`);
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
          temperature: 0.3,
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
        suggestions.push('What are the first steps?');
        suggestions.push('Can you create a timeline?');
        suggestions.push('What resources will I need?');
        break;
      case 'build':
        suggestions.push('What technologies should I use?');
        suggestions.push('Can you break this into sprints?');
        suggestions.push('What are the dependencies?');
        break;
      case 'explain':
        suggestions.push('Can you give me an example?');
        suggestions.push('What are the key principles?');
        break;
      case 'search':
        suggestions.push('What are the best practices?');
        suggestions.push('Can you find case studies?');
        break;
      default:
        if (content.length > 500) {
          suggestions.push('Can you summarize this plan?');
        }
        break;
    }

    return suggestions.slice(0, 3);
  }

  /**
   * Get agent capabilities
   */
  getCapabilities(): AgentCapability[] {
    return this.config.capabilities || DEFAULT_PLANNING_AGENT_CONFIG.capabilities;
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
 * Factory function for PlanningAgent
 */
export function createPlanningAgent(config?: Partial<PlanningAgentConfig>): BaseAgent {
  return new PlanningAgent(config);
}
