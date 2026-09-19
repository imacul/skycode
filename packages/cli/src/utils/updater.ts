import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const SOURCE_FILE = fileURLToPath(import.meta.url);
export const SKYCODE_ROOT = resolve(dirname(SOURCE_FILE), '../../../..');
const UPDATE_SETTINGS_FILE = join(homedir(), '.skycode', 'update.json');
const MIN_BUN_VERSION = '1.4.0';

export interface UpdateCheck {
  available: boolean;
  currentSha: string;
  remoteSha: string;
  currentVersion: string;
  remoteVersion: string;
}

export interface UpdateResult {
  updated: boolean;
  previousSha: string;
  currentSha: string;
  version: string;
  message: string;
}

interface UpdatePreferences {
  autoUpdate: boolean;
  lastCheckAt?: string;
  lastCheckResult?: string;
  lastUpdateAt?: string;
  lastVersion?: string;
  lastUpdateMode?: string;
}

function run(command: string, args: string[], cwd = SKYCODE_ROOT, timeout = 8000): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(command, args, { cwd, timeout, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || error.message).trim()));
        return;
      }
      resolvePromise(stdout.trim());
    });
  });
}

function compareVersions(a: string, b: string): number {
  const left = a.split('.').map((part) => Number(part) || 0);
  const right = b.split('.').map((part) => Number(part) || 0);
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) return diff;
  }

  return 0;
}

async function ensureCompatibleBun(): Promise<void> {
  const current = await run('bun', ['--version']);
  if (compareVersions(current, MIN_BUN_VERSION) >= 0) return;

  console.log(
    `SkyCode requires Bun ${MIN_BUN_VERSION} or newer. Upgrading Bun ${current}...`
  );
  await run('bun', ['upgrade'], SKYCODE_ROOT, 120000);

  const upgraded = await run('bun', ['--version']);
  if (compareVersions(upgraded, MIN_BUN_VERSION) < 0) {
    throw new Error(
      `Bun ${upgraded} is still too old. Install Bun ${MIN_BUN_VERSION} or newer and retry.`
    );
  }
}

export function getCurrentVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(SKYCODE_ROOT, 'package.json'), 'utf8'));
    return String(pkg.version || 'unknown');
  } catch {
    return 'unknown';
  }
}

