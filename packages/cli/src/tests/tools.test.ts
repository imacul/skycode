// Tests for tools
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { ReadFileTool, WriteFileTool, ListFilesTool, SearchFilesTool, DeleteFileTool, CreateDirectoryTool, DeleteDirectoryTool } from '../tools/file-system';
import { RunCommandTool } from '../tools/command';
import { TOOLS, getTool, executeTool, getToolNames, hasTool } from '../tools';
import { promises as fs } from 'fs';
import { join, resolve } from 'path';
import os from 'os';

// Create a temporary directory for testing
const tempDir = join(os.tmpdir(), `skycode-test-${Date.now()}`);

async function setupTestDir() {
  await fs.mkdir(tempDir, { recursive: true });
  await fs.writeFile(join(tempDir, 'test.txt'), 'Hello, World!');
  await fs.writeFile(join(tempDir, 'test2.txt'), 'Another file');
  await fs.mkdir(join(tempDir, 'subdir'), { recursive: true });
  await fs.writeFile(join(tempDir, 'subdir', 'nested.txt'), 'Nested file');
}

async function cleanupTestDir() {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

describe('Tools', () => {
  describe('Tool Registry', () => {
    it('should have all expected tools', () => {
      expect(getToolNames().length).toBeGreaterThan(0);
      expect(hasTool('read_file')).toBe(true);
      expect(hasTool('write_file')).toBe(true);
      expect(hasTool('list_files')).toBe(true);
      expect(hasTool('search_files')).toBe(true);
      expect(hasTool('run_command')).toBe(true);
    });

    it('should get tool by name', () => {
      const tool = getTool('read_file');
      expect(tool).toBeDefined();
      expect(tool?.name).toBe('read_file');
    });

    it('should return undefined for non-existent tool', () => {
      const tool = getTool('non-existent');
      expect(tool).toBeUndefined();
    });
  });

  describe('ReadFileTool', () => {
    const tool = new ReadFileTool();

    it('should have correct name and type', () => {
      expect(tool.name).toBe('read_file');
      expect(tool.type).toBe('read_file');
    });

    it('should validate with path', () => {
      const result = tool.validate({ path: '/test.txt' });
      expect(result.valid).toBe(true);
    });

    it('should validate without path', () => {
      const result = tool.validate({});
      expect(result.valid).toBe(false);
      expect(result.error).toContain('path');
    });

    it('should have correct schema', () => {
      const schema = tool.getSchema();
      expect(schema.length).toBeGreaterThan(0);
      expect(schema.some(p => p.name === 'path')).toBe(true);
    });
  });

  describe('WriteFileTool', () => {
    const tool = new WriteFileTool();

    it('should have correct name and type', () => {
      expect(tool.name).toBe('write_file');
      expect(tool.type).toBe('write_file');
    });

    it('should validate with path and content', () => {
      const result = tool.validate({ path: '/test.txt', content: 'test' });
      expect(result.valid).toBe(true);
    });

    it('should validate without path', () => {
      const result = tool.validate({ content: 'test' });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('path');
    });

    it('should validate without content', () => {
      const result = tool.validate({ path: '/test.txt' });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('content');
    });

    it('should write file', async () => {
      await setupTestDir();
      
      const result = await tool.execute({
        path: join(tempDir, 'newfile.txt'),
        content: 'Test content',
      });

      expect(result.success).toBe(true);
      const content = await fs.readFile(join(tempDir, 'newfile.txt'), 'utf-8');
      expect(content).toBe('Test content');
      
      await cleanupTestDir();
    });

    it('should not overwrite by default', async () => {
      await setupTestDir();
      
      const result = await tool.execute({
        path: join(tempDir, 'test.txt'),
        content: 'New content',
        overwrite: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
      
      await cleanupTestDir();
    });

    it('should overwrite when allowed', async () => {
      await setupTestDir();
      
      const result = await tool.execute({
        path: join(tempDir, 'test.txt'),
        content: 'Overwritten content',
        overwrite: true,
      });

      expect(result.success).toBe(true);
      const content = await fs.readFile(join(tempDir, 'test.txt'), 'utf-8');
      expect(content).toBe('Overwritten content');
      
      await cleanupTestDir();
    });
  });

  describe('ListFilesTool', () => {
    const tool = new ListFilesTool();

    it('should have correct name and type', () => {
      expect(tool.name).toBe('list_files');
      expect(tool.type).toBe('list_files');
    });

    it('should list files in directory', async () => {
      await setupTestDir();
      
      const result = await tool.execute({
        path: tempDir,
      });

      expect(result.success).toBe(true);
      expect(result.data?.entries.length).toBeGreaterThan(0);
      expect(result.content).toContain('test.txt');
      
      await cleanupTestDir();
    });

    it('should list recursively', async () => {
      await setupTestDir();
      
      const result = await tool.execute({
        path: tempDir,
        recursive: true,
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('nested.txt');
      
      await cleanupTestDir();
    });

    it('should filter by pattern', async () => {
      await setupTestDir();
      
      const result = await tool.execute({
        path: tempDir,
        pattern: 'test.txt',
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('test.txt');
      expect(result.content).not.toContain('test2.txt');
      
      await cleanupTestDir();
    });
  });

  describe('SearchFilesTool', () => {
    const tool = new SearchFilesTool();

    it('should have correct name and type', () => {
      expect(tool.name).toBe('search_files');
      expect(tool.type).toBe('search_files');
    });

    it('should validate with query', () => {
      const result = tool.validate({ query: 'test' });
      expect(result.valid).toBe(true);
    });

    it('should validate without query', () => {
      const result = tool.validate({});
      expect(result.valid).toBe(false);
      expect(result.error).toContain('query');
    });

    it('should search by filename', async () => {
      await setupTestDir();
      
      const result = await tool.execute({
        path: tempDir,
        query: 'test.txt',
      });

      expect(result.success).toBe(true);
      expect(result.data?.results.length).toBeGreaterThan(0);
      expect(result.content).toContain('test.txt');
      
      await cleanupTestDir();
    });

    it('should search file content', async () => {
      await setupTestDir();
      
      const result = await tool.execute({
        path: tempDir,
        query: 'Hello',
        searchContent: true,
      });

      expect(result.success).toBe(true);
      expect(result.data?.results.length).toBeGreaterThan(0);
      
      await cleanupTestDir();
    });
  });

  describe('DeleteFileTool', () => {
    const tool = new DeleteFileTool();

    it('should have correct name and type', () => {
      expect(tool.name).toBe('delete_file');
      expect(tool.type).toBe('delete_file');
    });

    it('should validate with path', () => {
      const result = tool.validate({ path: '/test.txt' });
      expect(result.valid).toBe(true);
    });

    it('should delete file', async () => {
      await setupTestDir();
      
      const result = await tool.execute({
        path: join(tempDir, 'test.txt'),
      });

      expect(result.success).toBe(true);
      
      try {
        await fs.access(join(tempDir, 'test.txt'));
        expect.fail('File should not exist');
      } catch {
        // Expected
      }
      
      await cleanupTestDir();
    });
  });

  describe('CreateDirectoryTool', () => {
    const tool = new CreateDirectoryTool();

    it('should have correct name and type', () => {
      expect(tool.name).toBe('create_directory');
      expect(tool.type).toBe('create_directory');
    });

    it('should validate with path', () => {
      const result = tool.validate({ path: '/test-dir' });
      expect(result.valid).toBe(true);
    });

    it('should create directory', async () => {
      await setupTestDir();
      
      const result = await tool.execute({
        path: join(tempDir, 'newdir'),
      });

      expect(result.success).toBe(true);
      
      const stats = await fs.stat(join(tempDir, 'newdir'));
      expect(stats.isDirectory()).toBe(true);
      
      await cleanupTestDir();
    });

    it('should create nested directories', async () => {
      await setupTestDir();
      
      const result = await tool.execute({
        path: join(tempDir, 'nested', 'deep', 'dir'),
        recursive: true,
      });

      expect(result.success).toBe(true);
      
      const stats = await fs.stat(join(tempDir, 'nested', 'deep', 'dir'));
      expect(stats.isDirectory()).toBe(true);
      
      await cleanupTestDir();
    });
  });

  describe('DeleteDirectoryTool', () => {
    const tool = new DeleteDirectoryTool();

    it('should have correct name and type', () => {
      expect(tool.name).toBe('delete_directory');
      expect(tool.type).toBe('delete_directory');
    });

    it('should validate with path', () => {
      const result = tool.validate({ path: '/test-dir' });
      expect(result.valid).toBe(true);
    });

    it('should delete directory', async () => {
      await setupTestDir();
      
      // Create a directory to delete
      await fs.mkdir(join(tempDir, 'todelete'), { recursive: true });
      
      const result = await tool.execute({
        path: join(tempDir, 'todelete'),
      });

      expect(result.success).toBe(true);
      
      try {
        await fs.access(join(tempDir, 'todelete'));
        expect.fail('Directory should not exist');
      } catch {
        // Expected
      }
      
      await cleanupTestDir();
    });
  });

  describe('RunCommandTool', () => {
    const tool = new RunCommandTool();

    it('should have correct name and type', () => {
      expect(tool.name).toBe('run_command');
      expect(tool.type).toBe('run_command');
    });

    it('should validate with command', () => {
      const result = tool.validate({ command: 'echo hello' });
      expect(result.valid).toBe(true);
    });

    it('should validate without command', () => {
      const result = tool.validate({});
      expect(result.valid).toBe(false);
      expect(result.error).toContain('command');
    });

    it('should execute command', async () => {
      const result = await tool.execute({
        command: 'echo hello',
      });

      expect(result.success).toBe(true);
      expect(result.data?.exitCode).toBe(0);
      expect(result.data?.stdout).toContain('hello');
    });

    it('should capture output', async () => {
      const result = await tool.execute({
        command: 'echo test output',
        captureOutput: true,
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('test output');
    });

    it('should handle command errors', async () => {
      const result = await tool.execute({
        command: 'ls /nonexistent/path',
      });

      expect(result.success).toBe(false);
    });

    it('should block dangerous commands', async () => {
      const result = await tool.execute({
        command: 'rm -rf /',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not allowed');
    });
  });
});

describe('Tool Execution', () => {
  it('should execute tool by name', async () => {
    await setupTestDir();
    
    const result = await executeTool('write_file', {
      path: join(tempDir, 'exectest.txt'),
      content: 'Executed via tool',
    });

    expect(result.success).toBe(true);
    
    await cleanupTestDir();
  });

  it('should return error for non-existent tool', async () => {
    const result = await executeTool('non_existent', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });
});
