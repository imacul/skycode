// Command execution tools
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import type { BaseTool, ToolArgs, ToolResult, ToolParameter } from './types';

const execAsync = promisify(exec);

/**
 * Run command tool
 */
export class RunCommandTool implements BaseTool {
  readonly name = 'run_command';
  readonly description = 'Execute a shell command';
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

      // Validate command (basic security check)
      if (!this.isCommandAllowed(command)) {
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
        env: args.env as Record<string, string> | undefined,
        shell: true,
      };

      const result = await execAsync(command, options);

      return {
        success: true,
        content: captureOutput ? result.stdout || result.stderr : `Command executed (exit code: ${result.code})`,
        data: {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.code,
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
        description: 'Shell command to execute',
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
  readonly description = 'Execute a shell command with streaming output';
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

      const options = {
        cwd,
        env: args.env as Record<string, string> | undefined,
        shell: true,
      };

      const child = spawn(command, { ...options, stdio: 'pipe' });

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
        description: 'Shell command to execute',
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
