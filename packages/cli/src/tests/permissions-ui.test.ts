import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const appSource = readFileSync(resolve(import.meta.dir, '../index.tsx'), 'utf8');
const promptSource = readFileSync(
  resolve(import.meta.dir, '../components/approval-prompt.tsx'),
  'utf8'
);
const settingsSource = readFileSync(
  resolve(import.meta.dir, '../store/settings.ts'),
  'utf8'
);

describe('interactive permission approval UI', () => {
  it('offers allow-once, session, always, and deny decisions', () => {
    expect(promptSource).toContain("[1] Allow once");
    expect(promptSource).toContain("[2] Allow session");
    expect(promptSource).toContain("[3] Always allow");
    expect(promptSource).toContain("[4] Deny");
  });

  it('wires pending approvals into agent requests and the chat UI', () => {
    expect(appSource).toContain('const [pendingApproval, setPendingApproval]');
    expect(appSource).toContain('onApproval: requestAgentApproval');
    expect(appSource).toContain('<ApprovalPrompt');
    expect(appSource).toContain("approvalKeys");
  });

  it('persists always-allow families and keeps session approvals in memory', () => {
    expect(settingsSource).toContain('permissions: PermissionSettings');
    expect(settingsSource).toContain('alwaysAllow: []');
    expect(appSource).toContain('sessionPermissionKeysRef');
    expect(appSource).toContain('updatePermissionSettings');
  });

  it('supports permission inspection and reset commands', () => {
    expect(appSource).toContain("command === '/permissions'");
    expect(appSource).toContain("command === '/permissions reset'");
  });
});
