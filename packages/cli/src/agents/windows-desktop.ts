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

export type ComputerStep = {
  kind: 'focus' | 'invoke' | 'set_value' | 'keypress';
  expectedTitle: string;
  expectedProcessId: number;
  name?: string;
  automationId?: string;
  keys?: string;
  value?: string;
};

export function validateComputerStep(step: ComputerStep): void {
  if (!step || !['focus','invoke','set_value','keypress'].includes(step.kind)) throw new Error('Invalid computer action.');
  if (!step.expectedTitle || !Number.isSafeInteger(step.expectedProcessId) || step.expectedProcessId <= 0) throw new Error('Exact foreground window identity required.');
  if (step.kind === 'keypress') {
    if (!['^s','^o','^n','^f','^a','^c','^v','{ESC}','{ENTER}','{TAB}','+{TAB}','{UP}','{DOWN}','{LEFT}','{RIGHT}'].includes(step.keys || '')) throw new Error('Unsupported keyboard shortcut.');
  } else if (!step.name && !step.automationId) throw new Error('Specify an accessible control name or automationId.');
  if (step.value != null && step.value.length > 3000) throw new Error('Text input too long.');
}

export async function runComputerCore(action: 'observe' | 'list_windows' | 'act' | 'batch', steps: ComputerStep[] = []): Promise<Record<string, unknown>> {
  if (process.platform !== 'win32') throw new Error('Windows only.');
  if (action === 'act' && steps.length !== 1) throw new Error('Act requires exactly one step.');
  if (action === 'batch' && (!steps.length || steps.length > 8)) throw new Error('Batch requires 1–8 steps.');
  for (const step of steps) validateComputerStep(step);
  const script = resolve(import.meta.dir, '../../scripts/computer-core.ps1');
  if (!existsSync(script)) throw new Error('Computer adapter missing.');
  const request = action === 'act' ? { action, step: steps[0] } : { action, steps };
  return await new Promise<Record<string, unknown>>((done, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script], {
      windowsHide: true, stdio: ['pipe','pipe','pipe'],
    });
    let stdout = '', stderr = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Computer action timed out.')); }, 20000);
    child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); if (stdout.length > 120000) child.kill(); });
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); if (stderr.length > 12000) child.kill(); });
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('close', () => {
      clearTimeout(timeout);
      try {
        const result = JSON.parse(stdout.trim()) as Record<string, unknown>;
        if (result.ok !== true) reject(new Error(String(result.error || 'Computer action failed.')));
        else done(result);
      } catch (error) {
        reject(new Error('Computer adapter failed: ' + (stderr || String(error)).slice(0, 500)));
      }
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(JSON.stringify(request), 'utf8');
  });
}
