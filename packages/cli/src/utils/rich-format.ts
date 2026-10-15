// Terminal-safe rich content helpers. No HTML rendering or executable expressions.
export type InlineToken = { type: 'text' | 'bold' | 'italic' | 'code' | 'link'; text: string; url?: string };

export function parseInlineMarkdown(input: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const pattern = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|`([^`\n]+)`|(?<!\*)\*([^*\n]+)\*(?!\*)|(?<!_)_([^_\n]+)_(?!_)/g;
  let last = 0, match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    if (match.index > last) tokens.push({ type: 'text', text: input.slice(last, match.index) });
    if (match[1] && match[2]) tokens.push({ type: 'link', text: match[1], url: match[2] });
    else if (match[3] || match[4]) tokens.push({ type: 'bold', text: match[3] || match[4] });
    else if (match[5]) tokens.push({ type: 'code', text: match[5] });
    else if (match[6] || match[7]) tokens.push({ type: 'italic', text: match[6] || match[7] });
    last = match.index + match[0].length;
  }
  if (last < input.length) tokens.push({ type: 'text', text: input.slice(last) });
  if (!tokens.length) tokens.push({ type: 'text', text: input });
  return tokens;
}

export type ChartDatum = { label: string; value: number };
export type TerminalChart = { title: string; unit: string; data: ChartDatum[] };

export function parseTerminalChart(source: string): TerminalChart | null {
  if (source.length > 12000) return null;
  try {
    const candidate: unknown = JSON.parse(source);
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const chart = candidate as Record<string, unknown>;
    if (chart.type !== 'bar' || !Array.isArray(chart.data) ||
        chart.data.length < 1 || chart.data.length > 16) return null;
    const data: ChartDatum[] = [];
    for (const entry of chart.data) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const { label, value } = entry as Record<string, unknown>;
      if (typeof label !== 'string' || !label.trim() || label.length > 48 ||
          typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e12) return null;
      data.push({ label: label.trim(), value });
    }
    if (chart.title != null && (typeof chart.title !== 'string' || chart.title.length > 120)) return null;
    if (chart.unit != null && (typeof chart.unit !== 'string' || chart.unit.length > 24)) return null;
    return { title: String(chart.title || 'Chart'), unit: String(chart.unit || ''), data };
  } catch { return null; }
}

export function renderBarLines(chart: TerminalChart, width = 30): string[] {
  const max = Math.max(...chart.data.map(row => row.value), 1);
  const usable = Math.max(4, Math.min(50, Math.floor(width)));
  const labelWidth = Math.min(20, Math.max(...chart.data.map(row => row.label.length)));
  return chart.data.map(row => {
    const label = row.label.length > labelWidth ? row.label.slice(0, labelWidth - 1) + '…' : row.label;
    const filled = Math.round((row.value / max) * usable);
    return label.padEnd(labelWidth) + '  ' + '█'.repeat(filled) + '░'.repeat(usable - filled) +
      '  ' + row.value.toLocaleString('en-US') + (chart.unit ? ' ' + chart.unit : '');
  });
}
