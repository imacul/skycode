import { describe, expect, it } from 'bun:test';
import { createServer } from 'node:http';
import { detectBrowserPlayRequest, extractYoutubeVideoIds, selectRecentYoutubeCandidate, youtubeMusicWatchUrl } from '../agents/browser-control';
import { shouldUseProjectTools } from '../agents/project-tools';
import { classifyOpenTarget } from '../agents/desktop-tools';
import { parseMcpConfig, takeMcpFrames } from '../agents/mcp-client';
import { parseProjectToolCalls } from '../agents/project-tools';
import { assertLocalHttpTarget, assertPublicHttpUrl, fetchLocalWebPage, htmlToText, isPrivateNetworkAddress, parseDuckDuckGoResults } from '../agents/web-tools';

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

  it('rejects loopback, private, link-local, and IPv6-local web targets', () => {
    for (const address of [
      '127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.1.2',
      '192.0.2.1', '198.51.100.2', '203.0.113.4', '198.18.0.1',
      '::1', 'fd00::1', 'fe80::1', 'ff02::1', '2001:db8::1', '::ffff:127.0.0.1',
    ]) {
      expect(isPrivateNetworkAddress(address)).toBe(true);
    }
    expect(isPrivateNetworkAddress('8.8.8.8')).toBe(false);
    expect(isPrivateNetworkAddress('2606:4700:4700::1111')).toBe(false);
    expect(() => assertPublicHttpUrl('http://localhost/admin')).toThrow(/blocked/);
    expect(() => assertPublicHttpUrl('http://127.0.0.1/admin')).toThrow(/blocked/);
    expect(() => assertPublicHttpUrl('http://[::1]/admin')).toThrow(/blocked/);
  });

  it('keeps local-network targets behind a separate target policy', async () => {
    expect((await assertLocalHttpTarget('http://127.0.0.1:3000/')).hostname).toBe('127.0.0.1');
    expect((await assertLocalHttpTarget('http://[::1]/')).hostname).toBe('[::1]');
    await expect(assertLocalHttpTarget('https://8.8.8.8/')).rejects.toThrow(/local or private/);
    await expect(assertLocalHttpTarget('http://169.254.169.254/')).rejects.toThrow(/metadata/);
  });

  it('pins local requests and enforces redirect, encoding, MIME, and size boundaries', async () => {
    const server = createServer((request, response) => {
      if (request.url === '/redirect-public') {
        response.writeHead(302, { Location: 'https://8.8.8.8/' }).end();
      } else if (request.url === '/compressed') {
        response.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Encoding': 'gzip' }).end('fake');
      } else if (request.url === '/binary') {
        response.writeHead(200, { 'Content-Type': 'application/octet-stream' }).end('bytes');
      } else if (request.url === '/large') {
        response.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': '400001' }).end();
      } else {
        response.writeHead(200, { 'Content-Type': 'text/plain' }).end('local-ok');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const base = `http://127.0.0.1:${port}`;
    try {
      expect(await fetchLocalWebPage(base + '/ok')).toContain('local-ok');
      await expect(fetchLocalWebPage(base + '/redirect-public')).rejects.toThrow(/local or private/);
      await expect(fetchLocalWebPage(base + '/compressed')).rejects.toThrow(/Compressed/);
      await expect(fetchLocalWebPage(base + '/binary')).rejects.toThrow(/Unsupported/);
      await expect(fetchLocalWebPage(base + '/large')).rejects.toThrow(/maximum allowed size/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('opens browser URLs and known apps, and rejects arbitrary programs', () => {
    expect(classifyOpenTarget('https://example.com/docs').kind).toBe('url');
    expect(classifyOpenTarget('figma').value).toBe('figma');
    expect(() => classifyOpenTarget('cmd')).toThrow(/cannot launch arbitrary/);
  });

  it('treats a Brave YouTube Music request as something SkyCode does itself', () => {
    const prompt = 'Go to Brave. If it is not open, open it, and play Asake\'s latest album on YouTube Music.';
    expect(detectBrowserPlayRequest(prompt)).toBe('Asake latest album');
    expect(shouldUseProjectTools(prompt)).toBe(true);
    expect(detectBrowserPlayRequest('What is YouTube Music?')).toBeNull();
    expect(detectBrowserPlayRequest('Find the latest Asake song and play it.')).toBe('Asake latest song');
    expect(shouldUseProjectTools('Research the latest Asake release online.')).toBe(true);
    expect(shouldUseProjectTools('Open Brave and browse the web.')).toBe(true);
  });

  it('builds a YouTube Music autoplay link from search HTML', () => {
    const html = '{"videoId":"abcdefghijk"} {"videoId":"abcdefghijk"} {"videoId":"zzz12345678"}';
    expect(extractYoutubeVideoIds(html)[0]).toBe('abcdefghijk');
    expect(youtubeMusicWatchUrl('abcdefghijk')).toBe(
      'https://music.youtube.com/watch?v=abcdefghijk&autoplay=1'
    );
  });

  it('requires current evidence before choosing a latest music result', () => {
    const currentYear = new Date().getUTCFullYear();
    expect(selectRecentYoutubeCandidate([
      { title: 'Asake - Old Album', url: 'https://youtube.com/watch?v=abcdefghijk', snippet: 'Released in 2023' },
      { title: 'Asake - New Single (Official)', url: 'https://www.youtube.com/watch?v=zzz12345678', snippet: `Official release ${currentYear}` },
    ], 'Asake', currentYear)).toContain('zzz12345678');
    expect(selectRecentYoutubeCandidate([
      { title: 'Asake - Work of Art', url: 'https://youtube.com/watch?v=abcdefghijk', snippet: '2023 album' },
    ], 'Asake', currentYear)).toBeNull();
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
