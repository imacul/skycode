export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

const BLOCKED_HOSTS = new Set([
  '169.254.169.254',
  'metadata.google.internal',
]);

export function assertPublicHttpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('URL must be a full http or https address.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https URLs can be opened or fetched.');
  }

  if (BLOCKED_HOSTS.has(url.hostname)) {
    throw new Error('That host is blocked.');
  }

  return url;
}

export function htmlToText(html: string): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();

  return text.slice(0, 12000);
}

export function decodeDuckDuckGoUrl(href: string): string {
  try {
    const url = new URL(href, 'https://duckduckgo.com');
    const target = url.searchParams.get('uddg');
    if (target) return decodeURIComponent(target);
  } catch {
    // Fall through to the raw href.
  }
  return href.startsWith('//') ? 'https:' + href : href;
}

export function parseDuckDuckGoResults(html: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const linkRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const links = [...html.matchAll(linkRe)];

  for (const link of links) {
    const title = htmlToText(link[2]);
    const url = decodeDuckDuckGoUrl(link[1].replace(/&amp;/g, '&'));
    if (!title || !/^https?:\/\//i.test(url)) continue;

    const after = html.slice((link.index || 0) + link[0].length, (link.index || 0) + link[0].length + 800);
    const snippetMatch = after.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|td|div)>/i);
    results.push({
      title,
      url,
      snippet: snippetMatch ? htmlToText(snippetMatch[1]) : '',
    });
    if (results.length >= 5) break;
  }

  return results;
}

async function readLimited(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return (await response.text()).slice(0, maxBytes);

  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < maxBytes) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(next.value);
    size += next.value.byteLength;
  }
  reader.cancel().catch(() => undefined);
  return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))).slice(0, maxBytes);
}

export async function searchWeb(query: string): Promise<string> {
  const clean = query.trim();
  if (!clean) throw new Error('query must be a non-empty string.');

  const response = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(clean), {
    headers: {
      'User-Agent': 'SkyCode/1.22',
      Accept: 'text/html',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error('Web search failed (' + response.status + ').');
  }

  const html = await readLimited(response, 400000);
  const results = parseDuckDuckGoResults(html);
  if (results.length === 0) {
    return 'No web results for: ' + clean;
  }

  return results
    .map((result, index) =>
      (index + 1) + '. ' + result.title + '\n' + result.url + (result.snippet ? '\n' + result.snippet : '')
    )
    .join('\n\n');
}

export async function fetchWebPage(value: string): Promise<string> {
  const url = assertPublicHttpUrl(value);
  const response = await fetch(url, {
    headers: { 'User-Agent': 'SkyCode/1.22', Accept: 'text/html,application/json,text/plain' },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error('Page fetch failed (' + response.status + ') for ' + url.href);
  }

  const raw = await readLimited(response, 400000);
  const contentType = response.headers.get('content-type') || '';
  const text = contentType.includes('html') ? htmlToText(raw) : raw.slice(0, 12000);
  return 'Fetched ' + url.href + '\n\n' + (text || '(empty page)');
}
