import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(
  resolve(import.meta.dir, '../components/input-bar.tsx'),
  'utf8'
);

describe('interactive model picker wiring', () => {
  it('loads the live model catalog and filters while typing /model', () => {
    expect(source).toContain('loadModelCatalog');
    expect(source).toContain("inputValue.trim() === '/model'");
    expect(source).toContain('filterModelPickerItems(modelPickerItems, modelQuery, 8)');
  });

  it('supports keyboard and mouse model switching', () => {
    expect(source).toContain("key.name === 'up'");
    expect(source).toContain("key.name === 'down'");
    expect(source).toContain("key.name === 'tab'");
    expect(source).toContain('submitSelectedModel()');
    expect(source).toContain("onCommand?.('/model ' + item.selector)");
  });

  it('keeps model rows compact and readable', () => {
    expect(source).toContain("'Models'");
    expect(source).toContain("'CURRENT'");
    expect(source).toContain("'LOCAL'");
    expect(source).toContain("'FREE'");
    expect(source).toContain("'PAID'");
    expect(source).toContain('Showing ');
  });
});
