import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { lstat, realpath } from 'node:fs/promises';
import { executeTool } from '../tools';
import type { AgentContext } from './types';
import type { Message } from '../store/conversation';

export const PROJECT_TOOL_NAMES = [
  'list_files',
  'read_file',
  'search_files',
  'create_directory',
  'write_file',
] as const;

export type ProjectToolName = typeof PROJECT_TOOL_NAMES[number];

export interface ProjectToolCall {
  name: ProjectToolName;
  args: Record<string, unknown>;
}

export interface ProjectToolExecution {
  call: ProjectToolCall;
  success: boolean;
  content: string;
}

const TOOL_CALL_RE = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
const CLARIFICATION_RE = /<clarification>\s*([\s\S]*?)\s*<\/clarification>/i;
const PROJECT_PLAN_RE = /<project_plan>\s*([\s\S]*?)\s*<\/project_plan>/i;

export function shouldUseProjectTools(input: string): boolean {
  const text = input.toLowerCase();

  const projectNouns =
    /\b(project|repo|repository|website|site|app|landing page|portfolio|folder|directory|file|files|html|css|javascript|typescript|react)\b/;
  const mutationVerbs =
    /\b(create|build|scaffold|generate|make|set up|setup|write|add|implement|edit|modify|update|refactor|fix)\b/;
  const directFileIntent =
    /\b(create|write|edit|modify|update|add)\b.{0,35}\b(file|files|folder|directory|index\.html|style\.css|script\.js)\b/;

  return directFileIntent.test(text) || (projectNouns.test(text) && mutationVerbs.test(text));
}

export function parseProjectToolCalls(content: string): ProjectToolCall[] {
  const calls: ProjectToolCall[] = [];
  TOOL_CALL_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = TOOL_CALL_RE.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1]) as {
        name?: string;
        args?: Record<string, unknown>;
      };

      if (
        parsed.name &&
        PROJECT_TOOL_NAMES.includes(parsed.name as ProjectToolName) &&
        parsed.args &&
        typeof parsed.args === 'object' &&
        !Array.isArray(parsed.args)
      ) {
        calls.push({
          name: parsed.name as ProjectToolName,
          args: parsed.args,
        });
      }
    } catch {
      // Ignore malformed tool calls. The coding-agent loop can ask the model
      // for a corrected structured call before giving up.
    }
  }

  return calls;
}

export function parseProjectClarification(content: string): string | null {
  const match = CLARIFICATION_RE.exec(content);
  return match?.[1]?.trim() || null;
}

