export interface SseExtraction {
  events: string[];
  rest: string;
}

export function extractSseEvents(input: string, flush = false): SseExtraction {
  const normalized = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const events: string[] = [];
  let rest = normalized;

  while (true) {
    const boundary = rest.indexOf('\n\n');
    if (boundary < 0) break;

    const event = rest.slice(0, boundary);
    rest = rest.slice(boundary + 2);

    if (event.trim()) events.push(event);
  }

  if (flush && rest.trim()) {
    events.push(rest);
    rest = '';
  }

  return { events, rest };
}

export function getSseData(event: string): string | null {
  const dataLines = event
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart());

  if (dataLines.length === 0) return null;
  return dataLines.join('\n').trim();
}
