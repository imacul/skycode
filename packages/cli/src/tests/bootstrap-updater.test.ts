import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dir, '../../../../');
const installPs1 = readFileSync(resolve(repoRoot, 'install.ps1'), 'utf8');
const updatePs1 = readFileSync(resolve(repoRoot, 'update.ps1'), 'utf8');

describe('bootstrap-safe updater', () => {
  it('routes skycode update before loading the Bun application', () => {
    const updateRoute = installPs1.indexOf('if /I "%~1"=="update" goto :update');
    const bunLaunch = installPs1.indexOf('bun "%USERPROFILE%\\.skycode\\app\\packages\\cli\\src\\index.tsx" %*');

    expect(updateRoute).toBeGreaterThan(-1);
    expect(bunLaunch).toBeGreaterThan(-1);
    expect(updateRoute).toBeLessThan(bunLaunch);
  });

  it('routes version commands without parsing the application', () => {
    expect(installPs1).toContain('if /I "%~1"=="-v" goto :version');
    expect(installPs1).toContain('ConvertFrom-Json).version');
  });

  it('has a standalone updater that repairs the managed checkout', () => {
    expect(updatePs1).toContain('git -C $InstallRoot reset --hard origin/main');
    expect(updatePs1).toContain('function Write-BootstrapShim');
    expect(updatePs1).not.toContain("from './");
  });

  it('falls back to the installer if the standalone updater is missing', () => {
    expect(installPs1).toContain('goto :repair');
    expect(installPs1).toContain('raw.githubusercontent.com/imacul/skycode/main/install.ps1');
  });
});
