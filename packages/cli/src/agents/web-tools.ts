import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
import { assertSafetyEnabled } from '../security/safety-control';

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

const BLOCKED_HOSTS = new Set([
  'localhost',
  '169.254.169.254',
  'metadata.google.internal',
]);

function isPrivateIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && octets[2] === 100))) ||
    (a === 203 && b === 0 && octets[2] === 113) ||
    a >= 224
  );
}

function ipv6Groups(address: string): number[] | null {
  let clean = address.toLowerCase().split('%')[0];
  const dotted = clean.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  let tail: number[] = [];
  if (dotted) {
    const bytes = dotted.split('.').map(Number);
    if (bytes.length !== 4 || bytes.some((value) => value < 0 || value > 255)) return null;
    tail = [(bytes[0] << 8) | bytes[1], (bytes[2] << 8) | bytes[3]];
    clean = clean.slice(0, -dotted.length).replace(/:$/, '');
  }
  const sides = clean.split('::');
  if (sides.length > 2) return null;
  const left = sides[0] ? sides[0].split(':').map((value) => parseInt(value, 16)) : [];
  const right = sides[1] ? sides[1].split(':').map((value) => parseInt(value, 16)) : [];
  if ([...left, ...right].some((value) => !Number.isInteger(value) || value < 0 || value > 0xffff)) return null;
  const missing = 8 - left.length - right.length - tail.length;
  if ((sides.length === 1 && missing !== 0) || missing < 0) return null;
  return [...left, ...Array(missing).fill(0), ...right, ...tail];
}

export function isPrivateNetworkAddress(address: string): boolean {
  const clean = address.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  const version = isIP(clean);
  if (version === 4) return isPrivateIpv4(clean);
  if (version !== 6) return true;

  const groups = ipv6Groups(clean);
  if (!groups) return true;
  if (groups.slice(0, 7).every((value) => value === 0) && groups[7] <= 1) return true;
  if (groups.slice(0, 5).every((value) => value === 0) && groups[5] === 0xffff) {
    return isPrivateIpv4(`${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`);
  }
  const first = groups[0];
  if ((first & 0xfe00) === 0xfc00) return true;
  if ((first & 0xffc0) === 0xfe80) return true;
  if ((first & 0xff00) === 0xff00) return true;
  if (first === 0x2001 && groups[1] === 0x0db8) return true;
  return (first & 0xe000) !== 0x2000;
}

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

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    BLOCKED_HOSTS.has(hostname) ||
    hostname.endsWith('.localhost') ||
    (isIP(hostname) !== 0 && isPrivateNetworkAddress(hostname))
  ) {
    throw new Error('That host is blocked.');
  }

  return url;
}

export async function assertPublicHttpTarget(value: string | URL): Promise<URL> {
  const url = assertPublicHttpUrl(String(value));
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(hostname) !== 0) return url;

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateNetworkAddress(address))) {
    throw new Error('That host resolves to a local or private network address.');
  }
  return url;
}

export async function assertLocalHttpTarget(value: string | URL): Promise<URL> {
  let url: URL;
  try {
    url = new URL(String(value));
  } catch {
    throw new Error('URL must be a full http or https address.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https URLs can be fetched.');
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTS.has(hostname) && hostname !== 'localhost') {
    throw new Error('Cloud metadata and link-local service targets remain blocked.');
  }
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => !isPrivateNetworkAddress(address))) {
    throw new Error('Local-network capability only accepts local or private destinations.');
  }
  if (addresses.some(({ address }) => address === '169.254.169.254')) {
    throw new Error('Cloud metadata targets remain blocked.');
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

export function parseBingRssResults(xml: string): WebSearchResult[] {
  const decode = (value: string) => htmlToText(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'));
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 5).flatMap((match) => {
    const item = match[1];
    const title = item.match(/<title>([\s\S]*?)<\/title>/i)?.[1];
    const link = item.match(/<link>([\s\S]*?)<\/link>/i)?.[1];
    const description = item.match(/<description>([\s\S]*?)<\/description>/i)?.[1] || '';
    if (!title || !link) return [];
    try {
      const url = new URL(decode(link)).href;
      return [{ title: decode(title), url, snippet: decode(description) }];
    } catch {
      return [];
    }
  });
}

interface SafeResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
  url: URL;
}

async function resolvedAddresses(url: URL, network: 'public' | 'local') {
  const validated = network === 'public'
    ? await assertPublicHttpTarget(url)
    : await assertLocalHttpTarget(url);
  const hostname = validated.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookup(hostname, { all: true, verbatim: true });
  return { validated, addresses };
}

export function createPinnedLookup(pinned: { address: string; family: number }) {
  if (!pinned?.address || (pinned.family !== 4 && pinned.family !== 6)) {
    throw new Error('DNS validation returned no usable IP address.');
  }
  return (_hostname: string, options: { all?: boolean } | number, callback: (...args: any[]) => void) => {
    // Node's HTTPS client may request `all: true` for auto-family selection.
    // That callback contract expects LookupAddress[], not the older
    // (address, family) pair. Returning the wrong shape caused
    // ERR_INVALID_IP_ADDRESS with `undefined` on real HTTPS searches.
    if (typeof options === 'object' && options?.all) {
      callback(null, [{ address: pinned.address, family: pinned.family }]);
      return;
    }
    callback(null, pinned.address, pinned.family);
  };
}

