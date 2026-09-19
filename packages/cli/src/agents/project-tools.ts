import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { lstat, realpath, readFile } from 'node:fs/promises';
import { executeTool } from '../tools';
import type {
  AgentApprovalDecision,
  AgentApprovalRequest,
  AgentContext,
} from './types';
import type { Message } from '../store/conversation';

export const PROJECT_TOOL_NAMES = [
  'list_files',
  'read_file',
  'search_files',
  'create_directory',
  'write_file',
  'run_command',
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
  displayPath?: string;
  additions?: number;
  deletions?: number;
  preview?: string[];
}

const TOOL_CALL_RE = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
const CLARIFICATION_RE = /<clarification>\s*([\s\S]*?)\s*<\/clarification>/i;
const PROJECT_PLAN_RE = /<project_plan>\s*([\s\S]*?)\s*<\/project_plan>/i;

export function isProjectCapabilityQuestion(input: string): boolean {
  const text = input.toLowerCase().trim();
  return (
    /\b(can|could|would)\s+you\s+(create|build|make|develop|scaffold|code)\b/.test(text) ||
    /\bare\s+you\s+able\s+to\s+(create|build|make|develop|scaffold|code)\b/.test(text) ||
    /\bdo\s+you\s+have\s+the\s+(ability|capability)\s+to\s+(create|build|make|develop|scaffold|code)\b/.test(text)
  );
}

