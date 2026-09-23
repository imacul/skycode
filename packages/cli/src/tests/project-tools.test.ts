import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
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
  expandShellCommand,
  listWorkspaceProcesses,
  recoverImpliedToolCall,
  shouldContinueProjectTools,
  shouldResumeWorkspaceTask,
  shouldUseProjectTools,
  stopAllBackgroundProcesses,
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
  await stopAllBackgroundProcesses();
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
    expect(classifyProjectCommand('npm start').requiresApproval).toBe(false);
    expect(classifyProjectCommand('type logs/app.log')).toEqual({
      allowed: true,
      requiresApproval: false,
      risk: 'read',
    });
    expect(classifyProjectCommand('curl http://127.0.0.1:3000/').requiresApproval).toBe(false);

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

    const general = classifyProjectCommand('node scripts/generate.js');
    expect(general.allowed).toBe(true);
    expect(general.requiresApproval).toBe(true);
    expect(general.permissionKey).toBe('terminal:general');
  });

  it('runs project verification commands without stopping for approval', async () => {
    const root = await workspace();
    let asked = false;

    const result = await executeProjectToolCall(
      {
        name: 'run_command',
        args: { command: 'bun test', reason: 'Verify the implementation with the test suite.' },
      },
      context(root),
      async () => {
        asked = true;
        return 'deny';
      }
    );

    expect(asked).toBe(false);
    expect(result.content.toLowerCase()).not.toContain('requires user approval');
    expect(result.content.length).toBeGreaterThan(0);
  });

  it('asks for approval before a workspace-mutating terminal command and honors denial', async () => {
    const root = await workspace();
    let approvalRequest: any;

    const result = await executeProjectToolCall(
      {
        name: 'run_command',
        args: { command: 'git add .', reason: 'Stage the completed workspace changes.' },
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
        args: { command: 'npm install react', reason: 'Install React because the requested app depends on it.' },
      },
      context(root)
    );

    expect(result.success).toBe(false);
    expect(result.content).toContain('requires user approval');
  });

  it('requires an explanation before asking approval for executable commands', async () => {
    const root = await workspace();
    let asked = false;
    const result = await executeProjectToolCall(
      { name: 'run_command', args: { command: 'node scripts/generate.js' } },
      context(root),
      async () => {
        asked = true;
        return 'once';
      }
    );
    expect(asked).toBe(false);
    expect(result.success).toBe(false);
    expect(result.content).toContain('requires a concise reason');
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

  it('accepts OpenAI-style arguments objects as tool args', () => {
    expect(
      parseProjectToolCalls(
        '<tool_call>{"name":"run_command","arguments":{"command":"bun test"}}</tool_call>'
      )
    ).toEqual([{ name: 'run_command', args: { command: 'bun test' } }]);
  });

  it('recovers a single fenced command instead of treating it as a finished answer', () => {
    expect(recoverImpliedToolCall('```powershell\nbun --version\n```')).toEqual({
      name: 'run_command',
      args: {
        command: 'bun --version',
        reason: 'The model wrote this command instead of a tool call, so SkyCode is running it.',
      },
    });
    expect(recoverImpliedToolCall('```bash\nnpm test && git status\n```')).toBeNull();
  });

  it('reads a workspace log without an approval pause', async () => {
    const root = await workspace();
    await mkdir(join(root, 'logs'));
    await writeFile(join(root, 'logs', 'app.log'), 'server-ready\n', 'utf8');

    const result = await executeProjectToolCall(
      { name: 'run_command', args: { command: 'type logs\\app.log' } },
      context(root)
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain('server-ready');
  });

  it('starts an app in the background, reads its logs, and stops it', async () => {
    const root = await workspace();
    await writeFile(
      join(root, 'server.js'),
      "console.log('server-up');\nsetInterval(() => {}, 1000);\n",
      'utf8'
    );

    const started = await executeProjectToolCall(
      {
        name: 'start_process',
        args: {
          command: 'bun server.js',
          reason: 'Boot the app so its logs can be checked.',
        },
      },
      context(root),
      async () => 'once'
    );

    expect(started.success).toBe(true);
    expect(started.content).toContain('server-up');

    const logs = await executeProjectToolCall(
      { name: 'read_process_logs', args: {} },
      context(root)
    );
    expect(logs.success).toBe(true);
    expect(logs.content).toContain('status: running');
    expect(logs.content).toContain('server-up');

    const stopped = await executeProjectToolCall(
      { name: 'stop_process', args: {} },
      context(root)
    );
    expect(stopped.success).toBe(true);
    expect(stopped.content).toContain('Stopped background process');
  });

  it('normalizes generic terminal XML calls to run_command', () => {
    const content =
      '<tool_call>terminal <arg_key>command</arg_key> <arg_value>npm test</arg_value> </tool_call>';

    expect(parseProjectToolCalls(content)).toEqual([
      { name: 'run_command', args: { command: 'npm test' } },
    ]);
    expect(stripProjectToolCalls(content)).toBe('');
  });

  it('parses compact XML argument tool calls without stopping the agent', () => {
    const content =
      '<tool_call>create_directory <arg_key>path</arg_key> <arg_value>computer-tools-v1-test</arg_value> </tool_call>';

    expect(parseProjectToolCalls(content)).toEqual([
      {
        name: 'create_directory',
        args: { path: 'computer-tools-v1-test' },
      },
    ]);
    expect(stripProjectToolCalls(content)).toBe('');
  });

  it('parses mixed SkyCode opener with DSML closer emitted by DeepSeek', () => {
    const content =
      '<tool_call>{"name":"create_directory","args":{"path":"add-numbers/src"}}</|DSML|tool_call>';

    expect(parseProjectToolCalls(content)).toEqual([
      {
        name: 'create_directory',
        args: { path: 'add-numbers/src' },
      },
    ]);
    expect(stripProjectToolCalls(content)).toBe('');
  });

  it('recovers DeepSeek write_file calls that omit name and args wrappers', () => {
    const content =
      '<tool_call>{"path":"add-numbers/src/add.js","contents":"export function add(a, b) {\\n  return a + b;\\n}\\n","calls":[]}</tool_call>';

    expect(parseProjectToolCalls(content)).toEqual([
      {
        name: 'write_file',
        args: {
          path: 'add-numbers/src/add.js',
          content: 'export function add(a, b) {\n  return a + b;\n}\n',
        },
      },
    ]);
    expect(stripProjectToolCalls(content)).toBe('');
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

  it('keeps working when the model pauses to describe the next command', async () => {
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
              '<tool_call>{"name":"write_file","args":{"path":"app.js","content":"console.log(1);\\n"}}</tool_call>',
            model: 'test-model',
            finishReason: 'stop',
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          };
        }
        if (calls === 2) {
          return {
            content: "I'll run the tests next.",
            model: 'test-model',
            finishReason: 'stop',
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          };
        }
        if (calls === 3) {
          return {
            content:
              '<tool_call>{"name":"run_command","args":{"command":"bun --version"}}</tool_call>',
            model: 'test-model',
            finishReason: 'stop',
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          };
        }
        return {
          content: 'Verified the workspace.',
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
      input: 'Build a small Node app in this workspace and test it.',
    });

    expect(calls).toBe(4);
    expect(response.content).toContain('Verified the workspace.');
    expect((await stat(join(root, 'app.js'))).isFile()).toBe(true);
  });

  it('runs a fenced shell command instead of ending the task', async () => {
    const root = await workspace();
    let calls = 0;
    const activities: any[] = [];

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
              '<tool_call>{"name":"write_file","args":{"path":"app.js","content":"console.log(1);\\n"}}</tool_call>',
            model: 'test-model',
            finishReason: 'stop',
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          };
        }
        if (calls === 2) {
          return {
            content: '```powershell\nbun --version\n```',
            model: 'test-model',
            finishReason: 'stop',
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          };
        }
        return {
          content: 'Checked the runtime.',
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

    let completed = '';
    await agent.processStream({
      input: 'Build a small Node app in this workspace and test it.',
      onActivity: (activity) => activities.push(activity),
      onComplete: (response) => {
        completed = response.content;
      },
    });

    expect(completed).toContain('Checked the runtime.');
    expect(
      activities.some(
        (item) =>
          item.type === 'terminal' &&
          item.status === 'success' &&
          String(item.path).includes('bun --version')
      )
    ).toBe(true);
  });

  it('leaves a healthy app running and streams its logs after the task ends', async () => {
    const root = await workspace();
    await writeFile(
      join(root, 'server.js'),
      "console.log('server-up');\nsetInterval(() => {}, 1000);\n",
      'utf8'
    );
    let calls = 0;
    const activities: any[] = [];

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
              '<tool_call>{"name":"start_process","args":{"command":"bun server.js","reason":"Boot the app so it can be tested."}}</tool_call>',
            model: 'test-model',
            finishReason: 'stop',
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          };
        }
        return {
          content: 'The app is up.',
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
      input: 'Build a small Node app in this workspace and test it.',
      onApproval: async () => 'once',
      onActivity: (activity) => activities.push(activity),
    });

    expect(response.content).toContain('The app is up.');
    expect(response.content).toContain('Still running in this workspace:');
    expect(response.content).toContain('bun server.js');
    expect(shouldResumeWorkspaceTask('continue', 'completed')).toBe(true);
    expect(shouldResumeWorkspaceTask('continue', 'running')).toBe(true);
    expect(shouldResumeWorkspaceTask('continue', 'blocked')).toBe(false);
    expect(shouldResumeWorkspaceTask('add a button', 'completed')).toBe(false);

    const chained =
      '<tool_call>terminal <arg_key>command</arg_key> <arg_value>ls -la /workspace/computer-tools-v1-test/ && cat /workspace/computer-tools-v1-test/package.json && cat /workspace/computer-tools-v1-test/add.js && cat /workspace/computer-tools-v1-test/add.test.js</arg_value> </tool_call>';
    const parsed = parseProjectToolCalls(chained);
    expect(parsed).toEqual([
      {
        name: 'run_command',
        args: {
          command:
            'ls -la /workspace/computer-tools-v1-test/ && cat /workspace/computer-tools-v1-test/package.json && cat /workspace/computer-tools-v1-test/add.js && cat /workspace/computer-tools-v1-test/add.test.js',
        },
      },
    ]);
    expect(
      expandShellCommand(String(parsed[0].args.command), root)?.map((call) => ({
        name: call.name,
        path: call.args.path,
      }))
    ).toEqual([
      { name: 'list_files', path: 'computer-tools-v1-test' },
      { name: 'read_file', path: 'computer-tools-v1-test/package.json' },
      { name: 'read_file', path: 'computer-tools-v1-test/add.js' },
      { name: 'read_file', path: 'computer-tools-v1-test/add.test.js' },
    ]);

    expect(listWorkspaceProcesses(root).filter((proc) => proc.running)).toHaveLength(1);
    expect(
      activities.some(
        (item) =>
          item.title === 'App logs' &&
          item.preview?.some((line: string) => String(line).includes('server-up'))
      )
    ).toBe(true);
  });

  it('runs a chained /workspace inspection instead of showing the tool call', async () => {
    const root = await workspace();
    const project = join(root, 'computer-tools-v1-test');
    await mkdir(project, { recursive: true });
    await writeFile(join(project, 'package.json'), '{"name":"add"}\n', 'utf8');
    await writeFile(join(project, 'add.js'), 'module.exports = (a, b) => a + b;\n', 'utf8');
    await writeFile(join(project, 'add.test.js'), 'test("add", () => {});\n', 'utf8');

    let calls = 0;
    const activities: any[] = [];
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
              '<tool_call>terminal <arg_key>command</arg_key> <arg_value>ls -la /workspace/computer-tools-v1-test/ && cat /workspace/computer-tools-v1-test/package.json && cat /workspace/computer-tools-v1-test/add.js && cat /workspace/computer-tools-v1-test/add.test.js</arg_value> </tool_call>',
            model: 'test-model',
            finishReason: 'stop',
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          };
        }
        return {
          content: 'Inspected the project files.',
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
      input: 'continue',
      taskKind: 'workspace',
      taskState: 'running',
      onActivity: (activity) => activities.push(activity),
    });

    expect(response.content).toContain('Inspected the project files.');
    expect(response.content).not.toContain('<tool_call>');
    expect(
      activities.some(
        (item) =>
          item.status === 'success' &&
          String(item.path || '').replace(/\\/g, '/') === 'computer-tools-v1-test/package.json'
      )
    ).toBe(true);
  });
});
