import { spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

export interface McpToolInfo {
  server: string;
  name: string;
  description: string;
}

interface JsonRpcMessage {
  id?: number;
  method?: string;
  result?: unknown;
  error?: { message?: string };
}

export function parseMcpConfig(raw: string): McpConfig {
  const parsed = JSON.parse(raw) as { mcpServers?: Record<string, McpServerConfig> };
  const servers = parsed.mcpServers || {};
  for (const [name, server] of Object.entries(servers)) {
    if (!server || typeof server.command !== 'string' || !server.command.trim()) {
      throw new Error('MCP server "' + name + '" needs a command.');
    }
  }
  return { mcpServers: servers };
}

export async function loadMcpConfig(workspace: string): Promise<McpConfig> {
  const paths = [
    join(homedir(), '.skycode', 'mcp.json'),
    join(workspace, 'skycode.mcp.json'),
  ];
  const merged: McpConfig = { mcpServers: {} };

  for (const path of paths) {
    try {
      const raw = await readFile(path, 'utf8');
      const config = parseMcpConfig(raw);
      Object.assign(merged.mcpServers, config.mcpServers);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  return merged;
}

export function takeMcpFrames(buffer: Buffer): { messages: JsonRpcMessage[]; rest: Buffer } {
  const messages: JsonRpcMessage[] = [];
  let rest = buffer;

  while (rest.length > 0) {
    const asText = rest.toString('utf8');
    if (/^content-length:/i.test(asText)) {
      const headerEnd = rest.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;
      const header = rest.slice(0, headerEnd).toString('utf8');
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) break;
      const length = Number(match[1]);
      const start = headerEnd + 4;
      if (rest.length < start + length) break;
      messages.push(JSON.parse(rest.slice(start, start + length).toString('utf8')) as JsonRpcMessage);
      rest = rest.slice(start + length);
      continue;
    }

    const newline = rest.indexOf('\n');
    if (newline === -1) break;
    const line = rest.slice(0, newline).toString('utf8').trim();
    rest = rest.slice(newline + 1);
    if (!line || /^content-/i.test(line)) continue;
    if (line.startsWith('{')) messages.push(JSON.parse(line) as JsonRpcMessage);
  }

  return { messages, rest };
}

class McpSession {
  private child: ChildProcess;
  private buffer = Buffer.alloc(0);
  private pending = new Map<number, (message: JsonRpcMessage) => void>();
  private nextId = 1;

  constructor(private config: McpServerConfig) {
    this.child = spawn(config.command, config.args || [], {
      env: { ...process.env, ...(config.env || {}) },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout?.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      const drained = takeMcpFrames(this.buffer);
      this.buffer = drained.rest;
      for (const message of drained.messages) {
        if (typeof message.id === 'number') {
          this.pending.get(message.id)?.(message);
          this.pending.delete(message.id);
        }
      }
    });
  }

  private send(message: unknown): void {
    const body = JSON.stringify(message);
    this.child.stdin?.write('Content-Length: ' + Buffer.byteLength(body) + '\r\n\r\n' + body);
  }

  private request(method: string, params: unknown): Promise<JsonRpcMessage> {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('MCP ' + method + ' timed out.'));
      }, 20000);
      this.pending.set(id, (message) => {
        clearTimeout(timer);
        if (message.error) reject(new Error(message.error.message || 'MCP call failed.'));
        else resolvePromise(message);
      });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  async initialize(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'skycode', version: '1.22.0' },
    });
    this.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  }

  async listTools(server: string): Promise<McpToolInfo[]> {
    const response = await this.request('tools/list', {});
    const tools = ((response.result as { tools?: Array<{ name?: string; description?: string }> })?.tools) || [];
    return tools
      .filter((tool) => typeof tool.name === 'string')
      .map((tool) => ({
        server,
        name: tool.name as string,
        description: tool.description || '',
      }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const response = await this.request('tools/call', { name, arguments: args });
    const content = (response.result as { content?: Array<{ text?: string }> })?.content || [];
    const text = content.map((item) => item.text || '').filter(Boolean).join('\n');
    return text || JSON.stringify(response.result ?? {});
  }

  close(): void {
    this.child.kill();
  }
}

const sessions = new Map<string, McpSession>();

async function sessionFor(workspace: string, serverName: string): Promise<McpSession> {
  const key = workspace + '\n' + serverName;
  const existing = sessions.get(key);
  if (existing) return existing;

  const config = await loadMcpConfig(workspace);
  const server = config.mcpServers[serverName];
  if (!server) {
    const names = Object.keys(config.mcpServers);
    throw new Error(
      names.length === 0
        ? 'No MCP servers are configured. Add ~/.skycode/mcp.json or skycode.mcp.json. For Figma, configure the Framelink or figma-developer-mcp stdio server there.'
        : 'Unknown MCP server "' + serverName + '". Configured: ' + names.join(', ')
    );
  }

  const session = new McpSession(server);
  await session.initialize();
  sessions.set(key, session);
  return session;
}

export async function listMcpTools(workspace: string): Promise<string> {
  const config = await loadMcpConfig(workspace);
  const names = Object.keys(config.mcpServers);
  if (names.length === 0) {
    return [
      'No MCP servers are configured.',
      'Create ~/.skycode/mcp.json with an mcpServers entry. Example for Figma:',
      '{',
      '  "mcpServers": {',
      '    "figma": {',
      '      "command": "npx",',
      '      "args": ["-y", "figma-developer-mcp", "--stdio"],',
      '      "env": { "FIGMA_API_KEY": "your-key" }',
      '    }',
      '  }',
      '}',
    ].join('\n');
  }

  const lines: string[] = [];
  for (const name of names) {
    const session = await sessionFor(workspace, name);
    const tools = await session.listTools(name);
    lines.push(name + ':');
    for (const tool of tools) {
      lines.push('  ' + tool.name + (tool.description ? ' — ' + tool.description : ''));
    }
  }
  return lines.join('\n');
}

export async function callMcpTool(
  workspace: string,
  serverName: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<string> {
  const session = await sessionFor(workspace, serverName);
  return session.callTool(toolName, args);
}

export function closeMcpSessions(): void {
  for (const session of sessions.values()) session.close();
  sessions.clear();
}
