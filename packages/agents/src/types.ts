// Agent types and interfaces
// Types that would normally come from other modules
// These are duplicated here to avoid circular dependencies

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: {
    model?: string;
    finishReason?: string;
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  };
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
  metadata?: {
    model?: string;
    provider?: string;
    totalTokens?: number;
  };
}

export interface Settings {
  [key: string]: unknown;
}

export interface BaseProvider {
  name: string;
  chat(options: { messages: Message[]; model: string; temperature?: number; maxTokens?: number }): Promise<{
    content: string;
    model: string;
    finishReason: string;
    usage?: { totalTokens?: number };
  }>;
  chatStream(
    options: { messages: Message[]; model: string; temperature?: number; maxTokens?: number; stream: boolean },
    callback: (chunk: { content: string; finishReason?: string; usage?: { totalTokens?: number } }) => void
  ): Promise<void>;
  initialize(config: { apiKey?: string; baseUrl?: string }): Promise<void>;
}

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
  | 'search'
  | 'plan'
  | 'build'
  | 'business';

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
  | 'search'         // Code search/analysis
  | 'plan'           // Planning mode (new)
  | 'build'          // Build/implementation mode (new)
  | 'business'       // Business strategy mode (new);

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
    | 'plan'
    | 'build'
  )[];
  defaultMode: Extract<AgentMode, 'code' | 'debug' | 'refactor' | 'test' | 'plan' | 'build'>;
  
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
  capabilities: ('chat' | 'documentation' | 'search' | 'plan' | 'business')[];
  defaultMode: Extract<AgentMode, 'chat' | 'explain' | 'plan' | 'business'>;
  
  // Chat-specific settings
  chatSettings?: {
    responseLength: 'short' | 'medium' | 'long';
    includeThinking: boolean;
    includeSources: boolean;
  };
}

/** Planning Agent - Specialized for planning */
export interface PlanningAgentConfig extends AgentConfig {
  capabilities: ('chat' | 'documentation' | 'search' | 'plan' | 'build')[];
  defaultMode: Extract<AgentMode, 'chat' | 'explain' | 'plan' | 'build'>;
  
  // Planning-specific settings
  planningSettings?: {
    includeTimeline: boolean;
    includeMilestones: boolean;
    includeResources: boolean;
    includeRisks: boolean;
    includeSuccessMetrics: boolean;
  };
}

/** Business Agent - Specialized for business strategy */
export interface BusinessAgentConfig extends AgentConfig {
  capabilities: ('chat' | 'documentation' | 'search' | 'plan' | 'business')[];
  defaultMode: Extract<AgentMode, 'chat' | 'explain' | 'plan' | 'business'>;
  
  // Business-specific settings
  businessSettings?: {
    framework: 'comprehensive' | 'quick' | 'startup';
    includeData: boolean;
    includeActionItems: boolean;
    includeMetrics: boolean;
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
