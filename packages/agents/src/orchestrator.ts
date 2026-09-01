// Agent Orchestrator - Manages multiple agents and routes requests
import type {
  BaseAgent,
  AgentRequest,
  AgentResponse,
  AgentCapability,
  AgentOrchestrator,
  AgentFactory,
  AgentRegistry,
  AgentConfig,
  AgentMode,
} from './types';
import { createCodingAgent, DEFAULT_CODING_AGENT_CONFIG } from './coding-agent';
import { createChatAgent, DEFAULT_CHAT_AGENT_CONFIG } from './chat-agent';
import { createPlanningAgent, DEFAULT_PLANNING_AGENT_CONFIG } from './planning-agent';
import { createBusinessAgent, DEFAULT_BUSINESS_AGENT_CONFIG } from './business-agent';
import type { CodingAgentConfig, ChatAgentConfig, PlanningAgentConfig, BusinessAgentConfig } from './types';

/**
 * Built-in agents registry
 */
export const BUILT_IN_AGENTS: AgentRegistry = {
  'coding-agent': (config?: Partial<AgentConfig>) => createCodingAgent(config as Partial<CodingAgentConfig>),
  'chat-agent': (config?: Partial<AgentConfig>) => createChatAgent(config as Partial<ChatAgentConfig>),
  'planning-agent': (config?: Partial<AgentConfig>) => createPlanningAgent(config as Partial<PlanningAgentConfig>),
  'business-agent': (config?: Partial<AgentConfig>) => createBusinessAgent(config as Partial<BusinessAgentConfig>),
};

/**
 * Agent Orchestrator implementation
 */
export class SkyCodeAgentOrchestrator implements AgentOrchestrator {
  private agents: Record<string, BaseAgent> = {};
  private defaultAgentName: string;

  constructor(defaultAgent: string = 'coding-agent') {
    this.defaultAgentName = defaultAgent;
    
    // Register built-in agents
    this.registerAgent('coding-agent', createCodingAgent());
    this.registerAgent('chat-agent', createChatAgent());
    this.registerAgent('planning-agent', createPlanningAgent());
    this.registerAgent('business-agent', createBusinessAgent());
  }

  /**
   * Register a new agent
   */
  registerAgent(name: string, agent: BaseAgent): void {
    this.agents[name] = agent;
  }

  /**
   * Unregister an agent
   */
  unregisterAgent(name: string): void {
    delete this.agents[name];
    
    // If we're removing the default agent, switch to another one
    if (name === this.defaultAgentName) {
      const available = Object.keys(this.agents);
      if (available.length > 0) {
        this.defaultAgentName = available[0];
      }
    }
  }

  /**
   * Get an agent by name
   */
  getAgent(name: string): BaseAgent | undefined {
    return this.agents[name];
  }

  /**
   * Get all agents
   */
  getAllAgents(): Record<string, BaseAgent> {
    return { ...this.agents };
  }

  /**
   * Set the default agent
   */
  setDefaultAgent(name: string): void {
    if (this.agents[name]) {
      this.defaultAgentName = name;
    }
  }

  /**
   * Get the default agent
   */
  getDefaultAgent(): BaseAgent {
    const agent = this.agents[this.defaultAgentName];
    if (!agent) {
      throw new Error(`Default agent ${this.defaultAgentName} not found`);
    }
    return agent;
  }

  /**
   * Get available capabilities across all agents
   */
  getAvailableCapabilities(): AgentCapability[] {
    const capabilities = new Set<AgentCapability>();
    
    for (const agent of Object.values(this.agents)) {
      for (const capability of agent.getCapabilities()) {
        capabilities.add(capability);
      }
    }
    
    return Array.from(capabilities);
  }

  /**
   * Initialize all agents with shared context
   */
  async initializeAll(context: Partial<import('./types').AgentContext>): Promise<void> {
    const promises = Object.values(this.agents).map((agent) => 
      agent.initialize(context)
    );
    await Promise.all(promises);
  }

  /**
   * Initialize a specific agent
   */
  async initializeAgent(name: string, context: Partial<import('./types').AgentContext>): Promise<void> {
    const agent = this.getAgent(name);
    if (agent) {
      await agent.initialize(context);
    }
  }

  /**
   * Cleanup all agents
   */
  async cleanupAll(): Promise<void> {
    const promises = Object.values(this.agents).map((agent) => 
      agent.cleanup()
    );
    await Promise.all(promises);
  }

  /**
   * Route a request to the appropriate agent
   * Uses intelligent routing based on request content and capabilities
   */
  async routeRequest(request: AgentRequest): Promise<AgentResponse> {
    // Determine which agent to use
    const agent = this.selectAgent(request);
    
    return agent.process(request);
  }

  /**
   * Route a request with streaming
   */
  async routeRequestStream(request: AgentRequest): Promise<void> {
    const agent = this.selectAgent(request);
    
    await agent.processStream(request);
  }

