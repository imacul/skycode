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
import type { BaseProvider } from '../providers/base';
import type { AgentContext } from './types';
import { agentDebug } from '../utils/agent-debug';

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
export interface RouteDecision {
  agentName: string;
  reason: string;
  scores: Record<string, number>;
}

export class SkyCodeAgentOrchestrator implements AgentOrchestrator {
  private agents: Record<string, BaseAgent> = {};
  private defaultAgentName: string;
  private lastRouteDecision: RouteDecision | null = null;

  constructor(defaultAgent: string = 'chat-agent') {
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
  async initializeAll(context: Partial<AgentContext>): Promise<void> {
    const promises = Object.values(this.agents).map((agent) => 
      agent.initialize(context)
    );
    await Promise.all(promises);
  }

  /**
   * Initialize a specific agent
   */
  async initializeAgent(name: string, context: Partial<AgentContext>): Promise<void> {
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
    const decision = this.explainRoute(request);
    this.lastRouteDecision = decision;
    const agent = this.agents[decision.agentName] || this.getDefaultAgent();
    const response = await agent.process(request);

    return {
      ...response,
      metadata: response.metadata
        ? { ...response.metadata, agent: decision.agentName }
        : response.metadata,
    };
  }

  /**
   * Route a request with streaming
   */
  async routeRequestStream(request: AgentRequest): Promise<void> {
    const decision = this.explainRoute(request);
    this.lastRouteDecision = decision;
    agentDebug('route.decision', {
      input: request.input,
      taskKind: request.taskKind,
      taskState: request.taskState,
      decision,
    });
    const agent = this.agents[decision.agentName] || this.getDefaultAgent();

    await agent.processStream({
      ...request,
      onComplete: request.onComplete
        ? (response) =>
            request.onComplete?.({
              ...response,
              metadata: response.metadata
                ? { ...response.metadata, agent: decision.agentName }
                : response.metadata,
            })
        : undefined,
    });
  }

  /**
   * Explain which agent would handle a request and why.
   */
  explainRoute(request: AgentRequest): RouteDecision {
    const explicitAgent = request.context?.agent as string | undefined;
    if (explicitAgent && this.agents[explicitAgent]) {
      return {
        agentName: explicitAgent,
        reason: 'explicit agent override',
        scores: {},
      };
    }

    // Automatic routing uses one tool-capable agent for both conversation and
    // execution. The model chooses tools dynamically from its context, rather
    // than requiring user phrasing to match hardcoded verbs or app names.
    // Explicit modes remain available for specialized planning/business chats.
    const mode = request.mode || (request.context?.mode as AgentMode | undefined);
    const specializedModes: Partial<Record<AgentMode, string>> = {
      plan: 'planning-agent',
      business: 'business-agent',
    };
    if (mode && specializedModes[mode]) {
      return {
        agentName: specializedModes[mode]!,
        reason: 'explicit specialist mode: ' + mode,
        scores: {},
      };
    }
    return {
      agentName: 'coding-agent',
      reason: 'model-led assistant with optional computer and workspace tools',
      scores: { 'coding-agent': 100 },
    };
  }

  getLastRouteDecision(): RouteDecision | null {
    return this.lastRouteDecision ? { ...this.lastRouteDecision, scores: { ...this.lastRouteDecision.scores } } : null;
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
  updateAllContext(updates: Partial<AgentContext>): void {
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
    const modes = new Set<AgentMode>();
    
    for (const agent of Object.values(this.agents)) {
      const agentModes: AgentMode[] = ['chat', 'code', 'debug', 'explain', 'refactor', 'test', 'search', 'plan', 'build', 'business'];
      modes.add(agent.getMode());
    }
    
    return Array.from(modes);
  }
}

/**
 * Create the agent orchestrator
 */
export function createAgentOrchestrator(defaultAgent?: string): SkyCodeAgentOrchestrator {
  return new SkyCodeAgentOrchestrator(defaultAgent);
}

/**
 * Singleton instance for convenience
 */
export const agentOrchestrator = createAgentOrchestrator();
