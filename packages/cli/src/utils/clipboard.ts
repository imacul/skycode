import { spawnSync } from 'node:child_process';

export function copyToClipboard(text: string): boolean {
  if (!text) return false;

  const platform = process.platform;

  try {
    if (platform === 'win32') {
      const result = spawnSync('clip.exe', [], {
        input: text,
        encoding: 'utf8',
        windowsHide: true,
      });
      return result.status === 0;
    }

    if (platform === 'darwin') {
      const result = spawnSync('pbcopy', [], {
        input: text,
        encoding: 'utf8',
      });
      return result.status === 0;
    }

    const candidates: Array<[string, string[]]> = [
      ['wl-copy', []],
      ['xclip', ['-selection', 'clipboard']],
      ['xsel', ['--clipboard', '--input']],
    ];

    for (const [command, args] of candidates) {
      const result = spawnSync(command, args, {
        input: text,
        encoding: 'utf8',
      });
      if (result.status === 0) return true;
    }
  } catch {
    return false;
  }

  return false;
}
