import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve } from 'node:path';

export type WindowsDesktopRequest =
  | { action: 'snapshot' }
  | { action: 'list_windows' }
  | { action: 'close_document'; filename: string }
  | { action: 'notepad_document'; path: string; content: string };

export interface WindowsDesktopResult {
  ok: boolean;
  action?: string;
  path?: string;
  filename?: string;
  targetWindow?: string;
  windows?: Array<{ title: string; processName: string; processId: number; windowHandle: string; focused: boolean; visibility: 'visible' | 'minimized' | 'background' | 'system-ui' }>;
  backgroundProcessCandidates?: Array<{ processName: string; processId: number; visibility: 'background-process' }>;
  complete?: boolean;
  note?: string;
  closed?: boolean;
  diskVerified?: boolean;
  notepadOpened?: boolean;
  editorVerified?: boolean;
  documentClosed?: boolean;
  documentReopened?: boolean;
  reopenEditorVerified?: boolean;
  verified?: boolean;
  notes?: string[];
  editorVerification?: string;
  windowError?: string;
  window?: { title: string; processId: number; nodes: Array<{ name: string; role: string; automationId: string; enabled: boolean; offscreen: boolean }> };
  error?: string;
}

export function validateNotepadTarget(filename: string, workspace: string): string {
  if (typeof filename !== 'string' || !/^[\w][\w .-]{0,100}\.txt$/i.test(filename) || filename.includes('..') || basename(filename) !== filename) {
    throw new Error('Use a simple .txt filename without directories or traversal.');
  }
  // The agent may create files only under the active workspace for the first milestone.
  // A later dedicated user-approved destination policy can add Desktop/Documents.
  const result = resolve(workspace, filename);
  const rel = relative(resolve(workspace), result);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Invalid workspace destination.');
  if (existsSync(result)) throw new Error('File already exists; overwrite is blocked.');
  return result;
}

export async function runWindowsDesktop(request: WindowsDesktopRequest): Promise<WindowsDesktopResult> {
  if (process.platform !== 'win32') throw new Error('Windows desktop control is available on Windows only.');
  const script = resolve(import.meta.dir, '../../scripts/windows-desktop.ps1');
  if (!existsSync(script)) throw new Error('Windows desktop adapter script was not installed.');
  return await new Promise<WindowsDesktopResult>((resolvePromise, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '', errors = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Windows desktop operation timed out.')); }, 25000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', data => { output += data; if (output.length > 120000) child.kill(); });
    child.stderr.on('data', data => { errors += data; if (errors.length > 12000) child.kill(); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      try {
        const response = JSON.parse(output.trim()) as WindowsDesktopResult;
        if (!response.ok) reject(new Error(response.error || 'Windows desktop operation failed.'));
        else resolvePromise(response);
      } catch (error) {
        reject(new Error('Windows desktop adapter returned invalid output (exit ' + code + '): ' + (errors || String(error)).slice(0, 600)));
      }
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(JSON.stringify(request), 'utf8');
  });
}