export function shouldUseProjectTools(input: string): boolean {
  const text = input.toLowerCase();

  if (isProjectCapabilityQuestion(text)) return false;

  const projectNouns =
    /\b(project|repo|repository|software|website|site|web app|desktop app|desktop application|mobile app|application|app|cli|command-line tool|service|backend|frontend|full-stack|full stack|api|landing page|portfolio|folder|directory|file|files|html|css|javascript|typescript|react|next\.js|vue|svelte|node(?:\.js)?|python|rust|go|java|c#|\.net|electron|tauri)\b/;
  const mutationVerbs =
    /\b(create|build|develop|scaffold|generate|make|set up|setup|write|add|implement|edit|modify|update|refactor|fix|architect|structure)\b/;
  const directFileIntent =
    /\b(create|write|edit|modify|update|add)\b.{0,35}\b(file|files|folder|directory|index\.html|style\.css|script\.js)\b/;

  return directFileIntent.test(text) || (projectNouns.test(text) && mutationVerbs.test(text));
}


export function shouldContinueProjectTools(
  input: string,
  messages: Message[]
): boolean {
  const clean = input.trim().toLowerCase();
  const continuation =
    /^(?:please\s+)?(?:proceed|continue|continue please|go ahead|keep going|carry on|finish(?: it)?|complete(?: it)?|resume|do it|yes|yeah|yep|ok|okay)(?:\s+(?:please|with it|from there|the work|the project))?[.!?]*$/i;

  if (!continuation.test(clean)) return false;

  const recentUserMessages = [...messages]
    .reverse()
    .filter((message) => message.role === 'user')
    .slice(0, 6);

  return recentUserMessages.some((message) => shouldUseProjectTools(message.content));
}

function coerceDsmlScalar(value: string, declaredString?: string): unknown {
  const clean = value.trim();

  if (declaredString === 'true') return clean;
  if (declaredString === 'false') {
    if (clean === 'true') return true;
    if (clean === 'false') return false;
    if (/^-?\d+(?:\.\d+)?$/.test(clean)) return Number(clean);

    try {
      return JSON.parse(clean);
    } catch {
      return clean;
    }
  }

  if (clean === 'true') return true;
  if (clean === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(clean)) return Number(clean);
  return clean;
}

function normalizeDsmlMarkup(content: string): string {
  return content
    .replace(/<\s*∩╜£\s*DSML\s*∩╜£/gi, '<|DSML|')
    .replace(/<\s*\/\s*∩╜£\s*DSML\s*∩╜£/gi, '</|DSML|')
    .replace(/<\s*｜\s*DSML\s*｜/gi, '<|DSML|')
    .replace(/<\s*\/\s*｜\s*DSML\s*｜/gi, '</|DSML|');
}

function pushProjectToolCall(
  calls: ProjectToolCall[],
  name: unknown,
  args: unknown
): void {
  if (
    typeof name === 'string' &&
    PROJECT_TOOL_NAMES.includes(name as ProjectToolName) &&
    args &&
    typeof args === 'object' &&
    !Array.isArray(args)
  ) {
    calls.push({
      name: name as ProjectToolName,
      args: args as Record<string, unknown>,
    });
  }
}

export function parseProjectToolCalls(content: string): ProjectToolCall[] {
  const calls: ProjectToolCall[] = [];
  const normalized = normalizeDsmlMarkup(content);

  TOOL_CALL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOOL_CALL_RE.exec(normalized)) !== null) {
    try {
      const parsed = JSON.parse(match[1]) as {
        name?: string;
        args?: Record<string, unknown>;
      };
      pushProjectToolCall(calls, parsed.name, parsed.args);
    } catch {
      // Other model-native tool syntaxes are handled below.
    }
  }

  // DeepSeek and several OpenRouter-hosted models may emit DSML-style tool
  // calls even when asked for SkyCode's XML+JSON envelope. Accept that native
  // form rather than making the model retry repeatedly.
  const dsmlJsonRe =
    /<\|DSML\|(?:tool_call_invoke|invoke_json)>\s*([\s\S]*?)\s*(?=<\/\|DSML\|(?:tool_call_invoke|invoke_json|tool_call)>)/gi;
  while ((match = dsmlJsonRe.exec(normalized)) !== null) {
    try {
      const parsed = JSON.parse(match[1]) as {
        name?: string;
        args?: Record<string, unknown>;
      };
      pushProjectToolCall(calls, parsed.name, parsed.args);
    } catch {
      // Ignore malformed JSON and continue to the tag parser.
    }
  }

  const dsmlInvokeRe =
    /<\|DSML\|invoke\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/\|DSML\|invoke>/gi;
  while ((match = dsmlInvokeRe.exec(normalized)) !== null) {
    const name = match[1];
    const body = match[2];
    const args: Record<string, unknown> = {};
    const paramRe =
      /<\|DSML\|parameter\s+name=["']([^"']+)["'](?:\s+string=["']([^"']+)["'])?\s*>([\s\S]*?)<\/\|DSML\|parameter>/gi;

    let paramMatch: RegExpExecArray | null;
    while ((paramMatch = paramRe.exec(body)) !== null) {
      args[paramMatch[1]] = coerceDsmlScalar(paramMatch[3], paramMatch[2]);
    }

    pushProjectToolCall(calls, name, args);
  }

  // De-duplicate calls because some models wrap the same DSML invocation in
  // more than one marker.
  const seen = new Set<string>();
  return calls.filter((call) => {
    const key = call.name + ':' + JSON.stringify(call.args);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
  const normalized = normalizeDsmlMarkup(content);

  return normalized
    .replace(TOOL_CALL_RE, '')
    .replace(
      /<\|DSML\|tool_call>\s*[\s\S]*?<\/\|DSML\|tool_call>/gi,
      ''
    )
    .replace(
      /<\|DSML\|(?:tool_call_invoke|invoke_json)>\s*[\s\S]*?<\/\|DSML\|(?:tool_call_invoke|invoke_json)>/gi,
      ''
    )
    .replace(
      /<\|DSML\|invoke\s+name=["'][^"']+["']\s*>[\s\S]*?<\/\|DSML\|invoke>/gi,
      ''
    )
    .replace(PROJECT_PLAN_RE, '')
    .replace(CLARIFICATION_RE, '$1')
    .trim();
}


export interface ProjectCommandPolicy {
  allowed: boolean;
  requiresApproval: boolean;
  risk: 'read' | 'verify' | 'workspace' | 'git-write' | 'blocked';
  permissionKey?: string;
  description?: string;
  reason?: string;
}

export function classifyProjectCommand(command: string): ProjectCommandPolicy {
  const clean = command.trim();

  if (!clean) {
    return {
      allowed: false,
      requiresApproval: false,
      risk: 'blocked',
      reason: 'Command is empty.',
    };
  }

  if (/[\r\n;&|><\x60]/.test(clean) || /\$\(/.test(clean)) {
    return {
      allowed: false,
      requiresApproval: false,
      risk: 'blocked',
      reason:
        'Shell chaining, redirects, pipes, command substitution, and multiline commands are not allowed.',
    };
  }

  if (/(?:^|\s)(?:\.\.[\\/]|[A-Za-z]:[\\/]|\/(?!\/))/.test(clean)) {
    return {
      allowed: false,
      requiresApproval: false,
      risk: 'blocked',
      reason:
        'Terminal commands must stay inside the active workspace and may not reference parent or absolute paths.',
    };
  }

  const destructive =
    /\b(rm|rmdir|del|erase|format|mkfs|shutdown|reboot|halt|poweroff)\b|\bgit\s+(reset|clean|checkout\s+--|restore\s+--staged|push|rebase)\b|\b(remove-item|clear-content|set-acl)\b/i;

  if (destructive.test(clean)) {
    return {
      allowed: false,
      requiresApproval: false,
      risk: 'blocked',
      reason:
        'Destructive, publishing, history-rewriting, or system-management commands are blocked.',
    };
  }

  if (/^(?:npm|pnpm|yarn|bun)\s+publish\b/i.test(clean)) {
    return {
      allowed: false,
      requiresApproval: false,
      risk: 'blocked',
      reason: 'Package publishing is blocked from autonomous terminal access.',
    };
  }

  if (/^git\s+(?:add|commit)\b/i.test(clean)) {
    return {
      allowed: true,
      requiresApproval: true,
      risk: 'git-write',
      permissionKey: 'terminal:git-write',
      description: 'This command changes Git staging/history in the active workspace.',
    };
  }

  const formatter =
    /^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:format|fix)(?::[\w-]+)?\b/i;
  if (formatter.test(clean)) {
    return {
      allowed: true,
      requiresApproval: true,
      risk: 'workspace',
      permissionKey: 'terminal:format',
      description: 'This command may rewrite project files using a formatter or fixer.',
    };
  }

  const packageMutation =
    /^(?:npm|pnpm|yarn|bun)\s+(?:install|add|remove|uninstall|update|upgrade|link|init|create)\b/i;
  if (packageMutation.test(clean)) {
    return {
      allowed: true,
      requiresApproval: true,
      risk: 'workspace',
      permissionKey: 'terminal:packages',
      description: 'This command may install/remove packages or modify dependency files.',
    };
  }

  if (/^npx\s+(?!tsc\b)/i.test(clean)) {
    return {
      allowed: true,
      requiresApproval: true,
      risk: 'workspace',
      permissionKey: 'terminal:generator',
      description: 'This command may download/execute a package or generator in the workspace.',
    };
  }

  const readOnlyPatterns = [
    /^git\s+(?:status|diff|log|show|branch(?:\s+--show-current)?|rev-parse|ls-files)\b/i,
    /^(?:node|npm|pnpm|yarn|bun|python|python3|pip|pip3|cargo|rustc|go|java|javac|dotnet)\s+(?:--version|-v|version)\b/i,
    /^where\s+\S+/i,
    /^which\s+\S+/i,
  ];

  if (readOnlyPatterns.some((pattern) => pattern.test(clean))) {
    return { allowed: true, requiresApproval: false, risk: 'read' };
  }

  const verifyPatterns = [
    /^(?:npm|pnpm|yarn)\s+(?:test|run\s+(?:test|build|lint|typecheck|check)(?::[\w-]+)?)\b/i,
    /^bun\s+(?:test|run\s+(?:test|build|lint|typecheck|check)(?::[\w-]+)?)\b/i,
    /^npx\s+tsc\b/i,
    /^tsc\b/i,
    /^(?:pytest|python\s+-m\s+pytest|python3\s+-m\s+pytest)\b/i,
    /^cargo\s+(?:test|check|build|clippy|fmt\s+--\s+--check)\b/i,
    /^go\s+(?:test|vet|build)\b/i,
    /^dotnet\s+(?:test|build)\b/i,
    /^mvn\s+(?:test|verify)\b/i,
    /^gradle\s+(?:test|build)\b/i,
    /^\.\/gradlew\s+(?:test|build)\b/i,
  ];

  if (verifyPatterns.some((pattern) => pattern.test(clean))) {
    return { allowed: true, requiresApproval: false, risk: 'verify' };
  }

  return {
    allowed: false,
    requiresApproval: false,
    risk: 'blocked',
    reason: 'Command is outside SkyCode’s terminal policy.',
  };
}

function safeTerminalEnv(
  source: Record<string, string | undefined>
): Record<string, string> {
  const allowedKeys = [
    'PATH',
    'Path',
    'PATHEXT',
    'SystemRoot',
    'SYSTEMROOT',
    'WINDIR',
    'ComSpec',
    'COMSPEC',
    'TEMP',
    'TMP',
    'HOME',
    'USERPROFILE',
    'LOCALAPPDATA',
    'APPDATA',
    'PROGRAMDATA',
  ];

  const env: Record<string, string> = {};
  for (const key of allowedKeys) {
    const value = source[key] ?? process.env[key];
    if (typeof value === 'string' && value.length > 0) {
      env[key] = value;
    }
  }

  // Keep child process behavior predictable while intentionally excluding
  // provider API keys, tokens, and arbitrary user secrets.
  env.NO_COLOR = '1';
  return env;
}

function terminalPreview(content: string): string[] {
  const lines = content
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter(Boolean);
  const tail = lines.slice(-12);
  return tail.length > 0 ? tail : ['(no output)'];
}

function lineDiffSummary(before: string, after: string): {
  additions: number;
  deletions: number;
  preview: string[];
} {
  const beforeLines = before.length === 0
    ? []
    : before.replace(/\r\n?/g, '\n').split('\n');
  const afterLines = after.length === 0
    ? []
    : after.replace(/\r\n?/g, '\n').split('\n');

  let prefix = 0;
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1;
  }

  let beforeSuffix = beforeLines.length - 1;
  let afterSuffix = afterLines.length - 1;
  while (
    beforeSuffix >= prefix &&
    afterSuffix >= prefix &&
    beforeLines[beforeSuffix] === afterLines[afterSuffix]
  ) {
    beforeSuffix -= 1;
    afterSuffix -= 1;
  }

  const removed = beforeLines.slice(prefix, beforeSuffix + 1);
  const added = afterLines.slice(prefix, afterSuffix + 1);
  const preview: string[] = [];

  for (const line of removed.slice(0, 4)) preview.push('- ' + line);
  for (const line of added.slice(0, 6)) preview.push('+ ' + line);

  if (removed.length + added.length > preview.length) {
    preview.push('…');
  }

  return {
    additions: added.length,
    deletions: removed.length,
    preview,
  };
}

