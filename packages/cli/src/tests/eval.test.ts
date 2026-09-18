import { describe, expect, it } from 'bun:test';
import { EVAL_CASES, SMOKE_CASES } from '../eval/cases';

describe('AI eval suite', () => {
  it('contains exactly 100 uniquely numbered cases', () => {
    expect(EVAL_CASES).toHaveLength(100);
    expect(new Set(EVAL_CASES.map((item) => item.id)).size).toBe(100);
    expect(EVAL_CASES[0].id).toBe(1);
    expect(EVAL_CASES.at(-1)?.id).toBe(100);
  });

  it('has a non-empty smoke suite', () => {
    expect(SMOKE_CASES.length).toBeGreaterThan(0);
    expect(SMOKE_CASES.length).toBeLessThan(100);
  });

  it('covers all major audit categories', () => {
    const categories = new Set(EVAL_CASES.map((item) => item.category));
    expect(categories).toEqual(new Set([
      'identity',
      'instruction',
      'memory',
      'reasoning',
      'coding',
      'routing',
      'streaming-ui',
    ]));
  });
});
