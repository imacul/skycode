import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classifyProjectCommand,
  executeProjectToolCall,
  isProjectCapabilityQuestion,
  parseProjectClarification,
  parseProjectPlan,
  parseProjectToolCalls,
  projectToolResultMessage,
  shouldContinueProjectTools,
  shouldUseProjectTools,
  stripProjectToolCalls,
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

  it('routes broad software creation intents to project tools but not capability-only questions', () => {
    expect(shouldUseProjectTools('Build me a desktop application with Electron')).toBe(true);
    expect(shouldUseProjectTools('Create a Python CLI project with clean architecture')).toBe(true);
    expect(shouldUseProjectTools('Develop a full-stack web app in this folder')).toBe(true);

    expect(isProjectCapabilityQuestion('Can you create software?')).toBe(true);
    expect(isProjectCapabilityQuestion('Are you able to build desktop apps?')).toBe(true);
    expect(shouldUseProjectTools('Can you create software?')).toBe(false);
  });

  it('keeps short proceed/continue follow-ups in project tool mode when recent history contains a build request', () => {
    const history = [
      {
        id: 'u1',
        role: 'user' as const,
        content: 'Build a desktop notes app with Electron and TypeScript in this workspace.',
        timestamp: new Date(),
      },
      {
        id: 'a1',
        role: 'assistant' as const,
        content: 'I will inspect the workspace first.',
        timestamp: new Date(),
      },
    ];

    expect(shouldContinueProjectTools('please proceed', history)).toBe(true);
    expect(shouldContinueProjectTools('continue', history)).toBe(true);
    expect(shouldContinueProjectTools('tell me a joke', history)).toBe(false);
  });

  it('allows safe verification commands, requires approval for workspace changes, and blocks destructive commands', () => {
    expect(classifyProjectCommand('git status')).toEqual({
      allowed: true,
      requiresApproval: false,
      risk: 'read',
    });
    expect(classifyProjectCommand('npm test')).toEqual({
      allowed: true,
      requiresApproval: false,
      risk: 'verify',
    });
    expect(classifyProjectCommand('npm run build')).toEqual({
      allowed: true,
      requiresApproval: false,
      risk: 'verify',
    });

    const install = classifyProjectCommand('npm install react');
    expect(install.allowed).toBe(true);
    expect(install.requiresApproval).toBe(true);
    expect(install.permissionKey).toBe('terminal:packages');

    const commit = classifyProjectCommand('git commit -m "checkpoint"');
    expect(commit.allowed).toBe(true);
    expect(commit.requiresApproval).toBe(true);
    expect(commit.permissionKey).toBe('terminal:git-write');

    expect(classifyProjectCommand('git push').allowed).toBe(false);
    expect(classifyProjectCommand('rm -rf .').allowed).toBe(false);
    expect(classifyProjectCommand('npm test && git status').allowed).toBe(false);
  });

  it('asks for approval before a workspace-mutating terminal command and honors denial', async () => {
    const root = await workspace();
    let approvalRequest: any;

    const result = await executeProjectToolCall(
      {
        name: 'run_command',
        args: { command: 'git add .' },
      },
      context(root),
      async (request) => {
        approvalRequest = request;
        return 'deny';
      }
    );

    expect(approvalRequest.permissionKey).toBe('terminal:git-write');
    expect(approvalRequest.command).toBe('git add .');
    expect(result.success).toBe(false);
    expect(result.content).toContain('User denied terminal command');
  });

  it('does not execute approval-required commands when no approval callback exists', async () => {
    const root = await workspace();
    const result = await executeProjectToolCall(
      {
        name: 'run_command',
        args: { command: 'npm install react' },
      },
      context(root)
    );

    expect(result.success).toBe(false);
    expect(result.content).toContain('requires user approval');
  });

  it('executes safe terminal commands inside the active workspace', async () => {
    const root = await workspace();
    const result = await executeProjectToolCall(
      {
        name: 'run_command',
        args: { command: 'bun --version' },
      },
      context(root)
    );

    expect(result.success).toBe(true);
    expect(result.preview?.length).toBeGreaterThan(0);
    expect(result.displayPath).toBe('.');
  });

  it('parses DeepSeek DSML invoke syntax without forcing a retry', () => {
    const content = [
      "I'll inspect the workspace first.",
      '<|DSML|tool_call>',
      '<|DSML|invoke name="list_files">',
      '<|DSML|parameter name="path" string="true">.</|DSML|parameter>',
      '<|DSML|parameter name="recursive" string="false">true</|DSML|parameter>',
      '</|DSML|invoke>',
      '</|DSML|tool_call>',
    ].join(' ');

    expect(parseProjectToolCalls(content)).toEqual([
      {
        name: 'list_files',
        args: {
          path: '.',
          recursive: true,
        },
      },
    ]);
  });

  it('parses DSML JSON invocation with mismatched outer closer', () => {
    const content =
      '<|DSML|tool_call><|DSML|tool_call_invoke>' +
      '{"name":"write_file","args":{"path":"demo.ts","content":"export {}"}}' +
      '</|DSML|tool_call></|DSML|tool_call>';

    expect(parseProjectToolCalls(content)).toEqual([
      {
        name: 'write_file',
        args: {
          path: 'demo.ts',
          content: 'export {}',
        },
      },
    ]);
  });

  it('strips model-native DSML markup from user-facing assistant text', () => {
    const content =
      'Working now. <|DSML|tool_call><|DSML|invoke name="list_files">' +
      '<|DSML|parameter name="path" string="true">.</|DSML|parameter>' +
      '</|DSML|invoke></|DSML|tool_call>';

    expect(stripProjectToolCalls(content)).toBe('Working now.');
  });

  it('emits project tool results as user turns for strict provider compatibility', () => {
    const message = projectToolResultMessage([
      {
        call: {
          name: 'create_directory',
          args: { path: 'demo' },
        },
        success: true,
        content: 'created',
      },
    ]);

    expect(message.role).toBe('user');
    expect(message.content).toContain('PROJECT TOOL RESULTS');
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

  it('grounds capability-only questions in SkyCode rather than raw-model limitations', async () => {
    const root = await workspace();
    let systemContent = '';

    const provider = {
      name: 'mock',
      async initialize() {},
      isConfigured: () => true,
      getConfig: () => ({}),
      async chat(request: any) {
        systemContent = request.messages[0]?.content || '';
        return {
          content: 'Yes. Inside SkyCode I can architect and create real project files in the active workspace.',
          model: 'test-model',
          finishReason: 'stop',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
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

    const response = await agent.process({ input: 'Can you create software?' });

    expect(response.content).toContain('Inside SkyCode');
    expect(systemContent).toContain('You are not limited to pasting code snippets in chat.');
    expect(systemContent).toContain('create directories');
  });

  it('does not surface a false raw-model refusal as the final answer for a real build request', async () => {
    const root = await workspace();
    let calls = 0;

    const provider = {
      name: 'mock',
      async initialize() {},
      isConfigured: () => true,
      getConfig: () => ({}),
      async chat() {
        calls += 1;
        return {
          content: "I'm not able to create software or files. I can only provide code snippets.",
          model: 'test-model',
          finishReason: 'stop',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
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
      input: 'Build a desktop app in this workspace with a clean multi-file architecture.',
    });

    expect(calls).toBe(4);
    expect(response.content).toContain('SkyCode can create and structure this software');
    expect(response.content).not.toContain('I can only provide code snippets');
    expect(response.metadata?.finishReason).toBe('tool_protocol_not_followed');
  });

  it('captures file change metadata for live work rendering', async () => {
    const root = await workspace();

    await executeProjectToolCall(
      {
        name: 'write_file',
        args: {
          path: 'src/app.ts',
          content: 'const before = true;\n',
        },
      },
      context(root)
    );

    const result = await executeProjectToolCall(
      {
        name: 'write_file',
        args: {
          path: 'src/app.ts',
          content: 'const before = false;\nconst added = 42;\n',
        },
      },
      context(root)
    );

    expect(result.success).toBe(true);
    expect(result.displayPath?.replace(/\\/g, '/')).toBe('src/app.ts');
    expect(result.additions).toBeGreaterThan(0);
    expect(result.deletions).toBeGreaterThan(0);
    expect(result.preview?.some((line) => line.startsWith('+ '))).toBe(true);
    expect(result.preview?.some((line) => line.startsWith('- '))).toBe(true);
  });

  it('streams structured work activity while building files', async () => {
    const root = await workspace();
    let calls = 0;

    const provider = {
      name: 'mock',
      async initialize() {},
      isConfigured: () => true,
      getConfig: () => ({}),
      async chat() {
        calls += 1;

        if (calls === 1) {
          return {
            content:
              '<tool_call>{"name":"create_directory","args":{"path":"demo"}}</tool_call>' +
              '<tool_call>{"name":"write_file","args":{"path":"demo/index.ts","content":"export const ok = true;\\n"}}</tool_call>',
            model: 'test-model',
            finishReason: 'stop',
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          };
        }

        return {
          content: 'Built the project successfully.',
          model: 'test-model',
          finishReason: 'stop',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
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

    const activities: any[] = [];
    let completed = '';

    await agent.processStream({
      input: 'Build a TypeScript app in this workspace',
      onActivity: (activity) => activities.push(activity),
      onComplete: (response) => {
        completed = response.content;
      },
    });

    expect(activities.some((item) => item.type === 'planning')).toBe(true);
    expect(activities.some((item) => item.type === 'create' && item.status === 'success')).toBe(true);
    expect(
      activities.some(
        (item) =>
          item.type === 'write' &&
          item.status === 'success' &&
          item.path?.replace(/\\/g, '/') === 'demo/index.ts'
      )
    ).toBe(true);
    expect(completed).toContain('Built the project successfully.');
  });

  it('keeps successful workspace changes and returns a summary if the model stops afterwards', async () => {
    const root = await workspace();
    let calls = 0;

    const provider = {
      name: 'mock',
      async initialize() {},
      isConfigured: () => true,
      getConfig: () => ({}),
      async chat() {
        calls += 1;

        if (calls === 1) {
          return {
            content:
              '<tool_call>{"name":"create_directory","args":{"path":"demo"}}</tool_call>' +
              '<tool_call>{"name":"write_file","args":{"path":"demo/index.ts","content":"export const built = true;\\n"}}</tool_call>',
            model: 'test-model',
            finishReason: 'stop',
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          };
        }

        throw new Error('provider returned no visible answer');
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

    let completed: any;
    await agent.processStream({
      input: 'Build a TypeScript project here',
      onComplete: (response) => {
        completed = response;
      },
    });

    expect(await stat(join(root, 'demo/index.ts'))).toBeDefined();
    expect(completed.content).toContain('SkyCode kept the workspace changes');
    expect(completed.content).toContain('Updated 1 file.');
    expect(completed.metadata.finishReason).toBe('provider_stopped_after_tools');
  });

  it('uses project tools on a short continuation instead of falling back to plain chat', async () => {
    const root = await workspace();
    let calls = 0;

    const provider = {
      name: 'mock',
      async initialize() {},
      isConfigured: () => true,
      getConfig: () => ({}),
      async chat() {
        calls += 1;

        if (calls === 1) {
          return {
            content:
              '<tool_call>{"name":"write_file","args":{"path":"continued.txt","content":"continued"}}</tool_call>',
            model: 'test-model',
            finishReason: 'stop',
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          };
        }

        return {
          content: 'Continued the project and updated continued.txt.',
          model: 'test-model',
          finishReason: 'stop',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
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
      messages: [
        {
          id: 'u1',
          role: 'user',
          content: 'Build a TypeScript project in this workspace.',
          timestamp: new Date(),
        },
      ],
    });

    let completed = '';
    await agent.processStream({
      input: 'please proceed',
      onComplete: (response) => {
        completed = response.content;
      },
    });

    expect((await stat(join(root, 'continued.txt'))).isFile()).toBe(true);
    expect(completed).toContain('Continued the project');
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
