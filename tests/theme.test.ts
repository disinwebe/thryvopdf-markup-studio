import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { THEME_KEY, applyTheme, loadTheme, parseTheme, saveTheme } from '../src/app/theme';

const { applyNativeTheme } = createRequire(import.meta.url)('../electron/menu.cjs');

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

  it('synchronizes the native theme and rejects invalid IPC values', () => {
    const native = { themeSource: 'system' };
    expect(applyNativeTheme(native, 'light')).toBe(true);
    expect(native.themeSource).toBe('light');
    expect(applyNativeTheme(native, 'dark')).toBe(true);
    expect(native.themeSource).toBe('dark');
    expect(applyNativeTheme(native, 'invalid')).toBe(false);
    expect(native.themeSource).toBe('dark');
    const setNativeTheme = vi.fn();
    vi.stubGlobal('window', { api: { setNativeTheme } });
    try {
      applyTheme('light');
      expect(setNativeTheme).toHaveBeenCalledWith('light');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