function workspaceDisplayPath(workspace: string, absolutePath: string): string {
  const rel = relative(resolve(workspace), absolutePath);
  return rel || '.';
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
    '- run_command: {"command":"npm test","timeout":120000} — safe verification/read commands only; SkyCode runs it inside the active workspace.',
    '',
    'Terminal rules:',
    '- Use run_command to inspect or verify your work when useful: git status/diff, test suites, builds, lint, type checks, and tool/runtime version checks.',
    '- After non-trivial code changes, prefer at least one relevant verification command when the existing project exposes one. Inspect package/config files first so you do not invent scripts.',
    '- Use failed command output as debugging evidence: fix the files, then rerun the relevant verification command.',
    '- Run one command per tool call. Do not use shell chaining, pipes, redirects, subshells, or multiline commands.',
    '- Package installation, package generators, git publishing/history rewrites, destructive filesystem commands, and system-management commands are blocked until SkyCode has an explicit approval UI.',
    '- If a needed command is blocked, continue with file work where possible and tell the user exactly which manual/approval-requiring command remains.',
    '',
    'Rules:',
    '- All paths must stay inside the workspace root.',
    '- Prefer relative paths.',
    '- Never claim a file was created or changed unless the tool result says success.',
    '- Inspect existing files before overwriting when the request targets an existing project.',
    '- Do not delete files, install packages, publish code, rewrite git history, or access paths outside the workspace. Shell access is limited to the safe run_command policy above.',
    '- For a small plain HTML/CSS/JavaScript project, normally keep markup in index.html, shared presentation in one or more CSS files, and behavior in JavaScript modules instead of embedding everything in index.html.',
    '- For larger projects, create a folder structure appropriate to the stack before writing implementation files.',
    '- Batch independent tool calls in the same response whenever possible. Do not spend one model round trip per file; SkyCode can execute multiple create_directory/write_file calls from one response.',
    '- After tools finish, give a concise summary of the architecture and what was actually created or changed.',
  ].join('\n');
}

