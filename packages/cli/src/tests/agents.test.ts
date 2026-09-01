// Tests for AI agents
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test';
import { createCodingAgent, DEFAULT_CODING_AGENT_CONFIG, CodingAgent } from '../agents/coding-agent';
import { createChatAgent, DEFAULT_CHAT_AGENT_CONFIG, ChatAgent } from '../agents/chat-agent';
import { createAgentOrchestrator, SkyCodeAgentOrchestrator } from '../agents/orchestrator';
import { createOpenRouterProvider } from '../providers/openrouter';
import type { AgentContext, AgentRequest, AgentMode, AgentCapability } from '../agents/types';

// Mock provider for testing
class MockProvider {
  name = 'mock';
  
  async initialize() {}
  isConfigured() { return true; }
  getConfig() { return {}; }
  async chat() {
    return {
      content: 'Test response',
      model: 'test-model',
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    };
  }
  async chatStream() {}
  async listModels() { return []; }
  async getModel() { return undefined; }
  async validateApiKey() { return true; }
  async close() {}
}

describe('Agents', () => {
  describe('Coding Agent', () => {
    let agent: CodingAgent;
    let mockProvider: MockProvider;

    beforeAll(() => {
      mockProvider = new MockProvider();
    });

    it('should create with default config', () => {
      agent = createCodingAgent() as CodingAgent;
      expect(agent.config.name).toBe('coding-agent');
      expect(agent.config.capabilities).toContain('code-completion');
    });

    it('should have default mode as code', () => {
      agent = createCodingAgent() as CodingAgent;
      expect(agent.getMode()).toBe('code');
    });

    it('should change mode', () => {
      agent = createCodingAgent() as CodingAgent;
      agent.setMode('debug');
      expect(agent.getMode()).toBe('debug');
    });

    it('should get capabilities', () => {
      agent = createCodingAgent() as CodingAgent;
      const capabilities = agent.getCapabilities();
      expect(capabilities).toContain('code-completion');
      expect(capabilities).toContain('bug-fixing');
      expect(capabilities).toContain('refactoring');
    });

    it('should validate request with input', () => {
      agent = createCodingAgent() as CodingAgent;
      const result = agent.validateRequest({ input: 'test' });
      expect(result.valid).toBe(false); // No provider set
    });

    it('should have correct default config', () => {
      expect(DEFAULT_CODING_AGENT_CONFIG.name).toBe('coding-agent');
      expect(DEFAULT_CODING_AGENT_CONFIG.defaultMode).toBe('code');
      expect(DEFAULT_CODING_AGENT_CONFIG.capabilities).toContain('code-completion');
    });
  });

  describe('Chat Agent', () => {
    let agent: ChatAgent;

    it('should create with default config', () => {
      agent = createChatAgent() as ChatAgent;
      expect(agent.config.name).toBe('chat-agent');
      expect(agent.config.capabilities).toContain('chat');
    });

    it('should have default mode as chat', () => {
      agent = createChatAgent() as ChatAgent;
      expect(agent.getMode()).toBe('chat');
    });

    it('should change mode', () => {
      agent = createChatAgent() as ChatAgent;
      agent.setMode('explain');
      expect(agent.getMode()).toBe('explain');
    });

    it('should get capabilities', () => {
      agent = createChatAgent() as ChatAgent;
      const capabilities = agent.getCapabilities();
      expect(capabilities).toContain('chat');
      expect(capabilities).toContain('documentation');
    });

    it('should validate request with input', () => {
      agent = createChatAgent() as ChatAgent;
      const result = agent.validateRequest({ input: 'test' });
      expect(result.valid).toBe(false); // No provider set
    });

    it('should have correct default config', () => {
      expect(DEFAULT_CHAT_AGENT_CONFIG.name).toBe('chat-agent');
      expect(DEFAULT_CHAT_AGENT_CONFIG.defaultMode).toBe('chat');
      expect(DEFAULT_CHAT_AGENT_CONFIG.capabilities).toContain('chat');
    });
  });

  describe('Agent Orchestrator', () => {
    let orchestrator: SkyCodeAgentOrchestrator;

    beforeAll(() => {
      orchestrator = createAgentOrchestrator() as SkyCodeAgentOrchestrator;
    });

    it('should create with default agent', () => {
      expect(orchestrator.getDefaultAgent().config.name).toBe('coding-agent');
    });

    it('should get all agents', () => {
      const agents = orchestrator.getAllAgents();
      expect(Object.keys(agents).length).toBeGreaterThan(0);
      expect('coding-agent' in agents).toBe(true);
      expect('chat-agent' in agents).toBe(true);
    });

    it('should get agent by name', () => {
      const agent = orchestrator.getAgent('coding-agent');
      expect(agent).toBeDefined();
      expect(agent?.config.name).toBe('coding-agent');
    });

    it('should return undefined for non-existent agent', () => {
      const agent = orchestrator.getAgent('non-existent');
      expect(agent).toBeUndefined();
    });

    it('should get available capabilities', () => {
      const capabilities = orchestrator.getAvailableCapabilities();
      expect(capabilities.length).toBeGreaterThan(0);
      expect(capabilities).toContain('code-completion');
      expect(capabilities).toContain('chat');
    });

    it('should check if capability is available', () => {
      expect(orchestrator.hasCapability('code-completion')).toBe(true);
      expect(orchestrator.hasCapability('non-existent')).toBe(false);
    });

    it('should register new agent', () => {
      const agent = createCodingAgent();
      orchestrator.registerAgent('custom-agent', agent);
      expect(orchestrator.getAgent('custom-agent')).toBeDefined();
    });

    it('should unregister agent', () => {
      orchestrator.unregisterAgent('custom-agent');
      expect(orchestrator.getAgent('custom-agent')).toBeUndefined();
    });

    it('should set default agent', () => {
      orchestrator.setDefaultAgent('chat-agent');
      expect(orchestrator.getDefaultAgent().config.name).toBe('chat-agent');
      // Reset to default
      orchestrator.setDefaultAgent('coding-agent');
    });

    it('should get agents with capability', () => {
      const agents = orchestrator.getAgentsWithCapability('code-completion');
      expect(agents.length).toBeGreaterThan(0);
    });

    it('should create coding agent', () => {
      const agent = orchestrator.createCodingAgent('test-coding');
      expect(agent.config.name).toBe('coding-agent');
      expect(orchestrator.getAgent('test-coding')).toBeDefined();
    });

    it('should create chat agent', () => {
      const agent = orchestrator.createChatAgent('test-chat');
      expect(agent.config.name).toBe('chat-agent');
      expect(orchestrator.getAgent('test-chat')).toBeDefined();
    });
  });
});

describe('Agent Types', () => {
  it('should have all expected agent modes', () => {
    const modes: AgentMode[] = ['chat', 'code', 'debug', 'explain', 'refactor', 'test', 'search'];
    expect(modes).toContain('chat');
    expect(modes).toContain('code');
    expect(modes).toContain('debug');
  });

  it('should have all expected capabilities', () => {
    const capabilities: AgentCapability[] = ['chat', 'code-completion', 'code-explanation', 'bug-fixing', 'documentation', 'refactoring', 'testing', 'search'];
    expect(capabilities).toContain('chat');
    expect(capabilities).toContain('code-completion');
    expect(capabilities).toContain('bug-fixing');
  });
});
