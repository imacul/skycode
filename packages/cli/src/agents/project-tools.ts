import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { lstat, realpath, readFile } from 'node:fs/promises';
import { executeTool } from '../tools';
import type {
  AgentApprovalDecision,
  AgentApprovalRequest,
  AgentContext,
} from './types';
import type { Message } from '../store/conversation';
import { agentDebug } from '../utils/agent-debug';

export const PROJECT_TOOL_NAMES = [
  'list_files',
  'read_file',
  'search_files',
  'create_directory',
  'write_file',
  'delete_file',
  'delete_directory',
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

// Some OpenRouter/DeepSeek models mix SkyCode's opening tag with a DSML
// closing tag, e.g. <tool_call>{...}</|DSML|tool_call>. Treat both closers
// as the same envelope so a valid action is executed instead of leaked to UI.
const TOOL_CALL_RE =
  /<tool_call>\s*([\s\S]*?)\s*(?:<\/tool_call>|<\/\|DSML\|tool_call>)/gi;
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
  // Models often use generic computer-agent vocabulary. Normalize common
  // aliases at the harness boundary instead of leaking a perfectly usable
  // tool request back to the user.
  const normalizedName =
    name === 'terminal' || name === 'shell' || name === 'bash' || name === 'powershell'
      ? 'run_command'
      : name === 'mkdir'
        ? 'create_directory'
        : name;

  if (
    typeof normalizedName === 'string' &&
    PROJECT_TOOL_NAMES.includes(normalizedName as ProjectToolName) &&
    args &&
    typeof args === 'object' &&
    !Array.isArray(args)
  ) {
    calls.push({
      name: normalizedName as ProjectToolName,
      args: args as Record<string, unknown>,
    });
  }
}

