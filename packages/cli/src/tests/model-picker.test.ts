import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(
  resolve(import.meta.dir, '../components/input-bar.tsx'),
  'utf8'
);

describe('interactive model picker wiring', () => {
  it('opens the model picker only after /model is explicitly selected or submitted', () => {
    expect(source).toContain('const [modelPickerOpen, setModelPickerOpen] = useState(false)');
    expect(source).toContain("if (command.command === '/model')");
    expect(source).toContain("if (command === '/model')");
    expect(source).toContain('setModelPickerOpen(true)');
  });

  it('loads the live model catalog once the picker is open without a loading-state dependency loop', () => {
    expect(source).toContain('loadModelCatalog');
    expect(source).toContain('filterModelPickerItems(modelPickerItems, modelQuery, 8)');
    expect(source).toContain('[showModelPicker, modelCatalogLoaded, loadModelCatalog]');
    expect(source).not.toContain('[showModelPicker, modelCatalogLoaded, modelCatalogLoading, loadModelCatalog]');
  });

  it('supports keyboard and mouse model switching', () => {
    expect(source).toContain("key.name === 'up'");
    expect(source).toContain("key.name === 'down'");
    expect(source).toContain("key.name === 'tab'");
    expect(source).toContain('submitSelectedModel()');
    expect(source).toContain("onCommand?.('/model ' + item.selector)");
  });

  it('keeps model rows compact and readable', () => {
    expect(source).toContain('const MODEL_PICKER_ROWS = 5');
    expect(source).toContain('maxHeight={16}');
    expect(source).toContain('visibleModelRows');
    expect(source).toContain("'CURRENT'");
    expect(source).toContain("'LOCAL'");
    expect(source).toContain("'FREE'");
    expect(source).toContain("'PAID'");
    expect(source).toContain('Showing ');
  });

  it('keeps the picker closable by keyboard and mouse', () => {
    expect(source).toContain('const closeModelPicker = () =>');
    expect(source).toContain("if (key.name === 'escape')");
    expect(source).toContain('onMouseDown={closeModelPicker}');
  });

  it('lets arrow navigation move through the full filtered catalog, not just visible rows', () => {
    expect(source).toContain('Math.max(1, modelPickerItems.length)');
    expect(source).toContain('filteredModels.matches.length');
    expect(source).toContain('modelWindowStart');
  });
});
