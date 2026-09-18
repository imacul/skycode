import { describe, expect, it } from 'bun:test';
import { extractSseEvents, getSseData } from '../utils/sse';

describe('SSE parsing', () => {
  it('parses CRLF-separated events', () => {
    const result = extractSseEvents(
      'data: {"choices":[]}\r\n\r\ndata: [DONE]\r\n\r\n'
    );

    expect(result.events).toHaveLength(2);
    expect(getSseData(result.events[0])).toBe('{"choices":[]}');
    expect(getSseData(result.events[1])).toBe('[DONE]');
    expect(result.rest).toBe('');
  });

  it('keeps an incomplete event buffered', () => {
    const result = extractSseEvents('data: {"a":1}');
    expect(result.events).toHaveLength(0);
    expect(result.rest).toBe('data: {"a":1}');
  });

  it('flushes the final event without a trailing blank line', () => {
    const result = extractSseEvents('data: [DONE]', true);
    expect(result.events).toEqual(['data: [DONE]']);
    expect(result.rest).toBe('');
  });

  it('joins multi-line data fields', () => {
    expect(getSseData('event: message\ndata: hello\ndata: world')).toBe('hello\nworld');
  });
});
