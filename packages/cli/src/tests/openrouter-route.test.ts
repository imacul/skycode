import { describe, expect, it } from 'bun:test';
import {
  accountCanUsePaidModels,
  chooseOpenRouterModel,
  failureIsRateLimit,
  failureNeedsLongerContext,
  formatCreditsGuide,
  parseOpenRouterKey,
} from '../utils/openrouter-route';

const models = [
  { id: 'inclusionai/ling:free', contextLength: 262144, promptPrice: 0, completionPrice: 0 },
  { id: 'other/free-coder:free', contextLength: 128000, promptPrice: 0, completionPrice: 0 },
  { id: 'cheap/chat', contextLength: 8192, promptPrice: 0.0000001, completionPrice: 0.0000002 },
  { id: 'qwen/qwen-coder', contextLength: 128000, promptPrice: 0.0000003, completionPrice: 0.0000006 },
  { id: 'other/long-context', contextLength: 1000000, promptPrice: 0.000002, completionPrice: 0.000004 },
];

describe('OpenRouter model routing', () => {
  it('prefers a free replacement even when a paid model is affordable', () => {
    const choice = chooseOpenRouterModel({
      currentId: 'qwen/qwen-coder',
      models,
      allowPaid: true,
      minimumContext: 64000,
    });
    expect(choice?.id).toBe('other/free-coder:free');
    expect(choice?.paid).toBe(false);
  });

  it('uses another free model before spending credits', () => {
    const choice = chooseOpenRouterModel({
      currentId: 'inclusionai/ling:free',
      models,
      allowPaid: true,
      minimumContext: 64000,
    });
    expect(choice?.id).toBe('other/free-coder:free');
    expect(choice?.paid).toBe(false);
  });

  it('does not spend money when the account has no paid credits', () => {
    expect(
      chooseOpenRouterModel({
        currentId: 'inclusionai/ling:free',
        models: models.filter((model) => model.promptPrice > 0 || model.id === 'inclusionai/ling:free'),
        allowPaid: false,
        minimumContext: 64000,
      })
    ).toBeNull();
  });

  it('uses a paid model only after no free model can hold the context', () => {
    const needed = failureNeedsLongerContext(
      'The input is longer than the model\'s context length (262144 tokens).'
    );
    expect(needed).toBe(262145);
    const choice = chooseOpenRouterModel({
      currentId: 'inclusionai/ling:free',
      models,
      allowPaid: true,
      minimumContext: needed || 0,
    });
    expect(choice?.id).toBe('other/long-context');
    expect(choice?.paid).toBe(true);
  });

  it('recognizes a rate limit and a purchased account', () => {
    expect(failureIsRateLimit('Rate limit exceeded')).toBe(true);
    expect(accountCanUsePaidModels({
      limitRemaining: null,
      usage: 0,
      usageDaily: 0,
      freeRequestsRemaining: 900,
      freeRequestsLimit: 1000,
    })).toBe(true);
    expect(accountCanUsePaidModels({
      limitRemaining: null,
      usage: 0,
      usageDaily: 0,
      freeRequestsRemaining: 10,
      freeRequestsLimit: 50,
    })).toBe(false);
  });

  it('explains the single OpenRouter balance', () => {
    const status = parseOpenRouterKey({
      data: {
        limit_remaining: 12.5,
        usage: 4,
        usage_daily: 0.2,
        free_tier: { requests_remaining: 40, requests_limit: 50 },
      },
    });
    const text = formatCreditsGuide(status);
    expect(text).toContain('One OpenRouter balance');
    expect(text).toContain('$12.50');
    expect(text).toContain('https://openrouter.ai/settings/credits');
    expect(text).toContain('Auto Top-Up');
  });
});
