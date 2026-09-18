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
