// Command execution tools
import { spawn } from 'node:child_process';
import type { BaseTool, ToolArgs, ToolResult, ToolParameter } from './types';

export function parseCommandArguments(command: string): { executable: string; argv: string[] } {
  if (command.includes('\0')) throw new Error('Command contains a null byte.');

  const parts: string[] = [];
  let current = '';
  let quote: 'single' | 'double' | null = null;
  let tokenStarted = false;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote === 'single') {
      if (char === "'") quote = null;
      else current += char;
      tokenStarted = true;
      continue;
    }
    if (quote === 'double') {
      if (char === '"') {
        quote = null;
      } else if (char === '\\' && ['"', '\\'].includes(command[index + 1] || '')) {
        current += command[index + 1];
        index += 1;
      } else {
        current += char;
      }
      tokenStarted = true;
      continue;
    }
    if (char === "'") {
      quote = 'single';
      tokenStarted = true;
    } else if (char === '"') {
      quote = 'double';
      tokenStarted = true;
    } else if (/\s/.test(char)) {
      if (tokenStarted) {
        parts.push(current);
        current = '';
        tokenStarted = false;
      }
    } else {
      current += char;
      tokenStarted = true;
    }
  }

  if (quote) throw new Error('Command contains an unterminated quote.');
  if (tokenStarted) parts.push(current);
  if (!parts[0]) throw new Error('Command is empty.');
  return { executable: parts[0], argv: parts.slice(1) };
}

interface CapturedProcess {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

function executeWithoutShell(
  command: string,
  options: {
    cwd?: string;
    timeout: number;
    maxBuffer: number;
    env?: Record<string, string>;
    useShell?: boolean;
  }
): Promise<CapturedProcess> {
  return new Promise((resolvePromise, reject) => {
    const child = options.useShell
      ? process.platform === 'win32'
        ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {
            cwd: options.cwd,
            env: options.env,
            shell: false,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
          })
        : spawn('/bin/bash', ['-lc', command], {
            cwd: options.cwd,
            env: options.env,
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
          })
      : (() => {
          const { executable, argv } = parseCommandArguments(command);
          return spawn(executable, argv, {
            cwd: options.cwd,
            env: options.env,
            shell: false,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
          });
        })();
    let stdout = '';
    let stderr = '';
    let total = 0;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(Object.assign(error, { stdout, stderr }));
      else resolvePromise({ stdout, stderr, exitCode: child.exitCode, signal: child.signalCode });
    };
    const collect = (target: 'stdout' | 'stderr', chunk: Buffer | string) => {
      const value = chunk.toString();
      total += Buffer.byteLength(value);
      if (total > options.maxBuffer) {
        child.kill('SIGTERM');
        finish(new Error('Command output exceeded the configured maximum buffer.'));
        return;
      }
      if (target === 'stdout') stdout += value;
      else stderr += value;
    };
    child.stdout?.on('data', (chunk) => collect('stdout', chunk));
    child.stderr?.on('data', (chunk) => collect('stderr', chunk));
    child.on('error', (error) => finish(error));
    child.on('close', () => finish());
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(new Error(`Command timed out after ${options.timeout}ms`));
    }, options.timeout);
  });
}

/**
 * Run command tool
 */
export class RunCommandTool implements BaseTool {
  readonly name = 'run_command';
  readonly description = 'Execute a program directly without a shell';
  readonly type = 'run_command';

  async execute(args: ToolArgs): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      const command = args.command as string;
      const cwd = args.cwd as string | undefined;
      const timeout = args.timeout ? Number(args.timeout) : 30000; // 30 seconds default
      const captureOutput = args.captureOutput !== false;

      if (!command) {
        return {
          success: false,
          error: 'command is required',
          metadata: { executionTime: Date.now() - startTime, timestamp: new Date() },
        };
      }

      const useShell = args.useShell === true;

      // Validate command (basic security check). Owner Mode shell bypasses the
      // legacy substring denylist because classifyProjectCommand already gated it.
      if (!useShell && !this.isCommandAllowed(command)) {
        return {
          success: false,
          error: `Command not allowed: ${command}`,
          metadata: { executionTime: Date.now() - startTime, timestamp: new Date() },
        };
      }

      const options = {
        cwd,
        timeout,
        maxBuffer: args.maxBuffer ? Number(args.maxBuffer) : 1024 * 1024 * 10, // 10MB
        env: args.env as unknown as Record<string, string> | undefined,
        useShell,
      };

      const result = await executeWithoutShell(command, options);

      if (result.exitCode !== 0) {
        return {
          success: false,
          error: result.stderr || `Command exited with code ${result.exitCode}.`,
          data: result,
          metadata: { executionTime: Date.now() - startTime, timestamp: new Date() },
        };
      }

