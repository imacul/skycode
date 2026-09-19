import { describe, expect, it } from 'bun:test';
import {
  createModelPickerItems,
  filterModelPickerItems,
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

  it('builds neat searchable picker items and keeps the current model first', () => {
    const items = createModelPickerItems(
      [
        {
          provider: 'openrouter',
          free: false,
          local: false,
          model: {
            id: 'vendor/paid',
            name: 'Paid Coder',
            description: 'coding model',
            contextLength: 128000,
            pricing: { prompt: 0.000001, completion: 0.000003 },
          },
        },
        {
          provider: 'local',
          free: true,
          local: true,
          model: {
            id: 'local-qwen',
            name: 'Local Qwen',
            description: 'local coding model',
            contextLength: 8192,
          },
        },
      ],
      { provider: 'openrouter', model: 'vendor/paid' }
    );

    expect(items[0].current).toBe(true);
    expect(items[0].selector).toBe('openrouter:vendor/paid');
    expect(items[0].meta).toContain('OPENROUTER');
    expect(items[1].meta).toContain('LOCAL · FREE');
  });

  it('filters model picker results by multiple words and caps visible rows', () => {
    const items = createModelPickerItems([
      ...Array.from({ length: 10 }, (_, index) => ({
        provider: 'openrouter' as const,
        free: true,
        local: false,
        model: {
          id: 'qwen/model-' + index + ':free',
          name: 'Qwen Coder ' + index,
          description: 'coding model',
          contextLength: 32000,
          pricing: { prompt: 0, completion: 0 },
        },
      })),
      {
        provider: 'openrouter' as const,
        free: false,
        local: false,
        model: {
          id: 'other/model',
          name: 'Other',
          description: 'general',
          contextLength: 32000,
          pricing: { prompt: 0.000001, completion: 0.000001 },
        },
      },
    ]);

    const result = filterModelPickerItems(items, 'qwen free', 8);
    expect(result.total).toBe(10);
    expect(result.matches).toHaveLength(8);
    expect(result.matches.every((item) => item.free)).toBe(true);
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
