import { afterEach, describe, expect, it } from 'bun:test';
import { OpenRouterProvider } from '../providers/openrouter';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function sseResponse(events: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode('data: ' + event + '\n\n'));
      }
      controller.close();
    },
  });

  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('OpenRouter empty/reasoning-only stream recovery', () => {
  it('retries a reasoning-only stream and surfaces the fallback visible answer', async () => {
    let calls = 0;

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      const body = JSON.parse(String(init?.body || '{}'));

      if (body.stream === true) {
        expect(body.reasoning).toEqual({ effort: 'low', exclude: true });
        return sseResponse([
          JSON.stringify({
            id: '1',
            model: 'test/reasoner',
            choices: [
              {
                index: 0,
                delta: { reasoning: 'hidden reasoning tokens' },
                finish_reason: 'length',
              },
            ],
          }),
          '[DONE]',
        ]);
      }

      expect(body.reasoning).toEqual({ effort: 'none', exclude: true });
      return new Response(
        JSON.stringify({
          id: '2',
          model: 'test/reasoner',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Here is the visible final answer.',
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }) as typeof fetch;

    const provider = new OpenRouterProvider();
    await provider.initialize({ apiKey: 'test-key' });

    const chunks: string[] = [];
    await provider.chatStream(
      {
        model: 'test/reasoner',
        messages: [],
        maxTokens: 512,
      },
      (chunk) => {
        if (chunk.content) chunks.push(chunk.content);
      }
    );

    expect(calls).toBe(2);
    expect(chunks.join('')).toBe('Here is the visible final answer.');
  });

  it('requests low excluded reasoning on the first stream so visible output starts sooner', async () => {
    let requestBody: any;

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body || '{}'));
      return sseResponse([
        JSON.stringify({
          id: 'fast-1',
          model: 'test/reasoner',
          choices: [
            {
              index: 0,
              delta: { content: 'Visible immediately.' },
              finish_reason: 'stop',
            },
          ],
        }),
        '[DONE]',
      ]);
    }) as typeof fetch;

    const provider = new OpenRouterProvider();
    await provider.initialize({ apiKey: 'test-key' });

    await provider.chatStream(
      {
        model: 'test/reasoner',
        messages: [],
      },
      () => {}
    );

    expect(requestBody.reasoning).toEqual({
      effort: 'low',
      exclude: true,
    });
  });

  it('respects an explicit caller reasoning override', async () => {
    let requestBody: any;

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body || '{}'));
      return sseResponse([
        JSON.stringify({
          id: 'override-1',
          model: 'test/reasoner',
          choices: [
            {
              index: 0,
              delta: { content: 'Answer.' },
              finish_reason: 'stop',
            },
          ],
        }),
        '[DONE]',
      ]);
    }) as typeof fetch;

    const provider = new OpenRouterProvider();
    await provider.initialize({ apiKey: 'test-key' });

    await provider.chatStream(
      {
        model: 'test/reasoner',
        messages: [],
        reasoning: { effort: 'medium', exclude: true },
      },
      () => {}
    );

    expect(requestBody.reasoning).toEqual({
      effort: 'medium',
      exclude: true,
    });
  });

  it('recovers an empty non-streaming completion used by project tool loops', async () => {
    let calls = 0;
    const reasoningModes: unknown[] = [];

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      const body = JSON.parse(String(init?.body || '{}'));
      reasoningModes.push(body.reasoning);

      if (calls === 1) {
        return new Response(
          JSON.stringify({
            id: 'empty-1',
            model: 'test/coder',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: '',
                  reasoning: 'hidden plan',
                },
                finish_reason: 'stop',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          id: 'visible-2',
          model: 'test/coder',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content:
                  '<tool_call>{"name":"create_directory","args":{"path":"notes-app"}}</tool_call>',
              },
              finish_reason: 'stop',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const provider = new OpenRouterProvider();
    await provider.initialize({ apiKey: 'test-key' });

    const response = await provider.chat({
      model: 'test/coder',
      messages: [],
      reasoning: { effort: 'none', exclude: true },
    });

    expect(calls).toBe(2);
    expect(reasoningModes[0]).toEqual({ effort: 'none', exclude: true });
    expect(reasoningModes[1]).toEqual({ effort: 'none', exclude: true });
    expect(response.content).toContain('<tool_call>');
  });

  it('falls back to a request without reasoning if disabling reasoning is still empty', async () => {
    let calls = 0;
    const bodies: any[] = [];

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      const body = JSON.parse(String(init?.body || '{}'));
      bodies.push(body);

      if (calls < 3) {
        return new Response(
          JSON.stringify({
            id: 'empty-' + calls,
            model: 'test/coder',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: '' },
                finish_reason: 'stop',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          id: 'visible-3',
          model: 'test/coder',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'visible fallback' },
              finish_reason: 'stop',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const provider = new OpenRouterProvider();
    await provider.initialize({ apiKey: 'test-key' });

    const response = await provider.chat({
      model: 'test/coder',
      messages: [],
    });

    expect(calls).toBe(3);
    expect(bodies[0].reasoning).toEqual({ effort: 'low', exclude: true });
    expect(bodies[1].reasoning).toEqual({ effort: 'none', exclude: true });
    expect('reasoning' in bodies[2]).toBe(false);
    expect(response.content).toBe('visible fallback');
  });

  it('does not retry when the original stream contains visible content', async () => {
    let calls = 0;

    globalThis.fetch = (async () => {
      calls += 1;
      return sseResponse([
        JSON.stringify({
          id: '1',
          model: 'test/model',
          choices: [
            {
              index: 0,
              delta: { content: 'Hello from the stream.' },
              finish_reason: null,
            },
          ],
        }),
        JSON.stringify({
          id: '1',
          model: 'test/model',
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: 'stop',
            },
          ],
        }),
        '[DONE]',
      ]);
    }) as typeof fetch;

    const provider = new OpenRouterProvider();
    await provider.initialize({ apiKey: 'test-key' });

    const chunks: string[] = [];
    await provider.chatStream(
      {
        model: 'test/model',
        messages: [],
      },
      (chunk) => {
        if (chunk.content) chunks.push(chunk.content);
      }
    );

    expect(calls).toBe(1);
    expect(chunks.join('')).toBe('Hello from the stream.');
  });
});
