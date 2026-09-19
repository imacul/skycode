import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ChatAgent } from '../agents/chat-agent';
import { CodingAgent } from '../agents/coding-agent';

function mockProvider(chunks: Array<{ content: string; finishReason?: string }>) {
  return {
    name: 'mock',
    async initialize() {},
    isConfigured: () => true,
    getConfig: () => ({}),
    async chat() {
      return {
        content: '',
        model: 'mock-model',
        finishReason: 'stop',
      };
    },
    async chatStream(_request: any, onChunk: (chunk: any) => void) {
      for (const chunk of chunks) {
        onChunk({
          content: chunk.content,
          finishReason: chunk.finishReason,
          usage: { totalTokens: 7 },
        });
      }
    },
    async listModels() { return []; },
    async getModel() { return undefined; },
    async validateApiKey() { return true; },
    async close() {},
  };
}

async function initialize(agent: ChatAgent | CodingAgent, provider: any) {
  await agent.initialize({
    provider,
    model: 'mock-model',
    workingDirectory: process.cwd(),
    messages: [],
  });
}

describe('stream finalization', () => {
  it('commits the full chat response when a provider ends without finish_reason', async () => {
    const agent = new ChatAgent();
    await initialize(
      agent,
      mockProvider([
        { content: 'Explanation first.\n\n```typescript\nconst x = 1;\n' },
        { content: '```\n\nAnd this text comes after the code.' },
      ])
    );

    let completed = '';
    const streamed: string[] = [];

    await agent.processStream({
      input: 'Show code and explanation',
      onStream: (chunk) => streamed.push(chunk),
      onComplete: (response) => {
        completed = response.content;
      },
    });

    expect(streamed.join('')).toContain('And this text comes after the code.');
    expect(completed).toContain('Explanation first.');
    expect(completed).toContain('const x = 1;');
    expect(completed).toContain('And this text comes after the code.');
  });

  it('waits for EOF even if finish_reason arrives before a trailing chunk', async () => {
    const agent = new ChatAgent();
    await initialize(
      agent,
      mockProvider([
        { content: 'first ', finishReason: 'stop' },
        { content: 'trailing content' },
      ])
    );

    let completed = '';
    await agent.processStream({
      input: 'test',
      onComplete: (response) => {
        completed = response.content;
      },
    });

    expect(completed).toBe('first trailing content');
  });

  it('uses the same EOF rule for ordinary coding responses', async () => {
    const agent = new CodingAgent();
    await initialize(
      agent,
      mockProvider([
        { content: 'Here is code:\n```typescript\n' },
        { content: 'const ok = true;\n```\nDone.' },
      ])
    );

    let completed = '';
    await agent.processStream({
      input: 'Explain a TypeScript boolean example',
      onComplete: (response) => {
        completed = response.content;
      },
    });

    expect(completed).toContain('Done.');
  });
});

describe('realtime chat follow', () => {
  it('forces the chat scrollbox to follow streamed chunks after layout', () => {
    const source = readFileSync(
      resolve(import.meta.dir, '../index.tsx'),
      'utf8'
    );

    expect(source).toContain('const scrollChatToBottom = useCallback');
    expect(source).toContain('current.scrollTo({ x: 0, y: current.scrollHeight })');
    expect(source).toContain('[currentResponse, isProcessing, scrollChatToBottom]');
    expect(source).toContain('setTimeout(() =>');
  });
});
