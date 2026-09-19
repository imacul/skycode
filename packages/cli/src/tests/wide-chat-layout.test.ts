import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(import.meta.dir, '../index.tsx'), 'utf8');

describe('wide chat layout', () => {
  it('uses nearly the full terminal width for chat surfaces', () => {
    expect(source).toContain('width="96%"');
    expect(source).not.toContain('maxWidth={78}');
  });

  it('keeps the transcript and input bar aligned to the same wide layout', () => {
    expect(source).toContain('<scrollbox\n        ref={messagesScrollRef}\n        width="96%"');
    expect(source).toContain('{/* Input bar */}\n      <box width="96%"');
    expect(source).toContain('key={msg.id}\n              width="100%"');
    expect(source).toContain('isProcessing && currentResponse && (\n          <box width="100%"');
  });

  it('has no remaining fixed 78-column caps in the main app layout', () => {
    expect(source.match(/maxWidth=\{78\}/g) || []).toHaveLength(0);
  });
});
