import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const srcRoot = resolve(import.meta.dir, '..');

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) files.push(...walk(full));
    else if (full.endsWith('.tsx')) files.push(full);
  }
  return files;
}

describe('OpenTUI text safety', () => {
  it('does not nest <text> renderables inside other <text> renderables', () => {
    const offenders: string[] = [];

    for (const file of walk(srcRoot)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      let textDepth = 0;

      lines.forEach((line, index) => {
        const opens = [...line.matchAll(/<text\b[^>]*>/g)].length;
        const closes = [...line.matchAll(/<\/text>/g)].length;

        if (textDepth > 0 && opens > 0) {
          offenders.push(file + ':' + (index + 1));
        }

        textDepth += opens - closes;
      });
    }

    expect(offenders).toEqual([]);
  });
});