async function requestPinnedText(
  initial: string | URL,
  network: 'public' | 'local',
  accept: string,
  maxBytes = 400_000
): Promise<SafeResponse> {
  let current = new URL(String(initial));
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const { validated, addresses } = await resolvedAddresses(current, network);
    if (addresses.length === 0) throw new Error('DNS validation returned no usable IP address.');
    const transport = validated.protocol === 'https:' ? httpsRequest : httpRequest;
    let response: SafeResponse | undefined;
    let lastConnectionError: unknown;
    // DNS commonly returns several safe CDN addresses. Pin and try each
    // already-validated answer without re-resolving; one edge may be
    // unreachable even though the service is healthy.
    for (const pinned of addresses) {
      try {
        response = await new Promise<SafeResponse>((resolvePromise, reject) => {
          const request = transport(validated, {
        method: 'GET',
        headers: {
          'User-Agent': 'SkyCode/1.22',
          Accept: accept,
          'Accept-Encoding': 'identity',
          Connection: 'close',
        },
        lookup: createPinnedLookup(pinned),
          }, (incoming) => {
        const status = incoming.statusCode || 0;
        const encoding = String(incoming.headers['content-encoding'] || 'identity').toLowerCase();
        if (encoding !== 'identity') {
          incoming.destroy();
          reject(new Error('Compressed web responses are not accepted.'));
          return;
        }
        const declared = Number(incoming.headers['content-length'] || 0);
        if (declared > maxBytes) {
          incoming.destroy();
          reject(new Error('Web response exceeds the maximum allowed size.'));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        incoming.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > maxBytes) {
            incoming.destroy(new Error('Web response exceeds the maximum allowed size.'));
            return;
          }
          chunks.push(Buffer.from(chunk));
        });
        incoming.on('error', reject);
        incoming.on('end', () => resolvePromise({
          status,
          headers: incoming.headers,
          body: Buffer.concat(chunks).toString('utf8'),
          url: validated,
        }));
          });
          request.setTimeout(15_000, () => request.destroy(new Error('Web request timed out.')));
          request.on('error', reject);
          request.end();
        });
        break;
      } catch (error) {
        lastConnectionError = error;
      }
    }
    if (!response) throw lastConnectionError || new Error('All validated web addresses failed.');

    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    if (redirects === 5) throw new Error('Page fetch exceeded the redirect limit.');
    const location = response.headers.location;
    if (!location) throw new Error('Page redirect did not include a destination.');
    current = new URL(location, response.url);
  }
  throw new Error('Page fetch exceeded the redirect limit.');
}

function assertReadableMime(headers: IncomingHttpHeaders): string {
  const contentType = String(headers['content-type'] || 'text/plain').toLowerCase();
  if (!/^(?:text\/|application\/(?:json|xml|rss\+xml|atom\+xml|xhtml\+xml))/.test(contentType)) {
    throw new Error('Unsupported web response type: ' + contentType);
  }
  return contentType;
}

export async function searchWeb(query: string): Promise<string> {
  const results = await searchWebResults(query);
  const clean = query.trim();
  if (results.length === 0) return 'No web results for: ' + clean;
  return results
    .map((result, index) =>
      (index + 1) + '. ' + result.title + '\n' + result.url + (result.snippet ? '\n' + result.snippet : '')
    )
    .join('\n\n');
}

export async function searchWebResults(query: string): Promise<WebSearchResult[]> {
  const clean = query.trim();
  if (!clean) throw new Error('query must be a non-empty string.');

  const response = await requestPinnedText(
    'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(clean),
    'public',
    'text/html'
  );
  if (response.status < 200 || response.status >= 300) {
    throw new Error('Web search failed (' + response.status + ').');
  }
  assertReadableMime(response.headers);
  const html = response.body;
  const results = parseDuckDuckGoResults(html);
  if (results.length > 0) return results;
  if (/anomaly\.js|confirm this search was made by a human/i.test(html)) {
    const fallback = await requestPinnedText(
      'https://www.bing.com/search?format=rss&q=' + encodeURIComponent(clean),
      'public',
      'application/rss+xml,application/xml,text/xml'
    );
    if (fallback.status < 200 || fallback.status >= 300) {
      throw new Error('Fallback web search failed (' + fallback.status + ').');
    }
    assertReadableMime(fallback.headers);
    return parseBingRssResults(fallback.body);
  }
  return [];
}

export async function fetchWebPage(value: string): Promise<string> {
  assertSafetyEnabled();
  return fetchPageForNetwork(value, 'public');
}

export async function fetchLocalWebPage(value: string): Promise<string> {
  assertSafetyEnabled();
  return fetchPageForNetwork(value, 'local');
}

async function fetchPageForNetwork(value: string, network: 'public' | 'local'): Promise<string> {
  const response = await requestPinnedText(
    value,
    network,
    'text/html,application/json,text/plain,application/xml'
  );
  if (response.status < 200 || response.status >= 300) {
    throw new Error('Page fetch failed (' + response.status + ') for ' + response.url.href);
  }
  const contentType = assertReadableMime(response.headers);
  const text = contentType.includes('html') ? htmlToText(response.body) : response.body.slice(0, 12000);
  return 'Fetched ' + response.url.href + '\n\n' + (text || '(empty page)');
}
