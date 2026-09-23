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

    it('should normalize strict-provider message sequences', async () => {
      let requestBody: any;

      globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body || '{}'));
        return new Response(
          JSON.stringify({
            id: 'or-normalize',
            model: 'test/model',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'ok' },
                finish_reason: 'stop',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }) as typeof fetch;

      try {
        const provider = createOpenRouterProvider();
        await provider.initialize({ apiKey: 'test-key' });

        await provider.chat({
          model: 'test/model',
          messages: [
            {
              id: 's1',
              role: 'system',
              content: 'top system',
              timestamp: new Date(),
            },
            {
              id: 'u1',
              role: 'user',
              content: 'build it',
              timestamp: new Date(),
            },
            {
              id: 'a1',
              role: 'assistant',
              content: '<tool_call>{}</tool_call>',
              timestamp: new Date(),
            },
            {
              id: 's2',
              role: 'system',
              content: 'tool result that used to break strict providers',
              timestamp: new Date(),
            },
            {
              id: 'blank',
              role: 'assistant',
              content: '   ',
              timestamp: new Date(),
            },
          ],
        });

        expect(requestBody.messages).toEqual([
          { role: 'system', content: 'top system' },
          { role: 'user', content: 'build it' },
          { role: 'assistant', content: '<tool_call>{}</tool_call>' },
          { role: 'user', content: 'tool result that used to break strict providers' },
        ]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('should parse OpenAI-compatible chat completion responses', async () => {
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            id: 'or-1',
            model: 'test/model',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'Hello from OpenRouter' },
                finish_reason: 'stop',
              },
            ],
            usage: {
              prompt_tokens: 5,
              completion_tokens: 4,
              total_tokens: 9,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )) as typeof fetch;

      try {
        const provider = createOpenRouterProvider();
        await provider.initialize({ apiKey: 'test-key' });
        const response = await provider.chat({
          model: 'test/model',
          messages: [],
        });

        expect(response.content).toBe('Hello from OpenRouter');
        expect(response.finishReason).toBe('stop');
        expect(response.usage?.totalTokens).toBe(9);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('keeps native tool calls when the visible message is empty', async () => {
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            id: 'or-tools',
            model: 'test/model',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: '',
                  tool_calls: [
                    {
                      type: 'function',
                      function: {
                        name: 'run_command',
                        arguments: '{"command":"bun test"}',
                      },
                    },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )) as typeof fetch;

      try {
        const provider = createOpenRouterProvider();
        await provider.initialize({ apiKey: 'test-key' });
        const response = await provider.chat({
          model: 'test/model',
          messages: [],
        });

        expect(response.content).toContain('<tool_call>');
        expect(response.content).toContain('"name":"run_command"');
        expect(response.content).toContain('"command":"bun test"');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('should parse OpenRouter SSE deltas and final completion', async () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'data: {"id":"or-1","model":"test/model","choices":[{"index":0,"delta":{"content":"Hel"},"finish_reason":null}]}\r\n\r\n'
            )
          );
          controller.enqueue(
            encoder.encode(
              'data: {"id":"or-1","model":"test/model","choices":[{"index":0,"delta":{"content":"lo"},"finish_reason":"stop"}]}\r\n\r\n'
            )
          );
          controller.close();
        },
      });

      globalThis.fetch = (async () =>
        new Response(stream, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        })) as typeof fetch;

      try {
        const provider = createOpenRouterProvider();
        await provider.initialize({ apiKey: 'test-key' });
        let content = '';
        let finished = false;

        await provider.chatStream(
          { model: 'test/model', messages: [] },
          (chunk) => {
            content += chunk.content;
            if (chunk.finishReason) finished = true;
          }
        );

        expect(content).toBe('Hello');
        expect(finished).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
      }
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
