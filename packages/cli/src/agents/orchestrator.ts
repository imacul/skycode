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
import { shouldUseProjectTools } from './project-tools';

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

    // Real workspace mutations must always use the coding agent. This is a
    // capability boundary, not a fuzzy intent classification: chat/planning
    // agents stream model text directly and cannot execute project tools.
    const planningOnly = /\b(implementation plan|project plan|roadmap|launch plan|rollout plan)\b/i.test(request.input);
    if (shouldUseProjectTools(request.input) && !planningOnly) {
      return {
        agentName: 'coding-agent',
        reason: 'workspace mutation requires project tools',
        scores: { 'coding-agent': 100 },
      };
    }

    const mode = request.mode || (request.context?.mode as AgentMode | undefined);
    const modeMap: Partial<Record<AgentMode, string>> = {
      code: 'coding-agent',
      debug: 'coding-agent',
      refactor: 'coding-agent',
      test: 'coding-agent',
      explain: 'chat-agent',
      search: 'chat-agent',
      chat: 'chat-agent',
      plan: 'planning-agent',
      build: 'planning-agent',
      business: 'business-agent',
    };

    if (mode && modeMap[mode]) {
      return {
        agentName: modeMap[mode]!,
        reason: `explicit mode: ${mode}`,
        scores: {},
      };
    }

    const input = request.input.toLowerCase();
    const scores: Record<string, number> = {
      'chat-agent': 0,
      'coding-agent': 0,
      'planning-agent': 0,
      'business-agent': 0,
    };

    const add = (agentName: keyof typeof scores, amount: number, patterns: RegExp[]) => {
      for (const pattern of patterns) {
        if (pattern.test(input)) scores[agentName] += amount;
      }
    };

    add('coding-agent', 3, [
      /\b(debug|bug|fix|refactor|test|implement|function|class|typescript|javascript|react|node(?:\.js)?|python|sql)\b/,
      /\b(api|endpoint|database|promise|async|await|component|hook|compiler|runtime)\b/,
      /\b(code|coding|program|algorithm|software|website|web app|desktop app|mobile app|application|cli|backend|frontend|full-stack|full stack)\b/,
      /\b(create|build|develop|scaffold|architect|structure|make)\b.*\b(software|app|application|website|project|repo|backend|frontend|api|cli|desktop|mobile)\b/,
      /\b(can|could|would)\s+you\s+(create|build|develop|make|code)\b.*\b(software|app|application|website|project|program)\b/,
    ]);
    add('coding-agent', 2, [
      /\b(explain|review|inspect)\b.*\b(code|function|react|api|typescript|javascript|node)\b/,
      /\bbusiness logic\b.*\b(bug|function|code|fix)\b/,
    ]);

    add('planning-agent', 3, [
      /\b(roadmap|milestone|implementation plan|launch plan|project plan|rollout plan)\b/,
      /\bplan\b.*\b(launch|build|implement|project|beta|release)\b/,
    ]);
    add('planning-agent', 1, [/\b(schedule|timeline|phases|steps)\b/]);

    add('business-agent', 3, [
      /\b(pricing|revenue|sales|monetization|go-to-market|gtm|market strategy|customer acquisition)\b/,
      /\b(business model|business strategy|unit economics)\b/,
    ]);
    add('business-agent', 1, [/\b(market|customer|saas|startup)\b/]);

    add('chat-agent', 2, [
      /\b(joke|story|chat|conversation|hello|hi|who is|what is|tell me about)\b/,
      /\b(explain|describe)\b/,
    ]);

    // Technical evidence should beat generic conversational words such as
    // "explain", and code-specific bugs should beat the word "business".
    if (scores['coding-agent'] > 0 && /\b(code|bug|debug|function|react|api|endpoint)\b/.test(input)) {
      scores['chat-agent'] = Math.max(0, scores['chat-agent'] - 1);
      if (/\bbusiness logic\b/.test(input)) {
        scores['business-agent'] = Math.max(0, scores['business-agent'] - 2);
      }
    }

    const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const [topAgent, topScore] = ranked[0];
    const secondScore = ranked[1]?.[1] ?? 0;

    if (topScore === 0) {
      const shortFollowUp = input.trim().split(/\s+/).length <= 8;
      if (shortFollowUp && this.lastRouteDecision) {
        return {
          agentName: this.lastRouteDecision.agentName,
          reason: 'short follow-up retained previous route',
          scores,
        };
      }

      return {
        agentName: this.defaultAgentName,
        reason: 'no strong routing signal',
        scores,
      };
    }

    return {
      agentName: topAgent,
      reason:
        topScore === secondScore
          ? `routing tie resolved by score order (${topScore})`
          : `highest routing score (${topScore})`,
      scores,
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
