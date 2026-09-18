// File system tools
import { promises as fs } from 'fs';
import { resolve, join, dirname, basename, extname } from 'path';
import type { BaseTool, ToolArgs, ToolResult, ToolParameter } from './types';

/**
 * Read file tool
 */
export class ReadFileTool implements BaseTool {
  readonly name = 'read_file';
  readonly description = 'Read the contents of a file';
  readonly type = 'read_file';

  async execute(args: ToolArgs): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      const filePath = this.resolvePath(args.path as string, args.cwd as string | undefined);
      
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) {
        return {
          success: false,
          error: `Path is not a file: ${filePath}`,
          metadata: { executionTime: Date.now() - startTime, timestamp: new Date() },
        };
      }

      // Check file size limit
      const maxSize = args.maxSize ? Number(args.maxSize) : 1024 * 1024; // 1MB default
      if (stats.size > maxSize) {
        return {
          success: false,
          error: `File too large (${stats.size} bytes, max ${maxSize} bytes)`,
          metadata: { executionTime: Date.now() - startTime, timestamp: new Date() },
        };
      }

      const content = await fs.readFile(filePath, 'utf-8');

      return {
        success: true,
        content,
        data: {
          path: filePath,
          size: stats.size,
          modified: stats.mtime,
          extension: extname(filePath),
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
    if (!args.path) {
      return { valid: false, error: 'path is required' };
    }

    if (typeof args.path !== 'string') {
      return { valid: false, error: 'path must be a string' };
    }

    return { valid: true };
  }

  getSchema(): ToolParameter[] {
    return [
      {
        name: 'path',
        type: 'string',
        description: 'Path to the file to read',
        required: true,
      },
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory (default: process.cwd())',
        required: false,
      },
      {
        name: 'maxSize',
        type: 'number',
        description: 'Maximum file size in bytes (default: 1MB)',
        required: false,
        default: 1024 * 1024,
      },
    ];
  }

  private resolvePath(path: string, cwd?: string): string {
    if (cwd) {
      return resolve(cwd, path);
    }
    return resolve(process.cwd(), path);
  }
}

/**
 * Write file tool
 */
export class WriteFileTool implements BaseTool {
  readonly name = 'write_file';
  readonly description = 'Write content to a file';
  readonly type = 'write_file';

  async execute(args: ToolArgs): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      const filePath = this.resolvePath(args.path as string, args.cwd as string | undefined);
      const content = args.content as string;
      const overwrite = args.overwrite !== false;

      // Create parent directory if it doesn't exist
      const dir = dirname(filePath);
      await fs.mkdir(dir, { recursive: true });

      // Check if file exists and overwrite is false
      if (!overwrite) {
        try {
          await fs.access(filePath);
          return {
            success: false,
            error: `File already exists: ${filePath}. Set overwrite=true to overwrite.`,
            metadata: { executionTime: Date.now() - startTime, timestamp: new Date() },
          };
        } catch {
          // File doesn't exist, continue
        }
      }

      await fs.writeFile(filePath, content, 'utf-8');

      const stats = await fs.stat(filePath);

      return {
        success: true,
        content: `File written: ${filePath}`,
        data: {
          path: filePath,
          size: stats.size,
          modified: stats.mtime,
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
    if (!args.path) {
      return { valid: false, error: 'path is required' };
    }

    if (typeof args.path !== 'string') {
      return { valid: false, error: 'path must be a string' };
    }

    if (!args.content) {
      return { valid: false, error: 'content is required' };
    }

    return { valid: true };
  }

  getSchema(): ToolParameter[] {
    return [
      {
        name: 'path',
        type: 'string',
        description: 'Path to the file to write',
        required: true,
      },
      {
        name: 'content',
        type: 'string',
        description: 'Content to write to the file',
        required: true,
      },
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory (default: process.cwd())',
        required: false,
      },
      {
        name: 'overwrite',
        type: 'boolean',
        description: 'Overwrite if file exists (default: true)',
        required: false,
        default: true,
      },
    ];
  }

  private resolvePath(path: string, cwd?: string): string {
    if (cwd) {
      return resolve(cwd, path);
    }
    return resolve(process.cwd(), path);
  }
}

/**
 * Delete file tool
 */
export class DeleteFileTool implements BaseTool {
  readonly name = 'delete_file';
  readonly description = 'Delete a file';
  readonly type = 'delete_file';

  async execute(args: ToolArgs): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      const filePath = this.resolvePath(args.path as string, args.cwd as string | undefined);

      await fs.access(filePath);
      await fs.unlink(filePath);

      return {
        success: true,
        content: `File deleted: ${filePath}`,
        data: { path: filePath },
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
    if (!args.path) {
      return { valid: false, error: 'path is required' };
    }

    return { valid: true };
  }