export function parseProjectPlan(content: string): Record<string, unknown> | null {
  const match = PROJECT_PLAN_RE.exec(content);
  if (!match?.[1]) return null;

  try {
    const parsed = JSON.parse(match[1]);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function stripProjectToolCalls(content: string): string {
  return content
    .replace(TOOL_CALL_RE, '')
    .replace(PROJECT_PLAN_RE, '')
    .replace(CLARIFICATION_RE, '$1')
    .trim();
}

function isPathInsideWorkspace(workspace: string, candidate: string): boolean {
  const rel = relative(workspace, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function normalizeWorkspacePath(
  workspace: string,
  value: unknown,
  label: string
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(label + ' must be a non-empty string.');
  }

  const root = resolve(workspace);
  const candidate = resolve(root, value);

  if (!isPathInsideWorkspace(root, candidate)) {
    throw new Error(
      label + ' escapes the active SkyCode workspace. Only paths inside ' + root + ' are allowed.'
    );
  }

  return candidate;
}

async function assertNoSymlinkEscape(
  workspace: string,
  candidate: string
): Promise<void> {
  const root = await realpath(resolve(workspace)).catch(() => resolve(workspace));
  let current = candidate;

  // Walk upward until an existing path is found. New files/directories may not
  // exist yet, but their nearest existing parent must still resolve inside the
  // workspace and must not be a symlink that points elsewhere.
  while (true) {
    try {
      const info = await lstat(current);
      const resolvedCurrent = info.isSymbolicLink()
        ? await realpath(current)
        : await realpath(current).catch(() => current);

      if (!isPathInsideWorkspace(root, resolvedCurrent)) {
        throw new Error(
          'Path resolves outside the active SkyCode workspace through a symbolic link.'
        );
      }
      return;
    } catch (error) {
      if (
        error instanceof Error &&
        /outside the active SkyCode workspace/.test(error.message)
      ) {
        throw error;
      }

      const parent = dirname(current);
      if (parent === current) {
        throw new Error('Could not verify the requested workspace path.');
      }
      current = parent;
    }
  }
}

export function getProjectToolInstructions(workingDirectory: string): string {
  return [
    'You can modify the active SkyCode workspace using project tools.',
    'Workspace root: ' + resolve(workingDirectory),
    '',
    'When the user explicitly asks you to create, scaffold, build, edit, or modify project files, act as both a software architect and implementation agent.',
    'Before writing files, decide whether any missing information would materially change the architecture, stack, data model, deployment target, or user-visible behavior.',
    'Ask clarification only when the answer is genuinely blocking or would cause a substantially different implementation. Do not interrogate the user about trivial choices that can be safely defaulted.',
    'When clarification is required, return ONLY one <clarification> block containing the smallest useful set of concrete questions, then wait for the user.',
    'Example: <clarification>1. Should this be React/Vite or plain HTML/CSS/JS? 2. Does the app need authentication?</clarification>',
    '',
    'When enough information is available, first think through a maintainable project architecture. You may include one machine-readable plan:',
    '<project_plan>{"stack":"React + TypeScript","structure":["src/components","src/features","src/styles"],"decisions":["feature logic separated from shared UI"]}</project_plan>',
    '',
    'Architecture rules:',
    '- Do not pack an entire non-trivial application into one file.',
    '- Separate concerns when the project size warrants it: UI/components, feature/domain logic, data/API access, utilities, configuration, types/models, assets, and styles.',
    '- Keep component-specific styles close to the component when that is idiomatic for the stack; keep global tokens/reset/theme styles separate.',
    '- Prefer feature-based or domain-based folders for medium/large apps rather than giant generic folders.',
    '- Avoid creating tiny files merely for the sake of separation; split code when it improves ownership, reuse, testing, readability, or change isolation.',
    '- Follow established conventions for the requested stack. Inspect an existing repo before imposing a new architecture.',
    '- For backend/full-stack work, keep transport/controllers/routes separate from core business/domain logic and persistence/integration code when the stack supports that pattern.',
    '- For frontend apps, keep pages/routes, reusable UI, feature logic, hooks/state, services/API clients, and styles organized rather than mixing everything into page files.',
    '- Create configuration, tests, README, environment examples, and entry points when the task actually needs them.',
    '- If the user specifies an architecture or folder convention, follow it unless it is internally inconsistent; explain conflicts rather than silently replacing it.',
    '',
    'Use one or more tool calls in exactly this format:',
    '<tool_call>{"name":"create_directory","args":{"path":"my-site"}}</tool_call>',
    '<tool_call>{"name":"write_file","args":{"path":"my-site/index.html","content":"<!doctype html>..."}}</tool_call>',
    '',
    'Available tools:',
    '- list_files: {"path":".","recursive":false}',
    '- read_file: {"path":"relative/path"}',
    '- search_files: {"path":".","query":"text","searchContent":true}',
    '- create_directory: {"path":"relative/path"}',
    '- write_file: {"path":"relative/path","content":"full file contents","overwrite":true}',
    '',
    'Rules:',
    '- All paths must stay inside the workspace root.',
    '- Prefer relative paths.',
    '- Never claim a file was created or changed unless the tool result says success.',
    '- Inspect existing files before overwriting when the request targets an existing project.',
    '- Do not delete files, run shell commands, install packages, or access paths outside the workspace through this tool set.',
    '- For a small plain HTML/CSS/JavaScript project, normally keep markup in index.html, shared presentation in one or more CSS files, and behavior in JavaScript modules instead of embedding everything in index.html.',
    '- For larger projects, create a folder structure appropriate to the stack before writing implementation files.',
    '- After tools finish, give a concise summary of the architecture and what was actually created or changed.',
  ].join('\n');
}

export async function executeProjectToolCall(
  call: ProjectToolCall,
  context: AgentContext
): Promise<ProjectToolExecution> {
  const workspace = resolve(context.workingDirectory || process.cwd());
  const args: Record<string, unknown> = { ...call.args };

  try {
    switch (call.name) {
      case 'write_file':
      case 'read_file':
      case 'create_directory': {
        args.path = normalizeWorkspacePath(workspace, args.path, 'path');
        await assertNoSymlinkEscape(workspace, args.path as string);
        args.cwd = workspace;
        break;
      }
      case 'list_files': {
        args.path = normalizeWorkspacePath(
          workspace,
          typeof args.path === 'string' ? args.path : '.',
          'path'
        );
        await assertNoSymlinkEscape(workspace, args.path as string);
        args.cwd = workspace;
        break;
      }
      case 'search_files': {
        args.path = normalizeWorkspacePath(
          workspace,
          typeof args.path === 'string' ? args.path : '.',
          'path'
        );
        await assertNoSymlinkEscape(workspace, args.path as string);
        args.cwd = workspace;
        break;
      }
    }

    const result = await executeTool(call.name, args as any, context);
    return {
      call,
      success: result.success,
      content: result.success
        ? result.content || JSON.stringify(result.data ?? {})
        : result.error || 'Tool failed without an error message.',
    };
  } catch (error) {
    return {
      call,
      success: false,
      content: error instanceof Error ? error.message : String(error),
    };
  }
}

export function projectToolResultMessage(
  executions: ProjectToolExecution[]
): Message {
  const lines = executions.map((execution) => {
    const safeArgs = { ...execution.call.args };
    if (
      execution.call.name === 'write_file' &&
      typeof safeArgs.content === 'string'
    ) {
      safeArgs.content =
        '[content omitted from tool-result echo: ' +
        safeArgs.content.length +
        ' chars]';
    }

    return JSON.stringify({
      tool: execution.call.name,
      args: safeArgs,
      success: execution.success,
      result: execution.content,
    });
  });

  return {
    id: 'tool_' + Date.now(),
    role: 'system',
    content:
      'PROJECT TOOL RESULTS\n' +
      lines.join('\n') +
      '\nContinue from these real tool results. Do not repeat successful writes unless necessary.',
    timestamp: new Date(),
  };
}
