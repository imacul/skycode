import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { assertPublicHttpUrl, searchWeb, searchWebResults } from './web-tools';

const DEBUG_PORT = 9333;
const SKYCODE_BROWSER_PROFILE = join(homedir(), '.skycode', 'browser-profile');

export function detectBrowserPlayRequest(input: string): string | null {
  const text = input.replace(/\s+/g, ' ').trim();
  if (!/\b(play|listen to|put on)\b/i.test(text)) return null;

  const explicit = text.match(/\bplay(?:\s+me)?\s+(?:the\s+)?(.+?)\s+on\s+youtube music\b/i);
  if (explicit) {
    const query = explicit[1].replace(/['’]s\b/g, '').replace(/\s+/g, ' ').trim();
    return query || null;
  }

  const latest = text.match(/\b(?:find\s+)?(?:and\s+)?play(?:\s+me)?\s+(?:the\s+)?(?:latest|newest|new)\s+(.+?)(?:\s+(?:song|track|album|music))?(?:\s+(?:and\s+)?play(?:\s+it)?)?[.!?]*$/i)
    || text.match(/\bfind\s+(?:the\s+)?(?:latest|newest|new)\s+(.+?)(?:\s+(song|track|album|music))?\s+and\s+play(?:\s+it)?/i);
  if (!latest) return null;
  const subject = latest[1].replace(/['’]s\b/g, '').replace(/\s+/g, ' ').trim();
  return subject ? subject + ' latest song' : null;
}

export function extractYoutubeVideoIds(html: string): string[] {
  const ids = [...html.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)].map((match) => match[1]);
  return [...new Set(ids)];
}

export function youtubeMusicWatchUrl(videoId: string): string {
  return 'https://music.youtube.com/watch?v=' + videoId + '&autoplay=1';
}

export function selectRecentYoutubeCandidate(
  results: Array<{ title: string; url: string; snippet: string }>,
  artist: string,
  year: number
): string | null {
  const artistToken = artist.toLowerCase().split(/\s+/)[0];
  for (const result of results) {
    const evidence = (result.title + ' ' + result.snippet).toLowerCase();
    if (!evidence.includes(artistToken)) continue;
    if (!new RegExp(`\\b${year}\\b|\\b(?:today|yesterday|\\d+ (?:day|week|month)s? ago)\\b`, 'i').test(evidence)) continue;
    try {
      const url = new URL(result.url);
      if (!/(?:^|\.)youtube\.com$/i.test(url.hostname)) continue;
      const videoId = url.searchParams.get('v');
      if (/^[A-Za-z0-9_-]{11}$/.test(videoId || '')) return youtubeMusicWatchUrl(videoId!);
    } catch {
      // Ignore malformed search results.
    }
  }
  return null;
}

async function findVerifiedLatestYoutubeMusicUrl(query: string): Promise<string> {
  const year = new Date().getUTCFullYear();
  const artist = query.replace(/\b(latest|newest|new|song|track|album|music)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  const results = await searchWebResults(`${artist} latest song official release ${year} site:youtube.com/watch`);
  const selected = selectRecentYoutubeCandidate(results, artist, year);
  if (!selected) {
    throw new Error(
      `SkyCode could not verify a ${year} release for ${artist} from the current search evidence, so it refused to guess or play an older result.`
    );
  }
  return selected;
}

export function findBraveExecutable(): string | null {
  const local = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  const candidates = [
    join(local, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  ];
  return candidates.find((path) => existsSync(path)) || null;
}

export function braveIsRunning(): Promise<boolean> {
  if (process.platform !== 'win32') {
    return Promise.resolve(false);
  }
  return new Promise((resolvePromise) => {
    execFile('tasklist', ['/FI', 'IMAGENAME eq brave.exe', '/NH'], { windowsHide: true }, (error, stdout) => {
      resolvePromise(!error && /brave\.exe/i.test(stdout || ''));
    });
  });
}

async function debuggingPortOpen(): Promise<boolean> {
  try {
    const response = await fetch('http://127.0.0.1:' + DEBUG_PORT + '/json/version', {
      signal: AbortSignal.timeout(800),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function launchBrave(bravePath: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(bravePath, args, { detached: true, stdio: 'ignore', windowsHide: false });
    child.on('error', reject);
    child.unref();
    setTimeout(() => resolvePromise(), 400);
  });
}

export async function openInBrave(url: string): Promise<{ runningBefore: boolean; opened: string }> {
  const target = assertPublicHttpUrl(url).href;
  const bravePath = findBraveExecutable();
  if (!bravePath) {
    throw new Error('Brave is not installed in the usual location, so SkyCode cannot open it.');
  }

  const runningBefore = await braveIsRunning();
  const debug = await debuggingPortOpen();
  const args = debug
    ? ['--user-data-dir=' + SKYCODE_BROWSER_PROFILE, target]
    : [
        '--user-data-dir=' + SKYCODE_BROWSER_PROFILE,
        '--remote-debugging-port=' + DEBUG_PORT,
        '--no-first-run',
        '--no-default-browser-check',
        '--new-window',
        target,
      ];

  await launchBrave(bravePath, args);
  return {
    runningBefore,
    opened: debug
      ? 'Opened a tab in SkyCode’s isolated Brave profile.'
      : 'Started SkyCode’s isolated Brave profile and opened the page.',
  };
}

async function clickYoutubeMusicPlay(): Promise<string> {
  if (!(await debuggingPortOpen())) {
    return 'Opened the song with autoplay. Brave was not started with remote control, so SkyCode could not press the on-page play button.';
  }

  const tabs = await fetch('http://127.0.0.1:' + DEBUG_PORT + '/json/list', {
    signal: AbortSignal.timeout(3000),
  }).then((response) => response.json()) as Array<{ type?: string; url?: string; webSocketDebuggerUrl?: string }>;

  const page = tabs.find((tab) => tab.type === 'page' && tab.webSocketDebuggerUrl && /music\.youtube\.com/.test(tab.url || ''));
  if (!page?.webSocketDebuggerUrl) {
    return 'Opened YouTube Music, but the controllable tab was not ready yet.';
  }

  const clicked = await evaluateOnPage(
    page.webSocketDebuggerUrl,
    `(async () => {
      const selectors = [
        'ytmusic-play-button-renderer',
        '#play-button',
        'button[aria-label="Play"]',
        '[title="Play"]'
      ];
      for (const selector of selectors) {
        const node = document.querySelector(selector);
        if (node) {
          node.click();
          await new Promise(resolve => setTimeout(resolve, 1200));
          const media = document.querySelector('audio,video');
          if (media && !media.paused) return 'verified-playing:' + selector;
          return 'clicked-but-playback-not-verified:' + selector;
        }
      }
      return 'no play button yet';
    })()`
  );
  if (!clicked.startsWith('verified-playing:')) {
    throw new Error('The page opened, but SkyCode could not verify that audio started (' + clicked + ').');
  }
  return 'Playback verified by the page media state.';
}

function evaluateOnPage(wsUrl: string, expression: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const socket = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('Browser control timed out.'));
    }, 8000);

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true },
      }));
    });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        result?: { result?: { value?: string } };
      };
      if (message.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      resolvePromise(String(message.result?.result?.value || ''));
    });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('Could not connect to Brave.'));
    });
  });
}

