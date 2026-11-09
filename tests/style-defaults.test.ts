import { describe, expect, it } from 'vitest';
import { toolStyle } from '../src/app/model';
import { loadMarkupStyleDefaults, MARKUP_STYLE_DEFAULTS_KEY, saveMarkupStyleDefaults } from '../src/app/styleDefaults';
import { COMMENT_SIZE_KEY, loadCommentSize, saveCommentSize } from '../src/core/commentSize';

function memoryStore() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}

describe('remembered markup defaults', () => {
  it('uses the last validated color, width and opacity for new markup tools across reloads', () => {
    const storage = memoryStore();
    expect(loadMarkupStyleDefaults(storage)).toEqual({});
    saveMarkupStyleDefaults({ color: '#334455', width: 7, opacity: 0.65 }, storage);
    expect(storage.getItem(MARKUP_STYLE_DEFAULTS_KEY)).toContain('"width":7');
    const loaded = loadMarkupStyleDefaults(storage);
    for (const type of ['line', 'highlight', 'rect', 'cloud', 'arrow', 'polyline', 'stamp'] as const) {
      const style = toolStyle(type, undefined, loaded);
      expect(style.color).toBe('#334455');
      expect(style.width).toBe(7);
      expect(style.opacity).toBe(0.65);
    }
    expect(toolStyle('highlight', { width: 2, color: '#ffeb3b' }, loaded).color).toBe('#334455');
  });

  it('clamps bad numeric values, ignores invalid colors and recovers corrupt storage', () => {
    const storage = memoryStore();
    saveMarkupStyleDefaults({ color: '#bad', width: 99, opacity: -3 }, storage);
    expect(loadMarkupStyleDefaults(storage)).toEqual({ width: 12, opacity: 0.1 });
    storage.setItem(MARKUP_STYLE_DEFAULTS_KEY, '{bad');
    expect(loadMarkupStyleDefaults(storage)).toEqual({});
  });

  it('persists and clamps the default comment text size', () => {
    const storage = memoryStore();
    saveCommentSize(14, storage);
    expect(storage.getItem(COMMENT_SIZE_KEY)).toBe('14');
    expect(loadCommentSize(storage)).toBe(14);
    saveCommentSize(100, storage);
    expect(loadCommentSize(storage)).toBe(18);
  });
});
