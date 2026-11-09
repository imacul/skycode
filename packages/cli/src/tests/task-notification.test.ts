import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyTaskNotice, taskNoticeText } from '../utils/task-notification';
import { summarizeToolProvenance, type ProjectToolExecution } from '../agents/project-tools';

const tool = (name: ProjectToolExecution['call']['name'], success = true, args: Record<string, unknown> = {}): ProjectToolExecution => ({
  call: { name, args }, success, content: success ? 'ok' : 'failed'
});

describe('SkyCode task completion notifications', () => {
  test('does not claim successful outcome just because the assistant responded', () => {
    expect(classifyTaskNotice('stop', 'completed')).toBe('ready');
    expect(taskNoticeText('ready').title).toBe('SkyCode response ready');
    expect(taskNoticeText('ready').message).toContain('Review the result');
  });
  test('stalled, blocked and failed runs are not reported as completed tasks', () => {
    expect(classifyTaskNotice('desktop_progress_limit', 'failed')).toBe('failed');
    expect(classifyTaskNotice('tool_iteration_limit', 'running')).toBe('failed');
    expect(classifyTaskNotice('clarification_required', 'blocked')).toBe('blocked');
    expect(taskNoticeText('failed').title).toContain('needs attention');
  });
  test('CLI announces completed responses and errors but not cancellation', () => {
    const ui = readFileSync(resolve(import.meta.dir, '../index.tsx'), 'utf8');
    expect(ui).toContain('notifyTaskFinished(classifyTaskNotice(taskFinishReason, taskState))');
    expect(ui).toContain("if (!wasCancelled) notifyTaskFinished('failed')");
    expect(ui).toContain('desktop_progress_limit|tool_action_budget|repeated_tool_failure');
  });
});

describe('Evidence provenance from actual tool calls', () => {
  test('directory listing without scrolling reports that no scrolling happened', () => {
    const method = summarizeToolProvenance([
      tool('run_command'),
      tool('computer_observe'),
    ]);
    expect(method).toContain('terminal commands');
    expect(method).toContain('Windows accessibility/window inspection');
    expect(method).toContain('Scroll operations sent: 0');
  });
  test('counts sent scroll actions without claiming that viewport moved', () => {
    const method = summarizeToolProvenance([
      tool('computer_act', true, { step: { kind: 'scroll_view', direction: 'down' } }),
      tool('computer_act', false, { step: { kind: 'scroll_view', direction: 'down' } }),
      tool('computer_screenshot'),
    ]);
    expect(method).toContain('Scroll operations sent: 1');
    expect(method).toContain('attempted in failed actions: 1');
    expect(method).toContain('does not prove the viewport moved');
  });
  test('does not invent a method from failed actions', () => {
    const method = summarizeToolProvenance([tool('run_command', false)]);
    expect(method).not.toContain('terminal commands');
    expect(method).toBe('');
  });
});
