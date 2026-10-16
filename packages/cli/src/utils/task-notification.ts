import { spawn } from 'node:child_process';

export type TaskNotice = 'ready' | 'blocked' | 'failed';

/**
 * This signals that an agent turn finished, not that its requested real-world
 * outcome has been independently verified.
 */
export function classifyTaskNotice(finishReason: string, taskState?: string): TaskNotice {
  if (taskState === 'failed' || /(?:limit|budget|failure|error|failed|provider_stopped|tool_protocol_not_followed|web_evidence_required|desktop_progress_limit)/i.test(finishReason)) {
    return 'failed';
  }
  if (taskState === 'blocked' || /clarification_required|blocked|approval_denied/i.test(finishReason)) {
    return 'blocked';
  }
  return 'ready';
}

export function taskNoticeText(status: TaskNotice): { title: string; message: string } {
  if (status === 'failed') return { title: 'SkyCode needs attention', message: 'The task stopped before completion. Check the response.' };
  if (status === 'blocked') return { title: 'SkyCode is waiting for you', message: 'The task needs clarification or approval.' };
  return { title: 'SkyCode response ready', message: 'The assistant has finished responding. Review the result.' };
}

/** OS notification independent of TUI focus; the child is detached and nonblocking. */
export function notifyTaskFinished(status: TaskNotice): void {
  if (process.platform !== 'win32') {
    // A terminal bell is a useful fallback for other interactive terminals.
    if (process.stdout.isTTY) process.stdout.write('\x07');
    return;
  }
  const info = taskNoticeText(status);
  // Only trusted fixed text is interpolated; never pass the model's content
  // into a PowerShell command.
  const title = info.title.replace(/'/g, "''");
  const message = info.message.replace(/'/g, "''");
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$n = [System.Windows.Forms.NotifyIcon]::new()',
    '$n.Icon = [System.Drawing.SystemIcons]::Information',
    '$n.Visible = $true',
    "$n.BalloonTipTitle = '" + title + "'",
    "$n.BalloonTipText = '" + message + "'",
    '$n.ShowBalloonTip(6000)',
    'Start-Sleep -Seconds 7',
    '$n.Dispose()',
  ].join('; ');
  try {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const child = spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', encoded],
      { detached: true, windowsHide: true, stdio: 'ignore' });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    // A notification failure must never fail the user's task.
  }
}
