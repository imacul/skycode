import { describe, expect, test } from 'bun:test';
import { getBuildVerificationStatus, type ProjectToolExecution } from '../agents/project-tools';
const event = (name: ProjectToolExecution['call']['name'], success = true, command?: string): ProjectToolExecution => ({
  call: { name, args: command ? { command } : {} }, success, content: success ? 'ok' : 'failed'
});

describe('outcome-driven engineering verification', () => {
  test('a new code write invalidates older green checks', () => {
    const status = getBuildVerificationStatus([
      event('run_command', true, 'bun test'),
      event('write_file'),
    ]);
    expect(status.codeChanged).toBe(true);
    expect(status.checkPassed).toBe(false);
    expect(status.checkAttempted).toBe(false);
  });
  test('a successful development check after the last change verifies the build', () => {
    const status = getBuildVerificationStatus([
      event('write_file'),
      event('run_command', true, 'bun test packages/cli/src/tests/workflow.test.ts'),
    ]);
    expect(status.checkPassed).toBe(true);
    expect(status.lastCheck).toContain('bun test');
  });
  test('file listing, shell metadata, and process startup are not verification', () => {
    const status = getBuildVerificationStatus([
      event('create_directory'),
      event('run_command', true, 'git status'),
      event('start_process'),
      event('computer_screenshot'),
    ]);
    expect(status.codeChanged).toBe(true);
    expect(status.checkPassed).toBe(false);
  });
  test('a passing typecheck cannot conceal an earlier failing test after the same change', () => {
    const status = getBuildVerificationStatus([
      event('write_file'),
      event('run_command', false, 'bun test'),
      event('run_command', true, 'npx tsc --noEmit'),
    ]);
    expect(status.checkFailed).toBe(true);
    expect(status.checkPassed).toBe(false);
  });
  test('repair followed by a passing test clears earlier failure', () => {
    const status = getBuildVerificationStatus([
      event('write_file'),
      event('run_command', false, 'bun test'),
      event('write_file'),
      event('run_command', true, 'bun test'),
    ]);
    expect(status.checkFailed).toBe(false);
    expect(status.checkPassed).toBe(true);
  });
  test('irrelevant commands do not count as successful checks', () => {
    for (const command of ['echo test', 'git status', 'bun --version', 'npm install', 'npm start']) {
      expect(getBuildVerificationStatus([event('write_file'), event('run_command', true, command)]).checkPassed).toBe(false);
    }
  });
});
