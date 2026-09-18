import { describe, expect, it } from 'bun:test';
import {
  formatCatalogLine,
  formatPricePerMillion,
  isFreeOpenRouterModel,
} from '../utils/model-catalog';

describe('unified model catalog', () => {
  it('labels zero-priced OpenRouter models as free', () => {
    expect(
      isFreeOpenRouterModel({
        id: 'vendor/model:free',
        name: 'Free Model',
        description: '',
        contextLength: 128000,
        pricing: { prompt: 0, completion: 0 },
      })
    ).toBe(true);
  });

  it('labels priced OpenRouter models as paid', () => {
    expect(
      isFreeOpenRouterModel({
        id: 'vendor/model',
        name: 'Paid Model',
        description: '',
        contextLength: 128000,
        pricing: { prompt: 0.000001, completion: 0.000003 },
      })
    ).toBe(false);
  });

  it('formats per-token prices as per-million-token prices', () => {
    expect(formatPricePerMillion(0.000001)).toBe('$1/M');
    expect(formatPricePerMillion(0.000003)).toBe('$3/M');
  });

  it('shows provider selectors and local/free labels', () => {
    const openRouterLine = formatCatalogLine({
      provider: 'openrouter',
      free: false,
      local: false,
      model: {
        id: 'vendor/model',
        name: 'Model',
        description: '',
        contextLength: 128000,
        pricing: { prompt: 0.000001, completion: 0.000003 },
      },
    });

    const localLine = formatCatalogLine({
      provider: 'local',
      free: true,
      local: true,
      model: {
        id: 'local-qwen',
        name: 'Local Qwen',
        description: '',
        contextLength: 2048,
      },
    });

    expect(openRouterLine).toContain('openrouter:vendor/model');
    expect(openRouterLine).toContain('[PAID');
    expect(localLine).toContain('local:local-qwen');
    expect(localLine).toContain('[LOCAL · FREE]');
  });
});