      return {
        success: true,
        content: captureOutput ? result.stdout || result.stderr : `Command executed (exit code: ${result.exitCode})`,
        data: {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          signal: result.signal,
        },
        metadata: { executionTime: Date.now() - startTime, timestamp: new Date() },
      };
    } catch (error) {
      const err = error as Error & { code?: number; signal?: string; stdout?: string; stderr?: string };

      return {
        success: false,
        error: err.message,
        data: {
          stdout: err.stdout,
          stderr: err.stderr,
          exitCode: err.code,
          signal: err.signal,
        },
        metadata: { executionTime: Date.now() - startTime, timestamp: new Date() },
      };
    }
  }

  validate(args: ToolArgs): { valid: boolean; error?: string } {
    if (!args.command) {
      return { valid: false, error: 'command is required' };
    }

    return { valid: true };
  }

  getSchema(): ToolParameter[] {
    return [
      {
        name: 'command',
        type: 'string',
        description: 'Program and arguments to execute without shell interpretation',
        required: true,
      },
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory for the command',
        required: false,
      },
      {
        name: 'timeout',
        type: 'number',
        description: 'Timeout in milliseconds (default: 30000)',
        required: false,
        default: 30000,
      },
      {
        name: 'captureOutput',
        type: 'boolean',
        description: 'Capture and return command output',
        required: false,
        default: true,
      },
      {
        name: 'maxBuffer',
        type: 'number',
        description: 'Maximum output buffer size in bytes',
        required: false,
        default: 10485760, // 10MB
      },
      {
        name: 'env',
        type: 'string',
        description: 'Environment variables (JSON string)',
        required: false,
      },
    ];
  }

  /**
   * Basic security check - block dangerous commands
   */
  private isCommandAllowed(command: string): boolean {
    const lowerCommand = command.toLowerCase();
    
    // Block commands that could be dangerous
    const dangerousCommands = [
      'rm -rf',
      'rm -r',
      'del /s',
      'format c:',
      'dd ',
      ':(){ :|:& };:', // fork bomb
      'mkfs',
      'chmod -r',
      '> /dev/sd',
      'mv / ', // moving root directory
    ];

    for (const dangerous of dangerousCommands) {
      if (lowerCommand.includes(dangerous)) {
        return false;
      }
    }

    // Check for pipe to shell
    if (lowerCommand.includes('| sh') || lowerCommand.includes('| bash')) {
      return false;
    }

    return true;
  }
}

/**
 * Run command with streaming output tool
 */
export class RunCommandStreamTool implements BaseTool {
  readonly name = 'run_command_stream';
  readonly description = 'Execute a program directly with streaming output';
  readonly type = 'run_command';

  async execute(args: ToolArgs): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      const command = args.command as string;
      const cwd = args.cwd as string | undefined;
      const timeout = args.timeout ? Number(args.timeout) : 30000;

      if (!command) {
        return {
          success: false,
          error: 'command is required',
          metadata: { executionTime: Date.now() - startTime, timestamp: new Date() },
        };
      }

      // Validate command
      if (!this.isCommandAllowed(command)) {
        return {
          success: false,
          error: `Command not allowed: ${command}`,
          metadata: { executionTime: Date.now() - startTime, timestamp: new Date() },
        };
      }

      const { executable, argv } = parseCommandArguments(command);
      const child = spawn(executable, argv, {
        cwd,
        env: args.env as unknown as Record<string, string> | undefined,
        shell: false,
        windowsHide: true,
        stdio: 'pipe',
      });

      // Set timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          child.kill('SIGTERM');
          reject(new Error(`Command timed out after ${timeout}ms`));
        }, timeout);
      });

      // Collect output
      const outputChunks: string[] = [];
      const errorChunks: string[] = [];

      child.stdout?.on('data', (data) => {
        outputChunks.push(data.toString());
      });

      child.stderr?.on('data', (data) => {
        errorChunks.push(data.toString());
      });

      // Wait for process to finish or timeout
      try {
        await Promise.race([
          new Promise<void>((resolve) => {
            child.on('close', resolve);
            child.on('error', resolve);
          }),
          timeoutPromise,
        ]);
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          data: {
            stdout: outputChunks.join(''),
            stderr: errorChunks.join(''),
          },
          metadata: { executionTime: Date.now() - startTime, timestamp: new Date() },
        };
      }

      const exitCode = child.exitCode;

      return {
        success: exitCode === 0,
        content: outputChunks.join(''),
        data: {
          stdout: outputChunks.join(''),
          stderr: errorChunks.join(''),
          exitCode,
          signal: child.signalCode,
        },
        metadata: { executionTime: Date.now() - startTime, timestamp: new Date() },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        metadata: { executionTime: Date.now() - startTime, timestamp: new Date() },
      };
    }
  }

  validate(args: ToolArgs): { valid: boolean; error?: string } {
    if (!args.command) {
      return { valid: false, error: 'command is required' };
    }

    return { valid: true };
  }

  getSchema(): ToolParameter[] {
    return [
      {
        name: 'command',
        type: 'string',
        description: 'Program and arguments to execute without shell interpretation',
        required: true,
      },
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory for the command',
        required: false,
      },
      {
        name: 'timeout',
        type: 'number',
        description: 'Timeout in milliseconds (default: 30000)',
        required: false,
        default: 30000,
      },
      {
        name: 'env',
        type: 'string',
        description: 'Environment variables (JSON string)',
        required: false,
      },
    ];
  }

  private isCommandAllowed(command: string): boolean {
    const lowerCommand = command.toLowerCase();
    
    const dangerousCommands = [
      'rm -rf',
      'rm -r',
      'del /s',
      'format c:',
      'dd ',
      ':(){ :|:& };:',
      'mkfs',
      'chmod -r',
    ];

    for (const dangerous of dangerousCommands) {
      if (lowerCommand.includes(dangerous)) {
        return false;
      }
    }

    return true;
  }
}
