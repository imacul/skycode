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