async function readRemoteVersion(): Promise<string> {
  try {
    const response = await fetch('https://raw.githubusercontent.com/imacul/skycode/main/package.json', {
      signal: AbortSignal.timeout(3000),
      headers: { 'cache-control': 'no-cache' },
    });
    if (!response.ok) return 'unknown';
    const pkg = await response.json() as { version?: string };
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

export function getUpdatePreferences(): UpdatePreferences {
  try {
    if (!existsSync(UPDATE_SETTINGS_FILE)) return { autoUpdate: false };
    const parsed = JSON.parse(readFileSync(UPDATE_SETTINGS_FILE, 'utf8')) as Partial<UpdatePreferences>;
    return {
      autoUpdate: parsed.autoUpdate === true,
      lastCheckAt: parsed.lastCheckAt,
      lastCheckResult: parsed.lastCheckResult,
      lastUpdateAt: parsed.lastUpdateAt,
      lastVersion: parsed.lastVersion,
      lastUpdateMode: parsed.lastUpdateMode,
    };
  } catch {
    return { autoUpdate: false };
  }
}

function writeUpdatePreferences(preferences: UpdatePreferences): void {
  mkdirSync(dirname(UPDATE_SETTINGS_FILE), { recursive: true });
  writeFileSync(UPDATE_SETTINGS_FILE, JSON.stringify(preferences, null, 2), 'utf8');
}

export function setAutoUpdate(enabled: boolean): void {
  writeUpdatePreferences({
    ...getUpdatePreferences(),
    autoUpdate: enabled,
  });
}

export function formatUpdateStatus(): string {
  const preferences = getUpdatePreferences();
  return [
    `Automatic updates: ${preferences.autoUpdate ? 'enabled' : 'disabled'}`,
    `Installed version: v${getCurrentVersion()}`,
    `Last check: ${preferences.lastCheckAt || 'never'}`,
    `Last check result: ${preferences.lastCheckResult || 'unknown'}`,
    `Last successful update: ${preferences.lastUpdateAt || 'never'}`,
    `Last updated version: ${preferences.lastVersion || 'unknown'}`,
    `Last update mode: ${preferences.lastUpdateMode || 'unknown'}`,
  ].join('\n');
}

export async function checkForUpdates(): Promise<UpdateCheck> {
  const currentSha = await run('git', ['rev-parse', 'HEAD']);
  const remoteLine = await run('git', ['ls-remote', 'origin', 'refs/heads/main'], SKYCODE_ROOT, 5000);
  const remoteSha = remoteLine.split(/\s+/)[0] || currentSha;
  const [currentVersion, remoteVersion] = await Promise.all([
    Promise.resolve(getCurrentVersion()),
    readRemoteVersion(),
  ]);

  return {
    available: currentSha !== remoteSha,
    currentSha,
    remoteSha,
    currentVersion,
    remoteVersion,
  };
}

function isManagedInstall(): boolean {
  const managedRoot = resolve(join(homedir(), '.skycode', 'app')).toLowerCase();
  return resolve(SKYCODE_ROOT).toLowerCase() === managedRoot;
}

export async function performUpdate(): Promise<UpdateResult> {
  const previousSha = await run('git', ['rev-parse', 'HEAD']);

  await run('git', ['fetch', 'origin', 'main'], SKYCODE_ROOT, 15000);
  const remoteSha = await run('git', ['rev-parse', 'origin/main']);

  if (previousSha === remoteSha) {
    return {
      updated: false,
      previousSha,
      currentSha: previousSha,
      version: getCurrentVersion(),
      message: 'SkyCode is already up to date.',
    };
  }

  if (isManagedInstall()) {
    await run('git', ['reset', '--hard', 'origin/main']);
  } else {
    const dirty = await run('git', ['status', '--porcelain']);
    if (dirty) {
      throw new Error(
        'Your SkyCode checkout has local changes. Commit or stash them before running skycode update.'
      );
    }
    await run('git', ['merge', '--ff-only', 'origin/main']);
  }

  await ensureCompatibleBun();
  await run('bun', ['install'], SKYCODE_ROOT, 120000);
  const currentSha = await run('git', ['rev-parse', 'HEAD']);

  return {
    updated: true,
    previousSha,
    currentSha,
    version: getCurrentVersion(),
    message: 'SkyCode updated successfully. Restart SkyCode to use the new version.',
  };
}

export async function runUpdateCommand(args: string[]): Promise<number> {
  const flags = new Set(args.map((arg) => arg.toLowerCase()));

  if (flags.has('--no-auto')) {
    setAutoUpdate(false);
    console.log('Automatic SkyCode updates disabled.');
    return 0;
  }

  if (flags.has('--auto')) {
    setAutoUpdate(true);
    console.log('Automatic SkyCode updates enabled.');
  }

  if (flags.has('--status')) {
    console.log(formatUpdateStatus());
    return 0;
  }

  if (flags.has('--check')) {
    try {
      const check = await checkForUpdates();
      if (!check.available) {
        console.log(`SkyCode v${check.currentVersion} is up to date.`);
        return 0;
      }

      const label = check.remoteVersion !== 'unknown' ? `v${check.remoteVersion}` : check.remoteSha.slice(0, 7);
      console.log(`SkyCode update available: ${label}`);
      console.log('Run "skycode update" to install it.');
      return 0;
    } catch {
      console.log('Could not check for updates. You may be offline.');
      return 1;
    }
  }

  try {
    const result = await performUpdate();
    console.log(result.message);
    if (result.updated) {
      console.log(`Current version: v${result.version}`);
    }
    return 0;
  } catch (error) {
    console.error(`SkyCode update failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
