import { describe, expect, it } from 'vitest';
import { THEME_KEY, loadTheme, parseTheme, saveTheme } from '../src/app/theme';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe('theme preference', () => {
  it('defaults to dark and rejects unknown values', () => {
    expect(loadTheme(memory())).toBe('dark');
    expect(loadTheme(null)).toBe('dark');
    expect(parseTheme('neon')).toBe('dark');
  });

  it('persists the chosen theme across loads', () => {
    const s = memory();
    saveTheme('light', s);
    expect(s.getItem(THEME_KEY)).toBe('light');
    expect(loadTheme(s)).toBe('light');
    saveTheme('dark', s);
    expect(loadTheme(s)).toBe('dark');
  });

  it('survives a throwing store', () => {
    const bad = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(loadTheme(bad)).toBe('dark');
    expect(() => saveTheme('light', bad)).not.toThrow();
  });
});
