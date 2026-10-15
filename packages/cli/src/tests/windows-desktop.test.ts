import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateNotepadTarget, runWindowsDesktop } from '../agents/windows-desktop';
import { PROJECT_TOOL_NAMES, getProjectToolInstructions, needsReachTools, parseProjectToolCalls } from '../agents/project-tools';

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
    expect(PROJECT_TOOL_NAMES).toContain('desktop_close_document');
    expect(needsReachTools('close the file')).toBe(true);
    expect(needsReachTools('close the document')).toBe(true);
    expect(PROJECT_TOOL_NAMES).toContain('desktop_notepad_document');
    expect(needsReachTools('Open Notepad and create a note')).toBe(true);
    expect(needsReachTools('Inspect the current desktop window')).toBe(true);
    const prompt = getProjectToolInstructions(process.cwd());
    expect(prompt).toContain('desktop_notepad_document');
    expect(prompt).toContain('desktop_close_document');
    expect(prompt).toContain('requires approval');
    expect(parseProjectToolCalls('<tool_call>{"name":"desktop_notepad_document","args":{"filename":"demo.txt","content":"hello","reason":"demo"}}</tool_call>')).toHaveLength(1);
  });
  test('does not operate a non-Windows desktop', async () => {
    if (process.platform !== 'win32') {
      await expect(runWindowsDesktop({ action: 'snapshot' })).rejects.toThrow(/Windows only/);
    }
  });
});
