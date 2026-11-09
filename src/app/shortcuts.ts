import type { Tool } from './model';

export const isTypingTarget = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  return !!el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable === true);
};

export function historyShortcut(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; target?: EventTarget | null }): 'undo' | 'redo' | null {
  if ((!e.ctrlKey && !e.metaKey) || e.altKey || isTypingTarget(e.target ?? null)) return null;
  const key = e.key.toLowerCase();
  if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
  return key === 'y' && !e.shiftKey ? 'redo' : null;
}

/** Tool selected by a plain key press (no Ctrl/Alt/Meta), or null. H toggles Pan back to Select. */
export function toolForKey(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; target?: EventTarget | null }, current: Tool): Tool | null {
  if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target ?? null)) return null;
  const k = e.key.toLowerCase();
  if (k === 'v') return 'select';
  if (k === 'h') return current === 'hand' ? 'select' : 'hand';
  return null;
}

/** Calls fn every intervalMs while canRun() is true; returns a stop function. */
export function startPolling(fn: () => void, intervalMs: number, canRun: () => boolean = () => true): () => void {
  const id = setInterval(() => {
    if (canRun()) fn();
  }, intervalMs);
  return () => clearInterval(id);
}

export const SHARED_REFRESH_MS = 5 * 60 * 1000;