function pushLooseProjectToolCall(
  calls: ProjectToolCall[],
  value: unknown
): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;

  const parsed = value as Record<string, unknown>;
  const explicitArgs =
    parsed.args && typeof parsed.args === 'object' && !Array.isArray(parsed.args)
      ? parsed.args
      : undefined;

  if (typeof parsed.name === 'string' && explicitArgs) {
    pushProjectToolCall(calls, parsed.name, explicitArgs);
    return;
  }

  // DeepSeek v4 flash sometimes emits the write-file arguments directly in
  // the tool envelope and drops both the tool name and the args wrapper:
  // {"path":"src/a.js","contents":"...","calls":[]}
  // A path plus textual contents is unambiguous enough to recover safely.
  if (
    typeof parsed.path === 'string' &&
    (typeof parsed.contents === 'string' || typeof parsed.content === 'string')
  ) {
    pushProjectToolCall(calls, 'write_file', {
      path: parsed.path,
      content:
        typeof parsed.contents === 'string' ? parsed.contents : parsed.content,
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
      pushLooseProjectToolCall(calls, parsed);
    } catch {
      // Other model-native tool syntaxes are handled below.
    }
  }

  // Some models emit a compact XML argument form instead of JSON, e.g.
  // <tool_call>create_directory <arg_key>path</arg_key>
  // <arg_value>demo</arg_value> </tool_call>. Recover this form so a valid
  // action never leaks into the UI or causes the agent loop to stop.
  const compactXmlToolRe =
    /<tool_call>\s*([a-z_][a-z0-9_]*)\s*([\s\S]*?)\s*(?:<\/tool_call>|<\/\|DSML\|tool_call>)/gi;
  while ((match = compactXmlToolRe.exec(normalized)) !== null) {
    const name = match[1];
    const body = match[2];
    const args: Record<string, unknown> = {};
    const argRe =
      /<arg_key>\s*([\s\S]*?)\s*<\/arg_key>\s*<arg_value>\s*([\s\S]*?)\s*<\/arg_value>/gi;
    let argMatch: RegExpExecArray | null;
    while ((argMatch = argRe.exec(body)) !== null) {
      const key = argMatch[1].trim();
      if (key) args[key] = coerceDsmlScalar(argMatch[2]);
    }
    pushProjectToolCall(calls, name, args);
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
      pushLooseProjectToolCall(calls, parsed);
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
      /<tool_call>\s*[a-z_][a-z0-9_]*\s*[\s\S]*?(?:<\/tool_call>|<\/\|DSML\|tool_call>)/gi,
      ''
    )
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
    return {
      allowed: true,
      requiresApproval: true,
      risk: 'verify',
      permissionKey: 'terminal:verify',
      description:
        'This command executes project tooling or code to test/build/check the workspace.',
    };
  }

  // Computer Tools v1: commands that are not recognized as read-only or
  // verification commands are still available, but they cross an execution
  // boundary and therefore require explicit user approval. This keeps the
  // agent capable without silently granting it authority.
  return {
    allowed: true,
    requiresApproval: true,
    risk: 'workspace',
    permissionKey: 'terminal:general',
    description: 'This command will execute in the active workspace.',
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
    '- delete_file: {"path":"relative/path"} — requires approval.',
    '- delete_directory: {"path":"relative/path","recursive":true} — requires approval.',
    '- run_command: {"command":"npm test","reason":"Run the test suite to verify the implementation","timeout":120000} — executes inside the active workspace; non-read-only commands require approval.',
    '',
    'Terminal rules:',
    '- Use run_command to inspect or verify your work when useful: git status/diff, test suites, builds, lint, type checks, and tool/runtime version checks. Read-only metadata commands can run automatically; project-executing verification commands require approval.',
    '- After non-trivial code changes, prefer at least one relevant verification command when the existing project exposes one. Inspect package/config files first so you do not invent scripts.',
    '- Use failed command output as debugging evidence: fix the files, then rerun the relevant verification command.',
    '- run_command already executes with the active workspace as cwd. NEVER invent /workspace, /home, C:\\\\ paths, or cd into an absolute workspace path.',
    '- Run one command per tool call. Do not use shell chaining (&& or ;), pipes, redirects/heredocs, subshells, or multiline commands. Use create_directory/write_file for filesystem changes and file contents instead of mkdir/cat/echo redirection.',
    '- For every command that requires approval, the reason must explain the purpose/necessity, not restate the action. Bad: "Install Jest dev dependency." Good: "The project uses Jest for its automated tests, so dependencies must be installed before I can run and verify the requested test suite." Package installs must say what capability/package is needed and why the current task cannot proceed or be verified without it.',
    '- Package installation/removal, generators, arbitrary workspace commands, format/fix scripts, and git add/commit require interactive user approval. SkyCode can remember approval once, for the current session, or persistently for that permission family.',
    '- Destructive filesystem commands, git push/history rewrites, package publishing, and system-management commands remain blocked even with approval.',
    '- If a needed command is blocked, continue with file work where possible and tell the user exactly which command remains unavailable.',
    '',
    'Rules:',
    '- All paths must stay inside the workspace root.',
    '- Prefer relative paths.',
    '- Never claim a file was created or changed unless the tool result says success.',
    '- Inspect existing files before overwriting when the request targets an existing project.',
    '- Do not delete files, publish code, rewrite git history, or access paths outside the workspace. Package/dependency changes and approved git workspace changes are allowed only through the interactive permission flow.',
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
  agentDebug('tool.boundary.enter', { call, workspace });
  let beforeWrite = '';
  let writeTarget: string | undefined;

  try {
    switch (call.name) {
      case 'write_file':
      case 'read_file':
      case 'create_directory':
      case 'delete_file':
      case 'delete_directory': {
        args.path = normalizeWorkspacePath(workspace, args.path, 'path');
        await assertNoSymlinkEscape(workspace, args.path as string);
        args.cwd = workspace;

        if (call.name === 'write_file') {
          writeTarget = args.path as string;
          beforeWrite = await readFile(writeTarget, 'utf8').catch(() => '');
        }

        if (call.name === 'delete_file' || call.name === 'delete_directory') {
          if (!requestApproval) {
            throw new Error('Deleting workspace content requires user approval.');
          }
          agentDebug('tool.approval.request', { command: args.command, reason: commandReason, policy });
          const decision = await requestApproval({
            id: 'approval_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
            type: 'terminal',
            title: call.name === 'delete_file' ? 'Approve file deletion' : 'Approve directory deletion',
            description: 'SkyCode wants to delete ' + workspaceDisplayPath(workspace, args.path as string) + '.',
            command: call.name + ' ' + workspaceDisplayPath(workspace, args.path as string),
            permissionKey: 'filesystem:delete',
            risk: 'workspace',
          });
          agentDebug('tool.approval.decision', { command: args.command, decision });
          if (decision === 'deny') {
            throw new Error('User denied workspace deletion.');
          }
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
        agentDebug('tool.command.policy', { command: args.command, reason: args.reason, policy });
        if (!policy.allowed) {
          throw new Error(
            'Terminal command blocked: ' +
              (policy.reason || 'This command is not allowed by SkyCode.')
          );
        }

        if (policy.requiresApproval) {
          const commandReason = typeof args.reason === 'string' ? args.reason.trim() : '';
          if (!commandReason) {
            throw new Error(
              'Terminal command requires a concise reason before approval can be requested: ' +
                args.command
            );
          }

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
                : policy.risk === 'verify'
                  ? 'Approve verification command'
                  : 'Approve workspace command',
            description:
              'Why this is needed: ' + commandReason + '\n' +
              (policy.description || 'This command can change the active workspace.'),
            command: args.command,
            permissionKey: policy.permissionKey,
            risk:
              policy.risk === 'git-write'
                ? 'git-write'
                : policy.risk === 'verify'
                  ? 'verify'
                  : 'workspace',
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

    agentDebug('tool.runtime.start', { tool: call.name, args });
    const result = await executeTool(call.name, args as any, context);
    agentDebug('tool.runtime.raw_result', { tool: call.name, result });

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
    agentDebug('tool.boundary.error', { call, args, error });
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
