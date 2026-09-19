import type { ModelInfo } from '../providers/base';

export interface CatalogModel {
  provider: 'openrouter' | 'local';
  model: ModelInfo;
  free: boolean;
  local: boolean;
}

export function isFreeOpenRouterModel(model: ModelInfo): boolean {
  const prompt = Number(model.pricing?.prompt ?? 0);
  const completion = Number(model.pricing?.completion ?? 0);
  return model.id.endsWith(':free') || (prompt === 0 && completion === 0);
}

export function formatPricePerMillion(value: number | undefined): string {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return '$0/M';
  return '$' + (numeric * 1_000_000).toLocaleString(undefined, {
    maximumFractionDigits: 4,
  }) + '/M';
}

export function formatCatalogLine(entry: CatalogModel, current?: {
  provider: string;
  model: string;
}): string {
  const context = entry.model.contextLength
    ? ' [' + Math.round(entry.model.contextLength / 1000) + 'K ctx]'
    : '';
  const selected =
    current?.provider === entry.provider && current?.model === entry.model.id
      ? '  ← current'
      : '';

  if (entry.local) {
    return (
      '  local:' +
      entry.model.id +
      '  [LOCAL · FREE]' +
      context +
      selected
    );
  }

  const price = entry.free
    ? '[FREE]'
    : '[PAID · ' +
      formatPricePerMillion(entry.model.pricing?.prompt) +
      ' in · ' +
      formatPricePerMillion(entry.model.pricing?.completion) +
      ' out]';

  return (
    '  openrouter:' +
    entry.model.id +
    '  ' +
    price +
    context +
    selected
  );
}


export interface ModelPickerItem {
  key: string;
  selector: string;
  providerLabel: string;
  name: string;
  meta: string;
  searchText: string;
  current: boolean;
  free: boolean;
  local: boolean;
}

export function createModelPickerItems(
  entries: CatalogModel[],
  current?: { provider: string; model: string }
): ModelPickerItem[] {
  return entries
    .map((entry) => {
      const selector = entry.provider + ':' + entry.model.id;
      const currentMatch =
        current?.provider === entry.provider && current?.model === entry.model.id;
      const context = entry.model.contextLength
        ? Math.round(entry.model.contextLength / 1000) + 'K ctx'
        : 'context unknown';

      const cost = entry.local
        ? 'LOCAL · FREE'
        : entry.free
          ? 'FREE'
          : formatPricePerMillion(entry.model.pricing?.prompt) +
            ' in · ' +
            formatPricePerMillion(entry.model.pricing?.completion) +
            ' out';

      const providerLabel = entry.local ? 'LOCAL' : 'OPENROUTER';
      const name = entry.model.name || entry.model.id;
      const meta = providerLabel + ' · ' + cost + ' · ' + context;

      return {
        key: selector,
        selector,
        providerLabel,
        name,
        meta,
        searchText: [
          selector,
          entry.model.id,
          entry.model.name,
          entry.model.description,
          ...(entry.model.tags || []),
          entry.provider,
          entry.free ? 'free' : 'paid',
          entry.local ? 'local' : '',
        ]
          .join(' ')
          .toLowerCase(),
        current: !!currentMatch,
        free: entry.free,
        local: entry.local,
      };
    })
    .sort((a, b) => {
      if (a.current !== b.current) return a.current ? -1 : 1;
      if (a.local !== b.local) return a.local ? -1 : 1;
      if (a.free !== b.free) return a.free ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export function filterModelPickerItems(
  items: ModelPickerItem[],
  query: string,
  limit = 12
): { matches: ModelPickerItem[]; total: number } {
  const clean = query.trim().toLowerCase();
  const words = clean.split(/\s+/).filter(Boolean);

  const filtered = words.length === 0
    ? items
    : items.filter((item) =>
        words.every((word) => item.searchText.includes(word))
      );

  return {
    matches: filtered.slice(0, limit),
    total: filtered.length,
  };
}
