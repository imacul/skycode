import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { assertPublicHttpUrl, searchWeb } from './web-tools';

const DEBUG_PORT = 9222;

export function detectBrowserPlayRequest(input: string): string | null {
  const text = input.replace(/\s+/g, ' ').trim();
  if (!/\byoutube music\b/i.test(text) || !/\bplay\b/i.test(text)) return null;

  const match = text.match(/\bplay(?:\s+me)?\s+(?:the\s+)?(.+?)\s+on\s+youtube music\b/i);
  if (!match) return null;

  const query = match[1].replace(/['’]s\b/g, '').replace(/\s+/g, ' ').trim();
  return query || null;
}

export function extractYoutubeVideoIds(html: string): string[] {
  const ids = [...html.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)].map((match) => match[1]);
  return [...new Set(ids)];
}

export function youtubeMusicWatchUrl(videoId: string): string {
  return 'https://music.youtube.com/watch?v=' + videoId + '&autoplay=1';
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
  const args = debug || runningBefore
    ? [target]
    : ['--remote-debugging-port=' + DEBUG_PORT, target];

  await launchBrave(bravePath, args);
  return {
    runningBefore,
    opened: runningBefore ? 'Brave was already open. Opened a tab.' : 'Brave was closed. Started it.',
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
    `(() => {
      const selectors = [
        'ytmusic-play-button-renderer',
        '#play-button',
        'button[aria-label="Play"]',
        '[title="Play"]'
      ];
      for (const selector of selectors) {
        const node = document.querySelector(selector);
        if (node) { node.click(); return 'clicked ' + selector; }
      }
      return 'no play button yet';
    })()`
  );
  return 'Page control: ' + clicked;
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
        params: { expression, returnByValue: true },
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

  const response = await fetch(
    'https://www.youtube.com/results?search_query=' + encodeURIComponent(clean),
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
  let control = '';
  try {
    control = await clickYoutubeMusicPlay();
  } catch (error) {
    control = error instanceof Error ? error.message : String(error);
  }

  return [
    opened.opened,
    'Playing search "' + query.trim() + '" on YouTube Music.',
    url,
    control,
  ].join('\n');
}
