// Tool exports
import { ReadFileTool, WriteFileTool, DeleteFileTool, ListFilesTool, SearchFilesTool, CreateDirectoryTool, DeleteDirectoryTool } from './file-system';
import { RunCommandTool, RunCommandStreamTool } from './command';
import type { BaseTool, ToolRegistry, ToolFactory, ToolArgs, ToolResult, ToolParameter, ToolExecutionOptions } from './types';

// Tool registry
export const TOOLS: ToolRegistry = {
  // File system tools
  read_file: new ReadFileTool(),
  write_file: new WriteFileTool(),
  delete_file: new DeleteFileTool(),
  list_files: new ListFilesTool(),
  search_files: new SearchFilesTool(),
  create_directory: new CreateDirectoryTool(),
  delete_directory: new DeleteDirectoryTool(),
  
  // Command tools
  run_command: new RunCommandTool(),
  run_command_stream: new RunCommandStreamTool(),
};

// Named exports
export {
  ReadFileTool,
  WriteFileTool,
  DeleteFileTool,
  ListFilesTool,
  SearchFilesTool,
  CreateDirectoryTool,
  DeleteDirectoryTool,
  RunCommandTool,
  RunCommandStreamTool,
} from './file-system';

export { RunCommandTool, RunCommandStreamTool } from './command';

export type {
  BaseTool,
  ToolRegistry,
  ToolFactory,
  ToolArgs,
  ToolResult,
  ToolParameter,
  ToolExecutionOptions,
  ToolType,
} from './types';

export { ToolError, ToolValidationError, ToolExecutionError, ToolTimeoutError } from './types';

// Tool utility functions
/**
 * Get tool by name
 */
export function getTool(name: string): BaseTool | undefined {
  return TOOLS[name];
}

/**
 * Execute a tool by name
 */
export async function executeTool(
  name: string,
  args: ToolArgs,
  context?: unknown
): Promise<ToolResult> {
  const tool = getTool(name);
  if (!tool) {
    return {
      success: false,
      error: `Tool not found: ${name}`,
      metadata: { executionTime: 0, timestamp: new Date() },
    };
  }

  return tool.execute(args, context as never);
}

/**
 * Get all available tool names
 */
export function getToolNames(): string[] {
  return Object.keys(TOOLS);
}

/**
 * Get tools by type
 */
export function getToolsByType(type: string): BaseTool[] {
  return Object.values(TOOLS).filter((tool) => tool.type === type);
}

/**
 * Check if tool exists
 */
export function hasTool(name: string): boolean {
  return name in TOOLS;
}
