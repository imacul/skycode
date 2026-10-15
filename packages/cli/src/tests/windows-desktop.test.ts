import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateNotepadTarget, runWindowsDesktop } from '../agents/windows-desktop';
import { PROJECT_TOOL_NAMES, getProjectToolInstructions, needsReachTools, parseProjectToolCalls, selectDesktopObservation, projectToolResultMessage } from '../agents/project-tools';

describe('Windows desktop operator milestone', () => {
  test('rejects traversal, absolute paths and non-text documents', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'skycode-desktop-'));
    try {
      for (const name of ['../secret.txt', '..\\secret.txt', 'C:\\Windows\\test.txt', '/tmp/test.txt', '.hidden.txt', 'report.md', 'note.txt/other']) {
        expect(() => validateNotepadTarget(name, workspace)).toThrow();
      }
      expect(validateNotepadTarget('demo-note.txt', workspace)).toBe(join(workspace, 'demo-note.txt'));
      writeFileSync(join(workspace, 'demo-note.txt'), 'already here');
      expect(() => validateNotepadTarget('demo-note.txt', workspace)).toThrow(/exists/);
    } finally { rmSync(workspace, { recursive: true, force: true }); }
  });
  test('registers desktop tools and routes computer requests', () => {
    expect(PROJECT_TOOL_NAMES).toContain('desktop_snapshot');
    expect(PROJECT_TOOL_NAMES).toContain('desktop_list_windows');
    expect(PROJECT_TOOL_NAMES).toContain('desktop_close_document');
    expect(needsReachTools('close the file')).toBe(true);
    expect(needsReachTools('close the document')).toBe(true);
    expect(PROJECT_TOOL_NAMES).toContain('desktop_notepad_document');
    expect(needsReachTools('Open Notepad and create a note')).toBe(true);
    expect(needsReachTools('Inspect the current desktop window')).toBe(true);
    const prompt = getProjectToolInstructions(process.cwd());
    expect(prompt).toContain('desktop_notepad_document');
    expect(prompt).toContain('desktop_close_document');
    expect(prompt).toContain('desktop_list_windows');
    expect(prompt).toContain('requires approval');
    expect(parseProjectToolCalls('<tool_call>{"name":"desktop_notepad_document","args":{"filename":"demo.txt","content":"hello","reason":"demo"}}</tool_call>')).toHaveLength(1);
  });
  test('does not operate a non-Windows desktop', async () => {
    if (process.platform !== 'win32') {
      await expect(runWindowsDesktop({ action: 'snapshot' })).rejects.toThrow(/Windows only/);
    }
  });
});

describe('desktop observation fast path and token feedback', () => {
  test('uses a read-only desktop primitive for explicit window listing', () => {
    expect(selectDesktopObservation('List the applications and windows currently open on my computer.')?.name).toBe('desktop_list_windows');
    expect(selectDesktopObservation('Show currently running apps')?.name).toBe('desktop_list_windows');
    expect(selectDesktopObservation('Close my currently open Notepad window')).toBeNull();
    expect(selectDesktopObservation('Make an app that lists open windows')).toBeNull();
  });

  test('caps oversized tool output before sending it back to the model', () => {
    const result = projectToolResultMessage([{
      call: { name: 'run_command', args: { command: 'echo example' } },
      success: false, trust: 'untrusted-data', content: 'F'.repeat(25000),
    }]);
    expect(result.content.length).toBeLessThan(4500);
    expect(result.content).toContain('truncated');
  });
});

describe('Windows desktop PowerShell adapter syntax', () => {
  test('parses the entire script before any desktop action is run', () => {
    if (process.platform !== 'win32') return;
    const script = resolve(import.meta.dir, '../../scripts/windows-desktop.ps1');
    const escapedPath = script.replace(/'/g, "''");
    const check = '$tokens=$null; $parseErrors=$null; ' +
      "[System.Management.Automation.Language.Parser]::ParseFile('" + escapedPath + "',[ref]$tokens,[ref]$parseErrors) | Out-Null; " +
      'if($parseErrors.Count -gt 0) { $parseErrors | ForEach-Object { Write-Output $_.ToString() }; exit 1 }';
    const parse = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command', check,
    ], { encoding: 'utf8', timeout: 15000 });
    expect(parse.error).toBeUndefined();
    expect(parse.status).toBe(0);
  });
});

describe('window state classification contract', () => {
  test('adapter distinguishes minimized from visible and separates shell UI', () => {
    const file = resolve(import.meta.dir, '../../scripts/windows-desktop.ps1');
    const script = readFileSync(file, 'utf8');
    expect(script).toContain('IsIconic');
    expect(script).toContain('IsWindowVisible');
    expect(script).toContain("'system-ui'");
    expect(script).toContain("'minimized'");
    expect(script).toContain("'visible'");
    expect(script).toContain("'background-process'");
    expect(script).toContain('backgroundProcessCandidates');
    expect(script).toContain('GetForegroundWindow');
  });
});
