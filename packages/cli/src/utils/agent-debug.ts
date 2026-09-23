import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const LOG_PATH = process.env.SKYCODE_DEBUG_LOG || join(homedir(), '.skycode', 'debug', 'agent-debug.jsonl');

function safe(value: unknown): unknown {
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  return value;
}

export function getAgentDebugLogPath(): string { return LOG_PATH; }

export function agentDebug(event: string, data: Record<string, unknown> = {}): void {
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    appendFileSync(LOG_PATH, JSON.stringify({
      ts: new Date().toISOString(),
      pid: process.pid,
      event,
      ...Object.fromEntries(Object.entries(data).map(([key, value]) => [key, safe(value)])),
    }) + '\n', 'utf8');
  } catch {
    // Diagnostics must never change agent behavior or make a task fail.
  }
}
