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
  parseProjectClarification,
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
  systemPrompt: `You are an expert AI coding assistant running inside the SkyCode developer harness.

SkyCode capability facts:
- You are not limited to pasting code snippets in chat.
- For explicit build/edit requests, SkyCode can let you inspect the active workspace, create directories, read/search files, and write real project files.
- You can design project architecture and create multi-file software projects for web, backend, CLI, mobile, or desktop stacks when the requested stack can be represented as source files in the workspace.
- Do not tell the user they must manually copy your code into files when SkyCode project tools can perform the requested file work.
- Do not claim you cannot create software merely because the underlying model by itself has no filesystem. You are operating through SkyCode, and SkyCode supplies workspace tools for build tasks.
- Be precise about current limits: do not claim to compile, execute, install packages, deploy, or use shell commands unless those capabilities are actually available in the active tool set.
- If the user only asks whether you can build software, answer from these SkyCode capabilities; do not start creating files until they actually ask you to build something.

Your role includes:
- Designing maintainable software architecture
- Creating and organizing project folders and source files
- Writing and completing code
- Explaining how code works
- Finding and fixing bugs
- Refactoring code for better structure
- Generating tests

Always respond clearly. For real build/edit requests, prefer actual SkyCode workspace actions over merely printing code blocks.`,
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
      `${systemPrompt}\n\n${modePrompt}${toolPrompt}`,
      this.context.memoryContext
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

  private looksLikeRawModelCapabilityRefusal(content: string): boolean {
    const text = content.toLowerCase();
    return (
      /\b(i (?:am|['’]m) not able to|i cannot|i can['’]?t|unable to)\b/.test(text) &&
      /\b(create|build|develop|software|files?|folders?|project|app|application|execute|compile|deploy)\b/.test(text)
    ) || (
      /\b(i can only|limited to)\b/.test(text) &&
      /\b(code snippets?|guidance|examples?|text|source code)\b/.test(text)
    );
  }

  private async runProjectToolLoop(
    request: AgentRequest,
    onToolExecution?: (execution: ProjectToolExecution) => void,
    onActivity?: (activity: AgentActivity) => void
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
    const maxIterations = 10;
    let tokensUsed = 0;
    let finishReason = 'stop';
    let hasExecutedTools = false;
    const allExecutions: ProjectToolExecution[] = [];

    onActivity?.({
      id: 'planning_' + Date.now(),
      type: 'planning',
      status: 'running',
      title: 'Planning project changes',
      detail: 'Inspecting the workspace and deciding the file structure.',
    });

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      const response = await this.context.provider.chat({
        messages,
        model: this.context.model,
        temperature: 0.2,
        maxTokens,
        signal: request.context?.signal,
        ...(this.context.provider?.name === 'openrouter'
          ? {
              // Tool-planning turns need visible protocol output, not hidden
              // chain-of-thought. Disable reasoning for maximum compatibility
              // with small/free coding models.
              reasoning: {
                effort: 'none',
                exclude: true,
              },
            }
          : {}),
      });

      tokensUsed += response.usage?.totalTokens || 0;
      finishReason = response.finishReason || finishReason;

      const clarification = parseProjectClarification(response.content);
      if (clarification && !hasExecutedTools) {
        return {
          content: clarification,
          finishReason: 'clarification_required',
          tokensUsed,
        };
      }

      const calls = parseProjectToolCalls(response.content);

      if (calls.length === 0) {
        const falseCapabilityRefusal = this.looksLikeRawModelCapabilityRefusal(response.content);

        if (!hasExecutedTools && iteration < 3) {
          messages.push({
            id: 'assistant_invalid_tool_plan_' + Date.now() + '_' + iteration,
            role: 'assistant',
            content: response.content,
            timestamp: new Date(),
          });
          messages.push({
            id: 'tool_retry_' + Date.now() + '_' + iteration,
            // Keep retry/correction turns provider-compatible. Some
            // OpenRouter upstreams reject mid-conversation system messages.
            role: 'user',
            content:
              (falseCapabilityRefusal
                ? 'Your previous response described raw-model limitations, but that is incorrect inside SkyCode. '
                : '') +
              'SkyCode gives you real workspace tools for this task: list_files, read_file, search_files, create_directory, and write_file. ' +
              'The user asked you to modify real project files. Use the exact ' +
              '<tool_call>{"name":"...","args":{...}}</tool_call> format now. ' +
              'If a genuinely architecture-changing detail is missing, ask one concise <clarification> block instead. ' +
              'Do not tell the user to copy code manually and do not merely paste code in chat.',
            timestamp: new Date(),
          });
          continue;
        }

        if (!hasExecutedTools && falseCapabilityRefusal) {
          return {
            content:
              'SkyCode can create and structure this software in the active workspace, but the selected model did not follow the workspace tool protocol after multiple retries. ' +
              'Try the build request again or switch to a stronger coding model; SkyCode will keep the same real file-creation capabilities.',
            finishReason: 'tool_protocol_not_followed',
            tokensUsed,
          };
        }

        const finalText = stripProjectToolCalls(response.content) || response.content.trim();
        if (finalText) {
          onActivity?.({
            id: 'complete_' + Date.now(),
            type: 'complete',
            status: 'success',
            title: 'Project work complete',
            detail:
              allExecutions.length > 0
                ? allExecutions.filter((item) => item.success).length +
                  ' workspace operations completed.'
                : undefined,
          });
          return {
            content: finalText,
            finishReason,
            tokensUsed,
          };
        }

        if (hasExecutedTools) {
          const written = allExecutions.filter(
            (item) => item.success && item.call.name === 'write_file'
          );
          const created = allExecutions.filter(
            (item) => item.success && item.call.name === 'create_directory'
          );
          const summary = [
            'Project work completed in the active workspace.',
            written.length > 0
              ? 'Updated ' + written.length + ' file' + (written.length === 1 ? '' : 's') + '.'
              : '',
            created.length > 0
              ? 'Created ' + created.length + ' director' + (created.length === 1 ? 'y' : 'ies') + '.'
              : '',
            'Review the live work log above for the exact paths and changes.',
          ].filter(Boolean).join(' ');

          onActivity?.({
            id: 'complete_' + Date.now(),
            type: 'complete',
            status: 'success',
            title: 'Project work complete',
            detail: summary,
          });

          return {
            content: summary,
            finishReason,
            tokensUsed,
          };
        }

        return {
          content: finalText,
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
        const activityId =
          'tool_' + Date.now() + '_' + iteration + '_' + executions.length;
        const path =
          typeof call.args.path === 'string' ? String(call.args.path) : undefined;
        const activityType: AgentActivity['type'] =
          call.name === 'write_file'
            ? 'write'
            : call.name === 'create_directory'
              ? 'create'
              : call.name === 'search_files'
                ? 'search'
                : 'inspect';

        onActivity?.({
          id: activityId,
          type: activityType,
          status: 'running',
          title:
            call.name === 'write_file'
              ? 'Writing file'
              : call.name === 'create_directory'
                ? 'Creating directory'
                : call.name === 'search_files'
                  ? 'Searching workspace'
                  : call.name === 'read_file'
                    ? 'Reading file'
                    : 'Inspecting workspace',
          path,
        });

        const execution = await executeProjectToolCall(call, this.context);
        executions.push(execution);
        allExecutions.push(execution);
        onToolExecution?.(execution);

        onActivity?.({
          id: activityId,
          type: activityType,
          status: execution.success ? 'success' : 'error',
          title:
            call.name === 'write_file'
              ? execution.success
                ? 'Updated file'
                : 'File update failed'
              : call.name === 'create_directory'
                ? execution.success
                  ? 'Created directory'
                  : 'Directory creation failed'
                : call.name === 'search_files'
                  ? execution.success
                    ? 'Search complete'
                    : 'Search failed'
                  : call.name === 'read_file'
                    ? execution.success
                      ? 'Read file'
                      : 'Read failed'
                    : execution.success
                      ? 'Workspace inspected'
                      : 'Inspection failed',
          path: execution.displayPath || path,
          detail: execution.success ? undefined : execution.content,
          additions: execution.additions,
          deletions: execution.deletions,
          preview: execution.preview,
        });
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
    let lastFinishReason = 'stop';
    let lastTokensUsed = 0;

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
        }, request.onActivity);

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
          if (chunk.finishReason) lastFinishReason = chunk.finishReason;
          if (chunk.usage?.totalTokens) lastTokensUsed = chunk.usage.totalTokens;
          
          // Stream the content
          if (request.onStream) {
            request.onStream(chunk.content);
          }

          // Check for completion
        }
      );

      // Finalize at provider EOF, not on the first finish_reason chunk.
      // Some OpenAI-compatible backends emit trailing content/usage chunks
      // after finish_reason, while others omit finish_reason entirely.
      // Waiting for EOF guarantees SkyCode commits the complete streamed text.
      request.onComplete?.({
        content: fullContent,
        type: this.detectResponseType(fullContent),
        metadata: {
          model: this.context.model,
          provider: this.context.provider?.name || 'openrouter',
          finishReason: lastFinishReason,
          tokensUsed: lastTokensUsed,
          executionTime: Date.now() - startTime,
        },
        codeBlocks: this.extractCodeBlocks(fullContent),
        suggestions: this.generateSuggestions(fullContent, request),
      });
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
