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

      expect(body.reasoning).toEqual({ effort: 'low', exclude: true });
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
