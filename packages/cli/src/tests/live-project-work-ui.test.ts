import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const appSource = readFileSync(resolve(import.meta.dir, '../index.tsx'), 'utf8');
const workSource = readFileSync(
  resolve(import.meta.dir, '../components/work-activity-view.tsx'),
  'utf8'
);

describe('live project work UI', () => {
  it('wires structured agent activities into the chat UI', () => {
    expect(appSource).toContain('const [workActivities, setWorkActivities]');
    expect(appSource).toContain('onActivity: (activity) =>');
    expect(appSource).toContain('<WorkActivityView activities={workActivities} />');
  });

  it('keeps a bounded Codex-style work panel with diff metadata', () => {
    expect(workSource).toContain("backgroundColor="#0D1117"");
    expect(workSource).toContain("maxHeight={18}");
    expect(workSource).toContain("'  +' + String(activity.additions || 0)");
    expect(workSource).toContain("line.startsWith('+ ')");
    expect(workSource).toContain("line.startsWith('- ')");
  });

  it('shows Thinking only before structured work has started', () => {
    expect(appSource).toContain(
      'isProcessing && !currentResponse && workActivities.length === 0'
    );
  });
});