  /**
   * Select the best agent for a request
   */
  private selectAgent(request: AgentRequest): BaseAgent {
    const explicitAgent = (request.context as any)?.agent as string;
    
    // If agent is explicitly specified, use it
    if (explicitAgent && this.agents[explicitAgent]) {
      return this.agents[explicitAgent];
    }

    // Check if mode suggests a specific agent
    const mode = request.mode || (request.context as any)?.mode as string;
    
    if (mode === 'code' || mode === 'debug' || mode === 'refactor' || mode === 'test') {
      return this.agents['coding-agent'] || this.getDefaultAgent();
    }

    if (mode === 'chat' || mode === 'explain' || mode === 'search') {
      return this.agents['chat-agent'] || this.getDefaultAgent();
    }

    if (mode === 'plan' || mode === 'build') {
      return this.agents['planning-agent'] || this.getDefaultAgent();
    }

    if (mode === 'business') {
      return this.agents['business-agent'] || this.getDefaultAgent();
    }

    // Analyze request input for keywords
    const lowerInput = request.input.toLowerCase();
    
    // Code-related keywords
    const codeKeywords = [
      'code', 'function', 'class', 'variable', 'loop', 'if statement',
      'write code', 'fix bug', 'debug', 'refactor', 'test', 'testing',
      'javascript', 'typescript', 'python', 'react', 'node', 'express',
      'algorithm', 'data structure', 'api', 'endpoint', 'database',
      'fix this', 'why is this not working', 'how do i write',
    ];
    
    // Chat-related keywords
    const chatKeywords = [
      'explain', 'what is', 'how does', 'tell me', 'describe',
      'who is', 'when was', 'where is', 'why does', 'history',
      'documentation', 'docs', 'tutorial', 'guide', 'learn',
    ];

    // Business-related keywords
    const businessKeywords = [
      'business', 'market', 'strategy', 'revenue', 'profit',
      'customer', 'product', 'startup', 'investor', 'pitch',
      'plan', 'roadmap', 'go-to-market', 'competitive',
    ];

    // Planning-related keywords
    const planningKeywords = [
      'plan', 'roadmap', 'timeline', 'milestone', 'step',
      'implementation', 'architecture', 'design', 'structure',
    ];

    const hasCodeKeyword = codeKeywords.some(kw => lowerInput.includes(kw));
    const hasChatKeyword = chatKeywords.some(kw => lowerInput.includes(kw));
    const hasBusinessKeyword = businessKeywords.some(kw => lowerInput.includes(kw));
    const hasPlanningKeyword = planningKeywords.some(kw => lowerInput.includes(kw));

    // Priority order: explicit mode > business > planning > code > chat
    if (hasBusinessKeyword) {
      return this.agents['business-agent'] || this.agents['planning-agent'] || this.getDefaultAgent();
    }

    if (hasPlanningKeyword) {
      return this.agents['planning-agent'] || this.getDefaultAgent();
    }

    // If it contains code-related keywords, use coding agent
    if (hasCodeKeyword && !hasChatKeyword) {
      return this.agents['coding-agent'] || this.getDefaultAgent();
    }

    // If it contains chat-related keywords, use chat agent
    if (hasChatKeyword) {
      return this.agents['chat-agent'] || this.getDefaultAgent();
    }

    // Default to the configured default agent
    return this.getDefaultAgent();
  }

  /**
   * Check if a capability is available
   */
  hasCapability(capability: AgentCapability): boolean {
    return this.getAvailableCapabilities().includes(capability);
  }

  /**
   * Get agents that support a specific capability
   */
  getAgentsWithCapability(capability: AgentCapability): BaseAgent[] {
    return Object.values(this.agents).filter((agent) =>
      agent.getCapabilities().includes(capability)
    );
  }

  /**
   * Update context for all agents
   */
  updateAllContext(updates: Partial<import('./types').AgentContext>): void {
    for (const agent of Object.values(this.agents)) {
      agent.updateContext(updates);
    }
  }

  /**
   * Create a new agent from a factory
   */
  createAgent(name: string, factory: AgentFactory, config?: Partial<AgentConfig>): BaseAgent {
    const agent = factory(config);
    this.registerAgent(name, agent);
    return agent;
  }

  /**
   * Create a coding agent with custom config
   */
  createCodingAgent(name: string = 'custom-coding', config?: Partial<CodingAgentConfig>): BaseAgent {
    const agent = createCodingAgent(config);
    this.registerAgent(name, agent);
    return agent;
  }

  /**
   * Create a chat agent with custom config
   */
  createChatAgent(name: string = 'custom-chat', config?: Partial<ChatAgentConfig>): BaseAgent {
    const agent = createChatAgent(config);
    this.registerAgent(name, agent);
    return agent;
  }

  /**
   * Create a planning agent with custom config
   */
  createPlanningAgent(name: string = 'custom-planning', config?: Partial<PlanningAgentConfig>): BaseAgent {
    const agent = createPlanningAgent(config);
    this.registerAgent(name, agent);
    return agent;
  }

  /**
   * Create a business agent with custom config
   */
  createBusinessAgent(name: string = 'custom-business', config?: Partial<BusinessAgentConfig>): BaseAgent {
    const agent = createBusinessAgent(config);
    this.registerAgent(name, agent);
    return agent;
  }

  /**
   * Set the mode for the default agent
   */
  setDefaultAgentMode(mode: AgentMode): void {
    const defaultAgent = this.getDefaultAgent();
    defaultAgent.setMode(mode);
  }

  /**
   * Set the mode for a specific agent
   */
  setAgentMode(agentName: string, mode: AgentMode): void {
    const agent = this.getAgent(agentName);
    if (agent) {
      agent.setMode(mode);
    }
  }

  /**
   * Get the current mode of the default agent
   */
  getDefaultAgentMode(): AgentMode {
    return this.getDefaultAgent().getMode();
  }

  /**
   * Get available modes across all agents
   */
  getAvailableModes(): AgentMode[] {
    const modes: AgentMode[] = ['chat', 'code', 'debug', 'explain', 'refactor', 'test', 'search', 'plan', 'build', 'business'];
    return modes;
  }
}

/**
 * Create the agent orchestrator
 */
export function createAgentOrchestrator(defaultAgent?: string): AgentOrchestrator {
  return new SkyCodeAgentOrchestrator(defaultAgent);
}

/**
 * Singleton instance for convenience
 */
export const agentOrchestrator = createAgentOrchestrator();
