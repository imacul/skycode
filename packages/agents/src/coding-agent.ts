// Coding Agent - Specialized for code-related tasks
import type {
  BaseAgent,
  AgentConfig,
  AgentContext,
  AgentRequest,
  AgentResponse,
  AgentMode,
  AgentCapability,
  CodeBlock,
  CodingAgentConfig,
  BaseProvider,
  Message,
} from './types';

/**
 * Default coding agent configuration
 */
export const DEFAULT_CODING_AGENT_CONFIG: CodingAgentConfig = {
  name: 'coding-agent',
  description: 'A specialized AI agent for coding tasks including code completion, explanation, bug fixing, and refactoring.',
  capabilities: [
    'code-completion',
    'code-explanation',
    'bug-fixing',
    'refactoring',
    'testing',
  ],
  defaultMode: 'code',
  systemPrompt: `You are an expert AI coding assistant. Your role is to help with:
- Writing and completing code
- Explaining how code works
- Finding and fixing bugs
- Refactoring code for better structure
- Generating tests

Always respond with clear, well-formatted code examples. Use appropriate syntax highlighting with markdown code blocks. Include explanations when helpful.`,
  codeSettings: {
    indentSize: 2,
    indentType: 'spaces',
    lineEndings: 'lf',
    maxLineLength: 80,
    autoFormat: true,
  },
};

/**
 * Mode-specific system prompts for coding agent
 */
const MODE_PROMPTS: Record<AgentMode, string> = {
  chat: 'You are a helpful coding assistant. Answer questions clearly and provide code examples when appropriate.',
  code: 'You are an expert developer. Write clean, well-structured, and efficient code. Always include comments and explanations.',
  debug: 'You are a debugging expert. Analyze the code carefully to find bugs, explain the issues, and provide fixes with clear explanations.',
  explain: 'You are a patient teacher. Explain the code in detail, breaking down complex concepts into simple, understandable parts.',
  refactor: 'You are a refactoring expert. Improve the code structure, readability, and maintainability while preserving functionality.',
  test: 'You are a testing specialist. Write comprehensive tests that cover edge cases, error conditions, and normal usage patterns.',
  search: 'You are a code analyst. Search through code to find relevant sections, understand patterns, and identify issues.',
  plan: 'You are a planning expert. Create detailed implementation plans and roadmaps.',
  build: 'You are a build expert. Create implementation plans and technical roadmaps.',
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
 * Coding Agent implementation
 */
export class CodingAgent implements BaseAgent {
  readonly config: CodingAgentConfig;
  private context: AgentContext;
  private currentMode: AgentMode;

  constructor(config: Partial<CodingAgentConfig> = {}) {
    this.config = {
      ...DEFAULT_CODING_AGENT_CONFIG,
      ...config,
    } as CodingAgentConfig;
    this.currentMode = this.config.defaultMode || 'code';
    
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
      throw new Error('CodingAgent requires a provider to be set in context');
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
    const systemPrompt = this.config.systemPrompt || DEFAULT_CODING_AGENT_CONFIG.systemPrompt;
    
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
   * Format user input based on mode and capabilities
   */
  private formatUserInput(request: AgentRequest): string {
    const input = request.input;
    const mode = request.mode || this.currentMode;

    // Add mode-specific prefixes
    switch (mode) {
      case 'debug':
        return `DEBUG MODE: Please analyze this code for bugs and provide fixes:\n\n${input}`;
      case 'explain':
        return `EXPLAIN MODE: Please explain how this code works:\n\n${input}`;
      case 'refactor':
        return `REFACTOR MODE: Please refactor this code for better structure:\n\n${input}`;
      case 'test':
        return `TEST MODE: Please write tests for this code:\n\n${input}`;
      case 'code':
      default:
        // Check if input looks like a request for specific capability
        const lowerInput = input.toLowerCase();
        if (lowerInput.includes('fix') || lowerInput.includes('bug')) {
          return `BUG FIXING: ${input}`;
        }
        if (lowerInput.includes('explain') || lowerInput.includes('how does')) {
          return `CODE EXPLANATION: ${input}`;
        }
        if (lowerInput.includes('refactor') || lowerInput.includes('improve')) {
          return `REFACTORING: ${input}`;
        }
        if (lowerInput.includes('test') || lowerInput.includes('testing')) {
          return `TESTING: ${input}`;
        }
        if (lowerInput.includes('complete') || lowerInput.includes('write')) {
          return `CODE COMPLETION: ${input}`;
        }
        return input;
    }
  }

  /**
   * Extract code blocks from response
   */
  private extractCodeBlocks(content: string): CodeBlock[] {
    const codeBlocks: CodeBlock[] = [];
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    
    let match;
    while ((match = codeBlockRegex.exec(content)) !== null) {
      const language = match[1] || 'unknown';
      const code = match[2].trim();
      
      if (code) {
        codeBlocks.push({
          language,
          code,
        });
      }
    }
    
    return codeBlocks;
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
        temperature: this.config.codeSettings?.autoFormat ? 0.3 : 0.7,
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
        codeBlocks: this.extractCodeBlocks(response.content),
        suggestions: this.generateSuggestions(response.content, request),
      };
    } catch (error) {
      throw new Error(`CodingAgent processing failed: ${error instanceof Error ? error.message : String(error)}`);
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
          temperature: this.config.codeSettings?.autoFormat ? 0.3 : 0.7,
          maxTokens,
          stream: true,
        },
        (chunk) => {
          fullContent += chunk.content;
          
          // Stream the content
          if (request.onStream) {
            request.onStream(chunk.content);
          }

          // Check for completion
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
                codeBlocks: this.extractCodeBlocks(fullContent),
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
      case 'debug':
        suggestions.push('What other issues might exist?');
        suggestions.push('Can you explain the root cause?');
        suggestions.push('How can I prevent this bug?');
        break;
      case 'explain':
        suggestions.push('Can you give me an example?');
        suggestions.push('What are the key concepts?');
        break;
      case 'refactor':
        suggestions.push('What improvements were made?');
        suggestions.push('Can you refactor another section?');
        break;
      case 'test':
        suggestions.push('What edge cases are covered?');
        suggestions.push('Can you write more tests?');
        break;
      case 'code':
      default:
        if (content.includes('function') || content.includes('class')) {
          suggestions.push('Can you explain this code?');
        }
        if (content.includes('error') || content.includes('bug')) {
          suggestions.push('How do I fix this?');
        }
        break;
    }

    return suggestions.slice(0, 3);
  }

  /**
   * Get agent capabilities
   */
  getCapabilities(): AgentCapability[] {
    return this.config.capabilities || DEFAULT_CODING_AGENT_CONFIG.capabilities;
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
 * Factory function for CodingAgent
 */
export function createCodingAgent(config?: Partial<CodingAgentConfig>): BaseAgent {
  return new CodingAgent(config);
}
