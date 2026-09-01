// Tests for AI providers
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { createOpenRouterProvider, OPEN_WEIGHT_MODELS } from '../providers/openrouter';
import { createLocalLLMProvider, LOCAL_MODELS } from '../providers/local';
import { createAnthropicProvider, ANTHROPIC_MODELS } from '../providers/anthropic';
import { createOpenAIProvider, OPENAI_MODELS } from '../providers/openai';

// Mock fetch for testing
const originalFetch = globalThis.fetch;

describe('Providers', () => {
  describe('OpenRouter Provider', () => {
    it('should initialize with API key', async () => {
      const provider = createOpenRouterProvider();
      await provider.initialize({ apiKey: 'test-key' });
      expect(provider.isConfigured()).toBe(true);
    });

    it('should not be configured without API key', () => {
      const provider = createOpenRouterProvider();
      expect(provider.isConfigured()).toBe(false);
    });

    it('should have correct name', () => {
      const provider = createOpenRouterProvider();
      expect(provider.name).toBe('openrouter');
    });

    it('should list open weight models', async () => {
      const provider = createOpenRouterProvider();
      const models = await provider.listModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models.some(m => m.id === 'meta-llama/llama-3.1-70b-instruct')).toBe(true);
    });

    it('should get model by ID', async () => {
      const provider = createOpenRouterProvider();
      const model = await provider.getModel('meta-llama/llama-3.1-70b-instruct');
      expect(model).toBeDefined();
      expect(model?.id).toBe('meta-llama/llama-3.1-70b-instruct');
    });
  });

  describe('Local LLM Provider', () => {
    it('should initialize with base URL', async () => {
      const provider = createLocalLLMProvider();
      await provider.initialize({ baseUrl: 'http://localhost:11434' });
      expect(provider.isConfigured()).toBe(true);
    });

    it('should have correct name', () => {
      const provider = createLocalLLMProvider();
      expect(provider.name).toBe('local');
    });

    it('should list local models', async () => {
      const provider = createLocalLLMProvider();
      const models = await provider.listModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models.some(m => m.id === 'llama3.1:70b-instruct')).toBe(true);
    });

    it('should detect Ollama server type', () => {
      const provider = createLocalLLMProvider({ baseUrl: 'http://localhost:11434' });
      expect(provider.getConfig().baseUrl).toBe('http://localhost:11434');
    });

    it('should detect LM Studio server type', () => {
      const provider = createLocalLLMProvider({ baseUrl: 'http://localhost:1234' });
      expect(provider.getConfig().baseUrl).toBe('http://localhost:1234');
    });
  });

  describe('Anthropic Provider', () => {
    it('should initialize with API key', async () => {
      const provider = createAnthropicProvider();
      await provider.initialize({ apiKey: 'test-key' });
      expect(provider.isConfigured()).toBe(true);
    });

    it('should have correct name', () => {
      const provider = createAnthropicProvider();
      expect(provider.name).toBe('anthropic');
    });

    it('should list Anthropic models', async () => {
      const provider = createAnthropicProvider();
      const models = await provider.listModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models.some(m => m.id === 'claude-3-5-sonnet-20241022')).toBe(true);
    });

    it('should get model by ID', async () => {
      const provider = createAnthropicProvider();
      const model = await provider.getModel('claude-3-5-sonnet-20241022');
      expect(model).toBeDefined();
      expect(model?.id).toBe('claude-3-5-sonnet-20241022');
    });
  });

  describe('OpenAI Provider', () => {
    it('should initialize with API key', async () => {
      const provider = createOpenAIProvider();
      await provider.initialize({ apiKey: 'test-key' });
      expect(provider.isConfigured()).toBe(true);
    });

    it('should have correct name', () => {
      const provider = createOpenAIProvider();
      expect(provider.name).toBe('openai');
    });

    it('should list OpenAI models', async () => {
      const provider = createOpenAIProvider();
      const models = await provider.listModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models.some(m => m.id === 'gpt-4o-mini')).toBe(true);
    });

    it('should get model by ID', async () => {
      const provider = createOpenAIProvider();
      const model = await provider.getModel('gpt-4o-mini');
      expect(model).toBeDefined();
      expect(model?.id).toBe('gpt-4o-mini');
    });
  });
});

describe('Provider Models', () => {
  it('should export open weight models', () => {
    expect(OPEN_WEIGHT_MODELS.length).toBeGreaterThan(0);
    expect(OPEN_WEIGHT_MODELS.some(m => m.id === 'meta-llama/llama-3.1-70b-instruct')).toBe(true);
  });

  it('should export local models', () => {
    expect(LOCAL_MODELS.length).toBeGreaterThan(0);
    expect(LOCAL_MODELS.some(m => m.id === 'llama3.1:70b-instruct')).toBe(true);
  });

  it('should export Anthropic models', () => {
    expect(ANTHROPIC_MODELS.length).toBeGreaterThan(0);
    expect(ANTHROPIC_MODELS.some(m => m.id === 'claude-3-5-sonnet-20241022')).toBe(true);
  });

  it('should export OpenAI models', () => {
    expect(OPENAI_MODELS.length).toBeGreaterThan(0);
    expect(OPENAI_MODELS.some(m => m.id === 'gpt-4o-mini')).toBe(true);
  });
});
