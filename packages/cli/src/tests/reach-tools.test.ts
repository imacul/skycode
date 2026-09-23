import { describe, expect, it } from 'bun:test';
import { classifyOpenTarget } from '../agents/desktop-tools';
import { parseMcpConfig, takeMcpFrames } from '../agents/mcp-client';
import { parseProjectToolCalls } from '../agents/project-tools';
import { htmlToText, parseDuckDuckGoResults } from '../agents/web-tools';

describe('web, desktop, and MCP tools', () => {
  it('parses a web search tool call', () => {
    expect(
      parseProjectToolCalls('<tool_call>{"name":"web_search","args":{"query":"figma mcp"}}</tool_call>')
    ).toEqual([{ name: 'web_search', args: { query: 'figma mcp' } }]);
  });

  it('extracts search results and readable page text', () => {
    const html = `
      <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs">Example docs</a>
      <a class="result__snippet">How to configure the server.</a>
    `;
    expect(parseDuckDuckGoResults(html)[0]).toEqual({
      title: 'Example docs',
      url: 'https://example.com/docs',
      snippet: 'How to configure the server.',
    });
    expect(htmlToText('<style>p{}</style><p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  it('opens browser URLs and known apps, and rejects arbitrary programs', () => {
    expect(classifyOpenTarget('https://example.com/docs').kind).toBe('url');
    expect(classifyOpenTarget('figma').value).toBe('figma');
    expect(() => classifyOpenTarget('cmd')).toThrow(/cannot launch arbitrary/);
  });

  it('reads MCP config and content-length frames', () => {
    expect(parseMcpConfig('{"mcpServers":{"figma":{"command":"npx","args":["-y","figma-developer-mcp"]}}}').mcpServers.figma.command).toBe('npx');
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } });
    const frame = Buffer.from('Content-Length: ' + Buffer.byteLength(body) + '\r\n\r\n' + body);
    const parsed = takeMcpFrames(frame);
    expect(parsed.messages[0]?.result).toEqual({ ok: true });
    expect(parsed.rest.length).toBe(0);
  });
});
