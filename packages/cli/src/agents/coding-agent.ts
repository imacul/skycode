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
} from './types';
import type { CodingAgentConfig } from './types';
import type { BaseProvider } from '../providers/base';
import type { Message } from '../store/conversation';
import { getSystemMessage } from '../store/conversation';
import {
  executeProjectToolCall,
  getProjectToolInstructions,
  parseProjectToolCalls,
  projectToolResultMessage,
  shouldUseProjectTools,
  stripProjectToolCalls,
  type ProjectToolExecution,
} from './project-tools';

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
      workingDirectory: process.cwd(),
      env: process.env,
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

    // Ensure we have a provider
    if (!this.context.provider) {
      throw new Error('CodingAgent requires a provider to be set in context');
    }

    // Ensure we have a model
    if (!this.context.model) {
      this.context.model = this.config.model || 'meta-llama/llama-3.1-70b-instruct';
    }
  }

  /**
   * Get the system message based on current mode
   */
  private getSystemMessage(enableProjectTools = false): Message {
    const modePrompt = MODE_PROMPTS[this.currentMode as keyof typeof MODE_PROMPTS] || MODE_PROMPTS.code;
    const systemPrompt = this.config.systemPrompt || DEFAULT_CODING_AGENT_CONFIG.systemPrompt;
    const toolPrompt = enableProjectTools
      ? '\n\n' + getProjectToolInstructions(this.context.workingDirectory)
      : '';

    return getSystemMessage(
      this.context.provider?.name || 'openrouter',
      this.context.model,
      `${systemPrompt}\n\n${modePrompt}${toolPrompt}`
    );
  }

  /**
   * Build messages for the provider
   */
  private buildProviderMessages(request: AgentRequest, enableProjectTools = false): Message[] {
    const systemMessage = this.getSystemMessage(enableProjectTools);
    const messages = [systemMessage];

    // Add conversation history
    if (this.context.conversation) {
      messages.push(...this.context.conversation.messages);
    }

    // Add current messages from context
    if (this.context.messages.length > 0) {
      messages.push(...this.context.messages);
    }

    // Add the user's input
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

  private async runProjectToolLoop(
    request: AgentRequest,
    onToolExecution?: (execution: ProjectToolExecution) => void
  ): Promise<{
    content: string;
    finishReason: string;
    tokensUsed: number;
  }> {
    if (!this.context.provider) {
      throw new Error('Provider not initialized');
    }

    const maxTokens = (request.context as any)?.maxTokens || 4096;
    const messages = this.buildProviderMessages(request, true);
    const maxIterations = 8;
    let tokensUsed = 0;
    let finishReason = 'stop';
    let hasExecutedTools = false;

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      const response = await this.context.provider.chat({
        messages,
        model: this.context.model,
        temperature: 0.2,
        maxTokens,
        signal: request.context?.signal,
      });

      tokensUsed += response.usage?.totalTokens || 0;
      finishReason = response.finishReason || finishReason;

      const calls = parseProjectToolCalls(response.content);

      if (calls.length === 0) {
        if (!hasExecutedTools && iteration < 2) {
          messages.push({
            id: 'assistant_invalid_tool_plan_' + Date.now() + '_' + iteration,
            role: 'assistant',
            content: response.content,
            timestamp: new Date(),
          });
          messages.push({
            id: 'tool_retry_' + Date.now() + '_' + iteration,
            role: 'system',
            content:
              'The user asked you to modify real project files, but no valid project tool call was produced. ' +
              'Use the exact <tool_call>{"name":"...","args":{...}}</tool_call> format now. ' +
              'Do not merely paste code in chat.',
            timestamp: new Date(),
          });
          continue;
        }

        return {
          content: stripProjectToolCalls(response.content) || response.content.trim(),
          finishReason,
          tokensUsed,
        };
      }

      messages.push({
        id: 'assistant_tool_plan_' + Date.now() + '_' + iteration,
        role: 'assistant',
        content: response.content,
        timestamp: new Date(),
      });

      const executions: ProjectToolExecution[] = [];
      hasExecutedTools = true;
      for (const call of calls.slice(0, 8)) {
        const execution = await executeProjectToolCall(call, this.context);
        executions.push(execution);
        onToolExecution?.(execution);
      }

      messages.push(projectToolResultMessage(executions));
    }

    return {
      content:
        'I stopped after the maximum number of project-tool steps to avoid an uncontrolled loop. ' +
        'Review the files that were created or changed before continuing.',
      finishReason: 'tool_iteration_limit',
      tokensUsed,
    };
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
      if (shouldUseProjectTools(request.input)) {
        const toolResult = await this.runProjectToolLoop(request);
        const executionTime = Date.now() - startTime;

        return {
          content: toolResult.content,
          type: this.detectResponseType(toolResult.content),
          metadata: {
            model: this.context.model,
            provider: this.context.provider?.name || 'openrouter',
            finishReason: toolResult.finishReason,
            tokensUsed: toolResult.tokensUsed,
            executionTime,
          },
          codeBlocks: this.extractCodeBlocks(toolResult.content),
          suggestions: [],
        };
      }

      const maxTokens = (request.context as any)?.maxTokens || 4096;
      const response = await this.context.provider.chat({
        messages,
        model: this.context.model,
        temperature: this.config.codeSettings?.autoFormat ? 0.3 : 0.7,
        maxTokens,
        signal: request.context?.signal,
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
      if (shouldUseProjectTools(request.input)) {
        const toolLines: string[] = [];
        const toolResult = await this.runProjectToolLoop(request, (execution) => {
          const path =
            typeof execution.call.args.path === 'string'
              ? ' ' + execution.call.args.path
              : '';
          const line =
            (execution.success ? '✓ ' : '✗ ') +
            execution.call.name +
            path +
            '\n';
          toolLines.push(line);
          request.onStream?.(line);
        });

        if (toolResult.content) {
          const spacer = toolLines.length > 0 ? '\n' : '';
          request.onStream?.(spacer + toolResult.content);
        }

        request.onComplete?.({
          content:
            toolLines.join('') +
            (toolLines.length > 0 && toolResult.content ? '\n' : '') +
            toolResult.content,
          type: this.detectResponseType(toolResult.content),
          metadata: {
            model: this.context.model,
            provider: this.context.provider?.name || 'openrouter',
            finishReason: toolResult.finishReason,
            tokensUsed: toolResult.tokensUsed,
            executionTime: Date.now() - startTime,
          },
          codeBlocks: this.extractCodeBlocks(toolResult.content),
          suggestions: [],
        });
        return;
      }

      const maxTokens = (request.context as any)?.maxTokens || 4096;
      await this.context.provider.chatStream(
        {
          messages,
          model: this.context.model,
          temperature: this.config.codeSettings?.autoFormat ? 0.3 : 0.7,
          maxTokens,
          stream: true,
          signal: request.context?.signal,
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
    
    // Check if it's mostly code
    const codeBlocks = this.extractCodeBlocks(content);
    if (codeBlocks.length > 0 && codeBlocks.some(b => b.code.length > 100)) {
      return 'code';
    }
    
    return 'text';
  }

  /**
   * Extract code blocks from content
   */
  private extractCodeBlocks(content: string): CodeBlock[] {
    const codeBlocks: CodeBlock[] = [];
    const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
    
    let match;
    while ((match = codeBlockRegex.exec(content)) !== null) {
      const language = match[1] || 'text';
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
   * Generate follow-up suggestions
   */
  private generateSuggestions(content: string, request: AgentRequest): string[] {
    const suggestions: string[] = [];
    const mode = request.mode || this.currentMode;

    // Don't generate suggestions for streaming
    if (request.onStream) return suggestions;

    // Analyze content and generate context-aware suggestions
    const lowerContent = content.toLowerCase();

    switch (mode) {
      case 'debug':
        if (lowerContent.includes('fixed') || lowerContent.includes('solution')) {
          suggestions.push('Can you explain the bug in more detail?');
          suggestions.push('How can I prevent this bug in the future?');
        }
        break;
      case 'explain':
        if (content.length > 500) {
          suggestions.push('Can you simplify this explanation?');
          suggestions.push('Can you give me an example?');
        }
        break;
      case 'refactor':
        suggestions.push('What are the key improvements in this refactoring?');
        suggestions.push('Can you explain the changes line by line?');
        break;
      case 'test':
        suggestions.push('Can you add more edge case tests?');
        suggestions.push('How do I run these tests?');
        break;
      case 'code':
      default:
        if (lowerContent.includes('function') || lowerContent.includes('class')) {
          suggestions.push('Can you explain how this works?');
          suggestions.push('Can you write tests for this?');
        }
        if (content.includes('```')) {
          suggestions.push('Can you refactor this code?');
          suggestions.push('Are there any potential bugs here?');
        }
        break;
    }

    // Limit to 3 suggestions
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
    // Nothing to cleanup for now
  }
}

/**
 * Factory function for CodingAgent
 */
export function createCodingAgent(config?: Partial<CodingAgentConfig>): BaseAgent {
  return new CodingAgent(config);
}
