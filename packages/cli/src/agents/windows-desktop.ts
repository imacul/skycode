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
  if (request.action === 'snapshot' || request.action === 'list_windows') {
    const result = await runComputerCore(request.action === 'snapshot' ? 'observe' : 'list_windows');
    return { ...result, action: request.action } as WindowsDesktopResult;
  }
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

export type ComputerWindowSelector = {
  title: string;
  processId: number;
  windowHandle?: string;
};

export function validateComputerWindowSelector(selector: ComputerWindowSelector): void {
  if (!selector || typeof selector.title !== 'string' || !selector.title.trim() || selector.title.length > 500 ||
      !Number.isSafeInteger(selector.processId) || selector.processId <= 0 ||
      (selector.windowHandle !== undefined && !/^[0-9]+$/.test(selector.windowHandle))) {
    throw new Error('Provide exact window title, process ID, and optional decimal handle from desktop discovery.');
  }
}

export type ComputerTextVerification = { expectedTitle: string; expectedProcessId: number; expectedText: string };

export function validateComputerTextVerification(input: ComputerTextVerification): void {
  if (!input || typeof input.expectedTitle !== 'string' || !input.expectedTitle.trim() ||
      !Number.isSafeInteger(input.expectedProcessId) || input.expectedProcessId <= 0 ||
      typeof input.expectedText !== 'string' || input.expectedText.length === 0 || input.expectedText.length > 1000) {
    throw new Error('Text verification requires exact foreground identity and 1–1000 characters of expected text.');
  }
}

export type ComputerVerification = {
  expectedTitle: string;
  expectedProcessId: number;
  controlName?: string;
};

export function verifyComputerObservation(
  observation: Record<string, unknown>,
  expected: ComputerVerification
): { verified: boolean; reason: string } {
  const window = observation.window as { title?: string; processId?: number; nodes?: Array<{ name?: string }> } | undefined;
  if (!window) return { verified: false, reason: 'No foreground window data returned.' };
  if (window.title !== expected.expectedTitle || window.processId !== expected.expectedProcessId) {
    return { verified: false, reason: 'Foreground identity does not match expected window.' };
  }
  if (expected.controlName && !window.nodes?.some(node => node.name === expected.controlName)) {
    return { verified: false, reason: 'Expected accessible control was not found in the bounded observation.' };
  }
  return { verified: true, reason: 'Foreground identity' + (expected.controlName ? ' and control' : '') + ' matched observed UIA state.' };
}

export type ComputerStep = {
  kind: 'scroll_view' | 'focus' | 'invoke' | 'set_value' | 'keypress' | 'scroll' | 'move' | 'click' | 'right_click' | 'double_click' | 'type' | 'drag' | 'visual_click';
  expectedTitle: string;
  expectedProcessId: number;
  name?: string;
  automationId?: string;
  role?: string;
  targetName?: string;
  targetAutomationId?: string;
  keys?: string;
  value?: string;
  direction?: 'up' | 'down';
  notches?: number;
  /** Pixel coordinate in the resized screenshot, not desktop coordinates. */
  x?: number;
  y?: number;
  pointerKind?: 'click' | 'right_click' | 'double_click';
  snapshot?: {
    path: string; scope?: 'desktop' | 'window'; title: string; processId: number; windowHandle: string;
    left: number; top: number; width: number; height: number;
    imageWidth: number; imageHeight: number; capturedAt: number;
  };
};