export async function findYoutubeMusicUrl(query: string): Promise<string> {
  const clean = query.trim();
  if (!clean) throw new Error('query must be a non-empty string.');
  if (/\b(latest|newest|new)\b/i.test(clean)) return findVerifiedLatestYoutubeMusicUrl(clean);

  const year = new Date().getUTCFullYear();
  const response = await fetch(
    'https://www.youtube.com/results?search_query=' + encodeURIComponent(clean + ' official ' + year),
    {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(15000),
    }
  );
  if (!response.ok) {
    throw new Error('YouTube search failed (' + response.status + ').');
  }

  const html = await response.text();
  let videoId = extractYoutubeVideoIds(html)[0];
  if (!videoId) {
    const found = await searchWeb(clean + ' site:music.youtube.com');
    videoId = found.match(/[?&]v=([A-Za-z0-9_-]{11})/)?.[1];
  }
  if (!videoId) {
    throw new Error('No YouTube Music result was found for: ' + clean);
  }
  return youtubeMusicWatchUrl(videoId);
}

export async function playOnYoutubeMusic(query: string): Promise<string> {
  const url = await findYoutubeMusicUrl(query);
  const opened = await openInBrave(url);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 2500));
  const control = await clickYoutubeMusicPlay();

  return [
    opened.opened,
    'Verified playback for search "' + query.trim() + '" on YouTube Music.',
    url,
    control,
  ].join('\n');
}
