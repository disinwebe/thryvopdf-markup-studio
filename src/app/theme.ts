import { useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';
export const THEME_KEY = 'pms.theme';

export function parseTheme(v: unknown): Theme {
  return v === 'light' ? 'light' : 'dark';
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;
const store = (): Store | null => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
};

export function loadTheme(s: Store | null = store()): Theme {
  try {
    return parseTheme(s?.getItem(THEME_KEY));
  } catch {
    return 'dark';
  }
}

export function saveTheme(t: Theme, s: Store | null = store()) {
  try {
    s?.setItem(THEME_KEY, t);
  } catch {
    /* preference simply won't persist */
  }
}

export function applyTheme(t: Theme) {
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = t;
  if (typeof window !== 'undefined') window.api?.setNativeTheme?.(t);
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, set] = useState<Theme>(loadTheme);
  useEffect(() => {
    applyTheme(theme);
    saveTheme(theme);
  }, [theme]);
  return [theme, set];
}