export function validateComputerStep(step: ComputerStep): void {
  if (!step || !['scroll_view','focus','invoke','set_value','keypress','scroll','move','click','right_click','double_click','type','drag','visual_click'].includes(step.kind)) throw new Error('Invalid computer action.');
  if (!step.expectedTitle || !Number.isSafeInteger(step.expectedProcessId) || step.expectedProcessId <= 0) throw new Error('Exact foreground window identity required.');
  if (step.kind === 'keypress') {
    if (!['^s','^o','^n','^f','^a','^c','^v','{ESC}','{ENTER}','{TAB}','+{TAB}','{UP}','{DOWN}','{LEFT}','{RIGHT}','{BACKSPACE}','{DELETE}','{HOME}','{END}'].includes(step.keys || '')) throw new Error('Unsupported keyboard shortcut.');
  } else if (step.kind === 'scroll_view') {
    if (!['up', 'down'].includes(step.direction || '') ||
        (step.notches != null && (!Number.isSafeInteger(step.notches) || step.notches < 1 || step.notches > 5))) {
      throw new Error('Viewport scroll requires direction up/down and optional 1-5 wheel notches.');
    }
  } else if (step.kind === 'visual_click') {
    if (!step.snapshot || typeof step.snapshot.path !== 'string' ||
        !/^skycode-window-[0-9a-f]{32}\.jpg$/.test(step.snapshot.path.split(/[\\/]/).pop() || '') ||
        step.snapshot.scope !== 'window' ||
        step.snapshot.title !== step.expectedTitle || step.snapshot.processId !== step.expectedProcessId ||
        !/^\d+$/.test(step.snapshot.windowHandle || '') ||
        typeof step.x !== 'number' || typeof step.y !== 'number' ||
        !Number.isSafeInteger(step.x) || !Number.isSafeInteger(step.y) ||
        !Number.isSafeInteger(step.snapshot.imageWidth) || !Number.isSafeInteger(step.snapshot.imageHeight) ||
        step.snapshot.imageWidth <= 0 || step.snapshot.imageHeight <= 0 ||
        step.x! < 0 || step.y! < 0 || step.x! >= step.snapshot.imageWidth || step.y! >= step.snapshot.imageHeight ||
        !['click','right_click','double_click'].includes(step.pointerKind || '')) {
      throw new Error('Visual click requires exact recent screenshot identity, image pixel coordinates and pointerKind.');
    }
  } else if (!step.name && !step.automationId) throw new Error('Specify an accessible control name or automationId.');
  if (step.kind === 'drag' && (!step.targetName && !step.targetAutomationId)) throw new Error('Drag requires an exact destination control name or automationId.');
  if (step.kind === 'drag' && step.name === step.targetName && step.name !== undefined && !step.automationId && !step.targetAutomationId) throw new Error('Drag source and destination must be different.');
  if (step.value != null && step.value.length > (step.kind === 'type' ? 1000 : 3000)) throw new Error('Text input too long.');
  if ((step.kind === 'type' || step.kind === 'set_value') && typeof step.value !== 'string') throw new Error('Text input value required.');
  if (step.kind === 'scroll' && !['up','down'].includes(step.direction || '')) throw new Error('Scroll direction must be up or down.');
}

export async function runComputerCore(action: 'observe' | 'list_windows' | 'act' | 'batch' | 'observe_window' | 'focus_window' | 'verify_text' | 'capture', steps: ComputerStep[] = [], selector?: ComputerWindowSelector, textVerification?: ComputerTextVerification, captureScope: 'desktop' | 'window' = 'desktop'): Promise<Record<string, unknown>> {
  if (process.platform !== 'win32') throw new Error('Windows only.');
  if (action === 'act' && steps.length !== 1) throw new Error('Act requires exactly one step.');
  if (action === 'batch' && (!steps.length || steps.length > 8)) throw new Error('Batch requires 1–8 steps.');
  for (const step of steps) validateComputerStep(step);
  if (action === 'observe_window' || action === 'focus_window') {
    if (!selector) throw new Error('A window selector is required.');
    validateComputerWindowSelector(selector);
  }
  if (action === 'verify_text') validateComputerTextVerification(textVerification as ComputerTextVerification);
  const script = resolve(import.meta.dir, '../../scripts/computer-core.ps1');
  if (!existsSync(script)) throw new Error('Computer adapter missing.');
  const request = action === 'act' ? { action, step: steps[0] } : { action, steps, selector, ...(action === 'verify_text' ? textVerification : {}), ...(action === 'capture' ? {scope: captureScope} : {}) };
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
