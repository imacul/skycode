import { spawn } from 'node:child_process';
import { assertPublicHttpUrl } from './web-tools';
import {
  normalizeOwnershipSettings,
  type OwnershipSettings,
} from '../security/ownership';

const APP_NAMES = new Set([
  'chrome',
  'msedge',
  'firefox',
  'brave',
  'code',
  'figma',
  'explorer',
  'notepad',
]);

export function classifyOpenTarget(
  target: string,
  ownership?: Partial<OwnershipSettings> | null
): { kind: 'url' | 'app'; value: string } {
  const clean = target.trim();
  if (/^https?:\/\//i.test(clean)) {
    return { kind: 'url', value: assertPublicHttpUrl(clean).href };
  }

  const owner = normalizeOwnershipSettings(ownership);
  const name = clean.toLowerCase().replace(/\.exe$/i, '');

  if (owner.mode === 'owner' && owner.allowArbitraryDesktopApps) {
    // Owner Mode: any launchable app name or executable path the user can run.
    if (/^[A-Za-z]:[\\/]/.test(clean) || clean.endsWith('.exe') || clean.includes('\\') || clean.includes('/')) {
      return { kind: 'app', value: clean };
    }
    return { kind: 'app', value: name };
  }

  if (!APP_NAMES.has(name)) {
    throw new Error(
      'SkyCode can open a browser URL, or one of these apps: ' +
        [...APP_NAMES].join(', ') +
        '. It cannot launch arbitrary programs. Use /owner on to allow any app.'
    );
  }

  return { kind: 'app', value: name };
}

export function openOnDesktop(
  target: string,
  ownership?: Partial<OwnershipSettings> | null
): Promise<string> {
  const opened = classifyOpenTarget(target, ownership);
  const command = opened.kind === 'url' ? opened.value : opened.value;

  return new Promise((resolvePromise, reject) => {
    const child = process.platform === 'win32'
      ? spawn('cmd', ['/c', 'start', '', command], { detached: true, windowsHide: true, stdio: 'ignore' })
      : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [command], { detached: true, stdio: 'ignore' });

    child.on('error', reject);
    child.unref();
    setTimeout(() => {
      resolvePromise(
        opened.kind === 'url'
          ? 'Opened in the default browser: ' + opened.value
          : 'Opened system app: ' + opened.value
      );
    }, 300);
  });
}