  getSchema(): ToolParameter[] {
    return [
      {
        name: 'path',
        type: 'string',
        description: 'Path to the file to delete',
        required: true,
      },
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory (default: process.cwd())',
        required: false,
      },
    ];
  }

  private resolvePath(path: string, cwd?: string): string {
    if (cwd) {
      return resolve(cwd, path);
    }
    return resolve(process.cwd(), path);
  }
}

/**
 * List files tool
 */
export class ListFilesTool implements BaseTool {
  readonly name = 'list_files';
  readonly description = 'List files in a directory';
  readonly type = 'list_files';

  async execute(args: ToolArgs): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      const dirPath = this.resolvePath(args.path as string || '.', args.cwd as string | undefined);
      const recursive = args.recursive === true;
      const includeHidden = args.includeHidden === true;
      const pattern = args.pattern as string | undefined;

      const entries = await this.listDirectory(dirPath, recursive, includeHidden, pattern);

      return {
        success: true,
        content: entries.map((e) => e.path).join('\n'),
        data: { entries },
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
    return { valid: true };
  }

  getSchema(): ToolParameter[] {
    return [
      {
        name: 'path',
        type: 'string',
        description: 'Directory path to list (default: current directory)',
        required: false,
        default: '.',
      },
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory (default: process.cwd())',
        required: false,
      },
      {
        name: 'recursive',
        type: 'boolean',
        description: 'List files recursively',
        required: false,
        default: false,
      },
      {
        name: 'includeHidden',
        type: 'boolean',
        description: 'Include hidden files (starting with .)',
        required: false,
        default: false,
      },
      {
        name: 'pattern',
        type: 'string',
        description: 'Filter by file pattern (glob-style)',
        required: false,
      },
    ];
  }

  private async listDirectory(
    dirPath: string,
    recursive: boolean,
    includeHidden: boolean,
    pattern?: string
  ): Promise<Array<{ path: string; isDirectory: boolean; size?: number }>> {
    const entries: Array<{ path: string; isDirectory: boolean; size?: number }> = [];

    const items = await fs.readdir(dirPath, { withFileTypes: true });

    for (const item of items) {
      const fullPath = join(dirPath, item.name);

      // Skip hidden files unless requested
      if (!includeHidden && item.name.startsWith('.')) {
        continue;
      }

      // Skip node_modules
      if (item.name === 'node_modules') {
        continue;
      }

      if (item.isDirectory()) {
        entries.push({ path: fullPath, isDirectory: true });

        if (recursive) {
          const subEntries = await this.listDirectory(fullPath, recursive, includeHidden, pattern);
          entries.push(...subEntries);
        }
      } else if (item.isFile()) {
        // Filter by pattern if provided
        if (pattern) {
          const regex = this.createPatternRegex(pattern);
          if (!regex.test(item.name)) {
            continue;
          }
        }

        try {
          const stats = await fs.stat(fullPath);
          entries.push({ path: fullPath, isDirectory: false, size: stats.size });
        } catch {
          entries.push({ path: fullPath, isDirectory: false });
        }
      }
    }

    return entries;
  }

  private createPatternRegex(pattern: string): RegExp {
    // Convert glob pattern to regex
    // This is a simple implementation; consider using a library like 'minimatch' for full glob support
    let regexPattern = pattern
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
      .replace(/\./g, '\\.');

    // Ensure it matches the whole string
    regexPattern = `^${regexPattern}$`;

    return new RegExp(regexPattern, 'i');
  }

  private resolvePath(path: string, cwd?: string): string {
    if (cwd) {
      return resolve(cwd, path);
    }
    return resolve(process.cwd(), path);
  }
}

/**
 * Search files tool
 */
export class SearchFilesTool implements BaseTool {
  readonly name = 'search_files';
  readonly description = 'Search for files by name or content';
  readonly type = 'search_files';

  async execute(args: ToolArgs): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      const searchPath = this.resolvePath(args.path as string || '.', args.cwd as string | undefined);
      const query = args.query as string;
      const searchContent = args.searchContent === true;
      const recursive = args.recursive !== false;
      const includeHidden = args.includeHidden === true;
      const maxResults = args.maxResults ? Number(args.maxResults) : 100;

      if (!query) {
        return {
          success: false,
          error: 'query is required',
          metadata: { executionTime: Date.now() - startTime, timestamp: new Date() },
        };
      }

      const results = await this.searchDirectory(
        searchPath,
        query,
        searchContent,
        recursive,
        includeHidden,
        maxResults
      );

      return {
        success: true,
        content: results.map((r) => `${r.path}:${r.line !== undefined ? `:${r.line}` : ''}`).join('\n'),
        data: { results },
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
    if (!args.query) {
      return { valid: false, error: 'query is required' };
    }

    return { valid: true };
  }

