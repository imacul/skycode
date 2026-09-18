import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  executeProjectToolCall,
  parseProjectClarification,
  parseProjectPlan,
  parseProjectToolCalls,
  shouldUseProjectTools,
} from '../agents/project-tools';
import { CodingAgent } from '../agents/coding-agent';
import type { AgentContext } from '../agents/types';

const tempDirs: string[] = [];

async function workspace() {
  const dir = await mkdtemp(join(tmpdir(), 'skycode-project-tools-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

function context(workingDirectory: string): AgentContext {
  return {
    conversation: null,
    messages: [],
    settings: {},
    provider: null,
    model: 'test-model',
    workingDirectory,
    env: {},
  };
}

describe('project tool protocol', () => {
  it('detects project mutation intent without hijacking ordinary code questions', () => {
    expect(
      shouldUseProjectTools(
        'Create a portfolio website in ./portfolio with HTML CSS and JavaScript'
      )
    ).toBe(true);
    expect(shouldUseProjectTools('Explain how Array.map works')).toBe(false);
  });

  it('parses blocking clarification requests', () => {
    expect(
      parseProjectClarification(
        '<clarification>Which stack should this use?</clarification>'
      )
    ).toBe('Which stack should this use?');
  });

  it('parses an architecture plan without treating it as a tool call', () => {
    const plan = parseProjectPlan(
      '<project_plan>{"stack":"React","structure":["src/features","src/components"]}</project_plan>'
    );

    expect(plan?.stack).toBe('React');
    expect(plan?.structure).toEqual(['src/features', 'src/components']);
  });

  it('parses supported structured tool calls', () => {
    const calls = parseProjectToolCalls(
      '<tool_call>{"name":"write_file","args":{"path":"site/index.html","content":"hi"}}</tool_call>'
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('write_file');
    expect(calls[0].args.path).toBe('site/index.html');
  });

  it('writes files inside the active workspace', async () => {
    const root = await workspace();
    const result = await executeProjectToolCall(
      {
        name: 'write_file',
        args: { path: 'site/index.html', content: '<h1>Hello</h1>' },
      },
      context(root)
    );

    expect(result.success).toBe(true);
    expect(await readFile(join(root, 'site', 'index.html'), 'utf8')).toBe(
      '<h1>Hello</h1>'
    );
  });

  it('blocks paths that escape the active workspace', async () => {
    const root = await workspace();
    const result = await executeProjectToolCall(
      {
        name: 'write_file',
        args: { path: '../outside.txt', content: 'nope' },
      },
      context(root)
    );

    expect(result.success).toBe(false);
    expect(result.content).toContain('escapes the active SkyCode workspace');
  });

  it('lets the coding agent create a real multi-file project from model tool calls', async () => {
    const root = await workspace();
    let call = 0;

    const provider = {
      name: 'mock',
      async initialize() {},
      isConfigured: () => true,
      getConfig: () => ({}),
      async chat() {
        call += 1;

        if (call === 1) {
          return {
            content: [
              '<tool_call>{"name":"create_directory","args":{"path":"demo"}}</tool_call>',
              '<tool_call>{"name":"write_file","args":{"path":"demo/index.html","content":"<!doctype html><link rel=\\\"stylesheet\\\" href=\\\"style.css\\\"><script src=\\\"script.js\\\"></script>"}}</tool_call>',
              '<tool_call>{"name":"write_file","args":{"path":"demo/style.css","content":"body { font-family: sans-serif; }"}}</tool_call>',
              '<tool_call>{"name":"write_file","args":{"path":"demo/script.js","content":"console.log(\\\"ready\\\");"}}</tool_call>',
            ].join('\n'),
            model: 'test-model',
            finishReason: 'stop',
            usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
          };
        }

        return {
          content: 'Created demo/index.html, demo/style.css, and demo/script.js.',
          model: 'test-model',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
        };
      },
      async chatStream() {},
      async listModels() { return []; },
      async getModel() { return undefined; },
      async validateApiKey() { return true; },
      async close() {},
    };

    const agent = new CodingAgent();
    await agent.initialize({
      provider: provider as any,
      model: 'test-model',
      workingDirectory: root,
      messages: [],
    });

    const response = await agent.process({
      input: 'Create an HTML CSS and JavaScript project in a demo folder.',
    });

    expect(response.content).toContain('Created demo/index.html');
    expect((await stat(join(root, 'demo', 'index.html'))).isFile()).toBe(true);
    expect((await stat(join(root, 'demo', 'style.css'))).isFile()).toBe(true);
    expect((await stat(join(root, 'demo', 'script.js'))).isFile()).toBe(true);
  });
});
