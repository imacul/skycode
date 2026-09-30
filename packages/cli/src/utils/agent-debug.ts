import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { redactSensitive } from '../security/redaction';

const LOG_PATH = process.env.SKYCODE_DEBUG_LOG || join(homedir(), '.skycode', 'debug', 'agent-debug.jsonl');

export function getAgentDebugLogPath(): string { return LOG_PATH; }

export function agentDebug(event: string, data: Record<string, unknown> = {}): void {
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    appendFileSync(LOG_PATH, JSON.stringify({
      ts: new Date().toISOString(),
      pid: process.pid,
      event,
      ...redactSensitive(data) as Record<string, unknown>,
    }) + '\n', 'utf8');
  } catch {
    // Diagnostics must never change agent behavior or make a task fail.
  }
}