  getSchema(): ToolParameter[] {
    return [
      {
        name: 'query',
        type: 'string',
        description: 'Search query (file name pattern or text to search for)',
        required: true,
      },
      {
        name: 'path',
        type: 'string',
        description: 'Directory path to search (default: current directory)',
        required: false,
        default: '.',
      },
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory (default: process.cwd())',
        required: false,
      },
      {
        name: 'searchContent',
        type: 'boolean',
        description: 'Search file contents instead of names',
        required: false,
        default: false,
      },
      {
        name: 'recursive',
        type: 'boolean',
        description: 'Search recursively',
        required: false,
        default: true,
      },
      {
        name: 'includeHidden',
        type: 'boolean',
        description: 'Include hidden files',
        required: false,
        default: false,
      },
      {
        name: 'maxResults',
        type: 'number',
        description: 'Maximum number of results to return',
        required: false,
        default: 100,
      },
    ];
  }

  private async searchDirectory(
    dirPath: string,
    query: string,
    searchContent: boolean,
    recursive: boolean,
    includeHidden: boolean,
    maxResults: number
  ): Promise<Array<{ path: string; line?: number; content?: string }>> {
    const results: Array<{ path: string; line?: number; content?: string }> = [];

    const items = await fs.readdir(dirPath, { withFileTypes: true });

    for (const item of items) {
      const fullPath = join(dirPath, item.name);

      // Skip hidden files unless requested
      if (!includeHidden && item.name.startsWith('.')) {
        continue;
      }

      // Skip node_modules
      if (item.name === 'node_modules') {
        continue;
      }

      if (results.length >= maxResults) {
        break;
      }

      if (item.isDirectory()) {
        if (recursive) {
          const subResults = await this.searchDirectory(
            fullPath,
            query,
            searchContent,
            recursive,
            includeHidden,
            maxResults - results.length
          );
          results.push(...subResults);
        }
      } else if (item.isFile()) {
        if (searchContent) {
          // Search file content
          try {
            const content = await fs.readFile(fullPath, 'utf-8');
            const lines = content.split('\n');

            for (let i = 0; i < lines.length; i++) {
              if (lines[i].includes(query)) {
                results.push({
                  path: fullPath,
                  line: i + 1,
                  content: lines[i].trim(),
                });
              }

              if (results.length >= maxResults) {
                break;
              }
            }
          } catch {
            // Skip files that can't be read
          }
        } else {
          // Search file name
          if (item.name.includes(query)) {
            results.push({ path: fullPath });
          }
        }
      }
    }

    return results;
  }

  private resolvePath(path: string, cwd?: string): string {
    if (cwd) {
      return resolve(cwd, path);
    }
    return resolve(process.cwd(), path);
  }
}

/**
 * Create directory tool
 */
export class CreateDirectoryTool implements BaseTool {
  readonly name = 'create_directory';
  readonly description = 'Create a new directory';
  readonly type = 'create_directory';

  async execute(args: ToolArgs): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      const dirPath = this.resolvePath(args.path as string, args.cwd as string | undefined);
      const recursive = args.recursive !== false;

      await fs.mkdir(dirPath, { recursive });

      return {
        success: true,
        content: `Directory created: ${dirPath}`,
        data: { path: dirPath },
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
    if (!args.path) {
      return { valid: false, error: 'path is required' };
    }

    return { valid: true };
  }

  getSchema(): ToolParameter[] {
    return [
      {
        name: 'path',
        type: 'string',
        description: 'Path to the directory to create',
        required: true,
      },
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory (default: process.cwd())',
        required: false,
      },
      {
        name: 'recursive',
        type: 'boolean',
        description: 'Create parent directories if needed',
        required: false,
        default: true,
      },
    ];
  }

  private resolvePath(path: string, cwd?: string): string {
    if (cwd) {
      return resolve(cwd, path);
    }
    return resolve(process.cwd(), path);
  }
}

/**
 * Delete directory tool
 */
export class DeleteDirectoryTool implements BaseTool {
  readonly name = 'delete_directory';
  readonly description = 'Delete a directory';
  readonly type = 'delete_directory';

  async execute(args: ToolArgs): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      const dirPath = this.resolvePath(args.path as string, args.cwd as string | undefined);
      const recursive = args.recursive === true;

      await fs.rm(dirPath, { recursive, force: true });

      return {
        success: true,
        content: `Directory deleted: ${dirPath}`,
        data: { path: dirPath },
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
    if (!args.path) {
      return { valid: false, error: 'path is required' };
    }

    return { valid: true };
  }

  getSchema(): ToolParameter[] {
    return [
      {
        name: 'path',
        type: 'string',
        description: 'Path to the directory to delete',
        required: true,
      },
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory (default: process.cwd())',
        required: false,
      },
      {
        name: 'recursive',
        type: 'boolean',
        description: 'Delete directory recursively',
        required: false,
        default: true,
      },
    ];
  }

  private resolvePath(path: string, cwd?: string): string {
    if (cwd) {
      return resolve(cwd, path);
    }
    return resolve(process.cwd(), path);
  }
}