export async function executeProjectToolCall(
  call: ProjectToolCall,
  context: AgentContext,
  requestApproval?: (
    request: AgentApprovalRequest
  ) => Promise<AgentApprovalDecision>
): Promise<ProjectToolExecution> {
  const workspace = resolve(context.workingDirectory || process.cwd());
  const args: Record<string, unknown> = { ...call.args };
  let beforeWrite = '';
  let writeTarget: string | undefined;

  try {
    switch (call.name) {
      case 'write_file':
      case 'read_file':
      case 'create_directory': {
        args.path = normalizeWorkspacePath(workspace, args.path, 'path');
        await assertNoSymlinkEscape(workspace, args.path as string);
        args.cwd = workspace;

        if (call.name === 'write_file') {
          writeTarget = args.path as string;
          beforeWrite = await readFile(writeTarget, 'utf8').catch(() => '');
        }
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
      case 'run_command': {
        if (typeof args.command !== 'string' || !args.command.trim()) {
          throw new Error('command must be a non-empty string.');
        }

        const policy = classifyProjectCommand(args.command);
        if (!policy.allowed) {
          throw new Error(
            'Terminal command blocked: ' +
              (policy.reason || 'This command is not allowed by SkyCode.')
          );
        }

        if (policy.requiresApproval) {
          if (!requestApproval || !policy.permissionKey) {
            throw new Error(
              'Terminal command requires user approval before it can run: ' +
                args.command
            );
          }

          const decision = await requestApproval({
            id: 'approval_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
            type: 'terminal',
            title:
              policy.risk === 'git-write'
                ? 'Approve Git workspace change'
                : 'Approve workspace command',
            description:
              policy.description ||
              'This command can change the active workspace.',
            command: args.command,
            permissionKey: policy.permissionKey,
            risk: policy.risk === 'git-write' ? 'git-write' : 'workspace',
          });

          if (decision === 'deny') {
            throw new Error('User denied terminal command: ' + args.command);
          }
        }

        args.cwd = workspace;
        args.timeout = Math.min(
          Math.max(Number(args.timeout || 120000), 1000),
          120000
        );
        args.captureOutput = true;
        args.env = safeTerminalEnv(context.env || {});
        break;
      }
    }

    const result = await executeTool(call.name, args as any, context);

    let resultContent = result.success
      ? result.content || JSON.stringify(result.data ?? {})
      : result.error || 'Tool failed without an error message.';

    if (call.name === 'run_command' && !result.success && result.data) {
      const data = result.data as {
        stdout?: string;
        stderr?: string;
        exitCode?: number | null;
      };
      resultContent = [
        typeof data.stdout === 'string' ? data.stdout.trim() : '',
        typeof data.stderr === 'string' ? data.stderr.trim() : '',
        result.error || '',
        typeof data.exitCode === 'number' ? 'exit code: ' + data.exitCode : '',
      ]
        .filter(Boolean)
        .join('\n');
    }

    const execution: ProjectToolExecution = {
      call,
      success: result.success,
      content: resultContent,
    };

    if (typeof args.path === 'string') {
      execution.displayPath = workspaceDisplayPath(workspace, args.path);
    }

    if (call.name === 'run_command') {
      execution.displayPath = '.';
      execution.preview = terminalPreview(execution.content);
    }

    if (
      result.success &&
      call.name === 'write_file' &&
      writeTarget &&
      typeof call.args.content === 'string'
    ) {
      const diff = lineDiffSummary(beforeWrite, call.args.content);
      execution.additions = diff.additions;
      execution.deletions = diff.deletions;
      execution.preview = diff.preview;
    }

    return execution;
  } catch (error) {
    return {
      call,
      success: false,
      content: error instanceof Error ? error.message : String(error),
      displayPath:
        typeof args.path === 'string'
          ? workspaceDisplayPath(workspace, args.path)
          : undefined,
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

    if (execution.call.name === 'run_command') {
      delete safeArgs.cwd;
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
    // Use a user-role protocol message for maximum OpenAI/OpenRouter model
    // compatibility. Some upstream providers reject system messages that
    // appear after an assistant turn, even though the top-level system prompt
    // is valid.
    role: 'user',
    content:
      'PROJECT TOOL RESULTS\n' +
      lines.join('\n') +
      '\nContinue from these real tool results. Do not repeat successful writes unless necessary.',
    timestamp: new Date(),
  };
}
