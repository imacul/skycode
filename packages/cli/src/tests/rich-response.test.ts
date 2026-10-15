import { describe, expect, it } from 'bun:test';
import {
  parseRichResponse,
  tokenizeCodeLine,
} from '../components/response-content';

describe('rich response rendering', () => {
  it('parses headings, lists, quotes, code, and writing blocks', () => {
    const blocks = parseRichResponse([
      '# Title',
      '',
      '- first',
      '1. second',
      '> note',
      '',
      '~~~ignored',
      '',
      '~~~',
      '',
      '```typescript',
      'const answer: number = 42;',
      '```',
      '',
      '```writing',
      'Hello there',
      '```',
    ].join('\n'));

    expect(blocks.some((block) => block.type === 'heading')).toBe(true);
    expect(blocks.some((block) => block.type === 'bullet' && !block.ordered)).toBe(true);
    expect(blocks.some((block) => block.type === 'bullet' && block.ordered)).toBe(true);
    expect(blocks.some((block) => block.type === 'quote')).toBe(true);
    expect(blocks.some((block) => block.type === 'code' && block.language === 'typescript')).toBe(true);
    expect(blocks.some((block) => block.type === 'writing')).toBe(true);
  });

  it('recognizes common syntax token classes', () => {
    const tokens = tokenizeCodeLine(
      'const user: string = "SkyCode"; // hello',
      'typescript'
    );

    expect(tokens.some((token) => token.text === 'const' && token.kind === 'keyword')).toBe(true);
    expect(tokens.some((token) => token.text === 'string' && token.kind === 'type')).toBe(true);
    expect(tokens.some((token) => token.text === '"SkyCode"' && token.kind === 'string')).toBe(true);
  });

  it('treats whole-line comments as comments for multiple language families', () => {
    expect(tokenizeCodeLine('# python comment', 'python')[0].kind).toBe('comment');
    expect(tokenizeCodeLine('// ts comment', 'typescript')[0].kind).toBe('comment');
    expect(tokenizeCodeLine('-- sql comment', 'sql')[0].kind).toBe('comment');
  });

  it('keeps unfinished streaming code fences renderable', () => {
    const blocks = parseRichResponse('```python\nprint("hello")');
    expect(blocks).toEqual([
      {
        type: 'code',
        language: 'python',
        code: 'print("hello")',
      },
    ]);
  });
});


describe('rich inline text and terminal charts', () => {
  it('turns bold, italic, code, and safe web links into styled spans', async () => {
    const { parseInlineMarkdown } = await import('../utils/rich-format');
    const tokens = parseInlineMarkdown('**Build features** with *care*, `bun test`, and [Docs](https://example.com).');
    expect(tokens.some(token => token.type === 'bold' && token.text === 'Build features')).toBe(true);
    expect(tokens.some(token => token.type === 'italic' && token.text === 'care')).toBe(true);
    expect(tokens.some(token => token.type === 'code' && token.text === 'bun test')).toBe(true);
    expect(tokens.some(token => token.type === 'link' && token.url === 'https://example.com')).toBe(true);
  });

  it('parses a bounded chart from a chart fence', () => {
    const blocks = parseRichResponse([
      '```chart',
      JSON.stringify({ type: 'bar', title: 'Builds', unit: 'jobs', data: [
        { label: 'Passed', value: 319 }, { label: 'Failed', value: 18 },
      ] }),
      '```',
    ].join('\n'));
    const block = blocks.find(block => block.type === 'chart');
    expect(block?.type).toBe('chart');
    if (block?.type === 'chart') expect(block.chart.data[0].value).toBe(319);
  });

  it('does not interpret invalid chart data as executable content', async () => {
    const { parseTerminalChart } = await import('../utils/rich-format');
    expect(parseTerminalChart(JSON.stringify({ type: 'bar', data: [{ label: 'Nope', value: '1' }] }))).toBeNull();
    expect(parseTerminalChart(JSON.stringify({ type: 'bar', data: [{ label: 'Nope', value: -1 }] }))).toBeNull();
  });
});
