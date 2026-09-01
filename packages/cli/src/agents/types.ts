// Agent types and interfaces
import type { BaseProvider } from '../providers/base';
import type { Message, Conversation } from '../store/conversation';
import type { Settings } from '../store/settings';

/**
 * Agent capabilities
 */
export type AgentCapability = 
  | 'chat'
  | 'code-completion'
  | 'code-explanation'
  | 'bug-fixing'
  | 'documentation'
  | 'refactoring'
  | 'testing'
  | 'search';

/**
 * Agent mode
 */
export type AgentMode = 
  | 'chat'           // General conversation
  | 'code'           // Code-focused assistance
  | 'debug'          // Debugging mode
  | 'explain'        // Code explanation
  | 'refactor'       // Code refactoring
  | 'test'           // Test generation
  | 'search'         // Code search/analysis;

/**
 * Agent context for requests
 */
export interface AgentContext {
  // Current conversation
  conversation: Conversation | null;
  
  // Current messages
  messages: Message[];
  
  // Settings
  settings: Partial<Settings>;
  
  // Current provider
  provider: BaseProvider | null;
  
  // Current model
  model: string;
  
  // Working directory (for file operations)
  workingDirectory: string;
  
  // Environment variables
  env: Record<string, string | undefined>;
  
  // Additional context
  [key: string]: unknown;
}

/**
 * Agent request
 */
export interface AgentRequest {
  // User input
  input: string;
  
  // Agent mode
  mode?: AgentMode;
  
  // Capabilities to use
  capabilities?: AgentCapability[];
  
  // Context override
  context?: Partial<AgentContext>;
  
  // Streaming callback
  onStream?: (chunk: string) => void;
  
  // Completion callback
  onComplete?: (response: AgentResponse) => void;
  
  // Error callback
  onError?: (error: Error) => void;
}

/**
 * Agent response
 */
export interface AgentResponse {
  // Generated content
  content: string;
  
  // Response type
  type: 'text' | 'code' | 'markdown' | 'json' | 'action';
  
  // Metadata
  metadata?: {
    model: string;
    provider: string;
    finishReason: string;
    tokensUsed?: number;
    executionTime?: number;
  };
  
  // Actions to perform (for tool calling)
  actions?: AgentAction[];
  
  // Suggested follow-up questions
  suggestions?: string[];
  
  // Code blocks if response contains code
  codeBlocks?: CodeBlock[];
}

/**
 * Code block in response
 */
export interface CodeBlock {
  language: string;
  code: string;
  fileName?: string;
  lineNumbers?: number[];
}

/**
 * Agent action (for tool calling / function calling)
 */
export interface AgentAction {
  // Action type
  type: 'read_file' | 'write_file' | 'run_command' | 'search_files' | 'open_url' | 'custom';
  
  // Action name
  name: string;
  
  // Arguments
  args?: Record<string, unknown>;
  
  // Description
  description?: string;
}

/**
 * Agent configuration
 */
export interface AgentConfig {
  // Agent name
  name: string;
  
  // Agent description
  description: string;
  
  // Supported capabilities
  capabilities: AgentCapability[];
  
  // Default mode
  defaultMode?: AgentMode;
  
  // System prompt
  systemPrompt?: string;
  
  // Provider to use
  provider?: string;
  
  // Model to use
  model?: string;
  
  // Temperature
  temperature?: number;
  
  // Max tokens
  maxTokens?: number;
  
  // Custom settings
  [key: string]: unknown;
}

/**
 * Base agent interface
 */
export interface BaseAgent {
  // Agent configuration
  readonly config: AgentConfig;
  
  // Initialize the agent
  initialize(context: Partial<AgentContext>): Promise<void>;
  
  // Process a request
  process(request: AgentRequest): Promise<AgentResponse>;
  
  // Process with streaming
  processStream(request: AgentRequest): Promise<void>;
  
  // Get agent capabilities
  getCapabilities(): AgentCapability[];
  
  // Get agent mode
  getMode(): AgentMode;
  
  // Set agent mode
  setMode(mode: AgentMode): void;
  
  // Update context
  updateContext(updates: Partial<AgentContext>): void;
  
  // Get context
  getContext(): AgentContext;
  
  // Validate request
  validateRequest(request: AgentRequest): { valid: boolean; error?: string };
  
  // Cleanup
  cleanup(): Promise<void>;
}

/**
 * Agent factory
 */
export type AgentFactory = (config?: Partial<AgentConfig>) => BaseAgent;

/**
 * Agent registry
 */
export interface AgentRegistry {
  [key: string]: AgentFactory;
}

/**
 * Built-in agent types
 */

/** Coding Agent - Specialized for code tasks */
export interface CodingAgentConfig extends AgentConfig {
  capabilities: (
    | 'code-completion'
    | 'code-explanation'
    | 'bug-fixing'
    | 'refactoring'
    | 'testing'
  )[];
  defaultMode: Extract<AgentMode, 'code' | 'debug' | 'refactor' | 'test'>;
  
  // Code-specific settings
  codeSettings?: {
    indentSize: number;
    indentType: 'spaces' | 'tabs';
    lineEndings: 'lf' | 'crlf';
    maxLineLength: number;
    autoFormat: boolean;
  };
}

/** Chat Agent - General conversation */
export interface ChatAgentConfig extends AgentConfig {
  capabilities: ('chat' | 'documentation' | 'search')[];
  defaultMode: Extract<AgentMode, 'chat' | 'explain'>;
  
  // Chat-specific settings
  chatSettings?: {
    responseLength: 'short' | 'medium' | 'long';
    includeThinking: boolean;
    includeSources: boolean;
  };
}

/**
 * Multi-agent orchestration
 */
export interface AgentOrchestrator {
  // Register an agent
  registerAgent(name: string, agent: BaseAgent): void;
  
  // Unregister an agent
  unregisterAgent(name: string): void;
  
  // Get agent by name
  getAgent(name: string): BaseAgent | undefined;
  
  // Get all agents
  getAllAgents(): Record<string, BaseAgent>;
  
  // Route request to appropriate agent
  routeRequest(request: AgentRequest): Promise<AgentResponse>;
  
  // Route with streaming
  routeRequestStream(request: AgentRequest): Promise<void>;
  
  // Get available capabilities
  getAvailableCapabilities(): AgentCapability[];
  
  // Initialize all agents
  initializeAll(context: Partial<AgentContext>): Promise<void>;
  
  // Cleanup all agents
  cleanupAll(): Promise<void>;
}
