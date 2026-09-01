// Tool types and interfaces
import type { AgentContext } from '../agents/types';

/**
 * Tool types
 */
export type ToolType = 
  | 'read_file'
  | 'write_file'
  | 'delete_file'
  | 'list_files'
  | 'search_files'
  | 'run_command'
  | 'read_directory'
  | 'create_directory'
  | 'delete_directory';

/**
 * Base tool interface
 */
export interface BaseTool {
  // Tool name
  readonly name: string;
  
  // Tool description
  readonly description: string;
  
  // Tool type
  readonly type: ToolType;
  
  // Execute the tool
  execute(args: ToolArgs, context: AgentContext): Promise<ToolResult>;
  
  // Validate arguments
  validate(args: ToolArgs): { valid: boolean; error?: string };
  
  // Get parameter schema
  getSchema(): ToolParameter[];
}

/**
 * Tool arguments
 */
export interface ToolArgs {
  [key: string]: string | number | boolean | string[] | undefined;
}

/**
 * Tool result
 */
export interface ToolResult {
  // Success status
  success: boolean;
  
  // Result content
  content?: string;
  
  // Data (structured)
  data?: unknown;
  
  // Error message
  error?: string;
  
  // Metadata
  metadata?: {
    executionTime: number;
    timestamp: Date;
  };
}

/**
 * Tool parameter definition
 */
export interface ToolParameter {
  // Parameter name
  name: string;
  
  // Parameter type
  type: 'string' | 'number' | 'boolean' | 'array';
  
  // Parameter description
  description: string;
  
  // Required
  required?: boolean;
  
  // Default value
  default?: string | number | boolean | string[];
  
  // Enum values (for string)
  enum?: string[];
  
  // Min/max for numbers
  min?: number;
  max?: number;
  
  // Min/max length for strings
  minLength?: number;
  maxLength?: number;
}

/**
 * Tool registry
 */
export interface ToolRegistry {
  [key: string]: BaseTool;
}

/**
 * Tool factory
 */
export type ToolFactory = (config?: unknown) => BaseTool;

/**
 * Tool execution options
 */
export interface ToolExecutionOptions {
  // Timeout in milliseconds
  timeout?: number;
  
  // Working directory
  cwd?: string;
  
  // Environment variables
  env?: Record<string, string>;
  
  // Maximum output size
  maxOutputSize?: number;
}

/**
 * Tool error
 */
export class ToolError extends Error {
  constructor(
    message: string,
    public readonly tool: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

export class ToolValidationError extends ToolError {
  constructor(tool: string, message: string) {
    super(message, tool, 'VALIDATION_ERROR');
    this.name = 'ToolValidationError';
  }
}

export class ToolExecutionError extends ToolError {
  constructor(tool: string, message: string) {
    super(message, tool, 'EXECUTION_ERROR');
    this.name = 'ToolExecutionError';
  }
}

export class ToolTimeoutError extends ToolError {
  constructor(tool: string, timeout: number) {
    super(`Tool execution timed out after ${timeout}ms`, tool, 'TIMEOUT_ERROR');
    this.name = 'ToolTimeoutError';
  }
}
