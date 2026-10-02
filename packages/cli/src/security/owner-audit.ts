import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { redactSensitiveText } from './redaction';
import type { OwnershipSettings } from './ownership';
import { isOwnerMode } from './ownership';

export function ownerAuditPath(): string {
  return (
    process.env.SKYCODE_OWNER_AUDIT_PATH ||
    join(homedir(), '.skycode', 'audit', 'owner-actions.jsonl')
  );
}

export function recordOwnerAction(
  ownership: Partial<OwnershipSettings> | null | undefined,
  event: {
    action: string;
    detail?: string;
    workspace?: string;
    permissionKey?: string;
    success?: boolean;
  }
): void {
  if (!isOwnerMode(ownership)) return;

  try {
    const path = ownerAuditPath();
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    if (!existsSync(dirname(path))) return;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      action: event.action,
      detail: event.detail ? redactSensitiveText(event.detail).slice(0, 2000) : undefined,
      workspace: event.workspace,
      permissionKey: event.permissionKey,
      success: event.success,
    });
    appendFileSync(path, line + '\n', { encoding: 'utf8', mode: 0o600 });
  } catch {
    // Audit must never block the tool path.
  }
}
