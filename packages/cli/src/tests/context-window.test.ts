import { describe, expect, it } from 'bun:test';
import {
  createContextBudget,
  estimateTextTokens,
  fitHistoryToBudget,
} from '../utils/context-window';
import type { Message } from '../store/conversation';

function message(id: string, content: string): Message {
  return {
    id,
    role: 'user',
    content,
    timestamp: new Date(),
  };
}

describe('context window utilities', () => {
  it('creates a conservative budget for a 2048-token runtime', () => {
    const budget = createContextBudget(2048, 'hello');

    expect(budget.contextWindow).toBe(2048);
    expect(budget.responseReserve).toBeGreaterThanOrEqual(384);
    expect(budget.systemReserve).toBeGreaterThanOrEqual(384);
    expect(budget.historyBudget).toBeGreaterThan(0);
    expect(
      budget.responseReserve +
        budget.systemReserve +
        budget.currentInputTokens +
        budget.historyBudget
    ).toBeLessThanOrEqual(2048);
  });

  it('keeps newest messages when history exceeds the budget', () => {
    const messages = [
      message('1', 'a'.repeat(400)),
      message('2', 'b'.repeat(400)),
      message('3', 'c'.repeat(400)),
    ];

    const result = fitHistoryToBudget(messages, 220);

    expect(result.messages.length).toBeLessThan(messages.length);
    expect(result.messages.at(-1)?.id).toBe('3');
    expect(result.droppedCount).toBeGreaterThan(0);
  });

  it('always keeps the newest turn even when it alone exceeds the history budget', () => {
    const messages = [message('1', 'x'.repeat(5000))];
    const result = fitHistoryToBudget(messages, 100);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].id).toBe('1');
  });

  it('estimates empty text as zero tokens', () => {
    expect(estimateTextTokens('')).toBe(0);
  });
});
