import { describe, expect, it, vi } from 'vitest';
import { COMMENT_SIZE_DEFAULT, COMMENT_SIZE_KEY, clampCommentSize, loadCommentSize, saveCommentSize } from '../src/core/commentSize';
import { calloutLayout } from '../src/core/callout';
import { SHARED_REFRESH_MS, historyShortcut, startPolling, toolForKey } from '../src/app/shortcuts';

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
const mk = (): any => ({ id: 'a', type: 'rect', points: [{ x: 0, y: 0 }, { x: 50, y: 40 }], comments: [{ id: 'c', author: 'Ann', date: '', text: 'hello world this is a longer comment to wrap' }] });

describe('comment text size preference', () => {
  it('defaults, clamps and persists', () => {
    const s = mem();
    expect(loadCommentSize(s)).toBe(COMMENT_SIZE_DEFAULT);
    saveCommentSize(14, s);
    expect(s.getItem(COMMENT_SIZE_KEY)).toBe('14');
    expect(loadCommentSize(s)).toBe(14);
    expect(clampCommentSize(2)).toBe(7);
    expect(clampCommentSize(99)).toBe(18);
    expect(clampCommentSize('x')).toBe(COMMENT_SIZE_DEFAULT);
  });
  it('scales the callout layout and keeps the default metrics', () => {
    const d = calloutLayout(mk(), 9)!;
    expect([d.lineH, d.fs]).toEqual([11, 9]);
    const big = calloutLayout(mk(), 16)!;
    expect(big.fs).toBe(16);
    expect(big.h).toBeGreaterThan(d.h);
  });
});

describe('tool shortcuts', () => {
  it('recognizes undo and both redo shortcuts without taking over input editing', () => {
    expect(historyShortcut({ key: 'z', ctrlKey: true })).toBe('undo');
    expect(historyShortcut({ key: 'Z', ctrlKey: true, shiftKey: true })).toBe('redo');
    expect(historyShortcut({ key: 'y', ctrlKey: true })).toBe('redo');
    expect(historyShortcut({ key: 'z', metaKey: true })).toBe('undo');
    expect(historyShortcut({ key: 'z', ctrlKey: true, target: { tagName: 'INPUT' } as any })).toBeNull();
    expect(historyShortcut({ key: 'z', ctrlKey: true, target: { tagName: 'DIV', isContentEditable: true } as any })).toBeNull();
    expect(historyShortcut({ key: 'z', ctrlKey: true, altKey: true })).toBeNull();
  });
  it('V selects, H toggles pan', () => {
    expect(toolForKey({ key: 'v' }, 'pen')).toBe('select');
    expect(toolForKey({ key: 'H' }, 'select')).toBe('hand');
    expect(toolForKey({ key: 'h' }, 'hand')).toBe('select');
  });
  it('ignores modifiers, typing targets and other keys', () => {
    expect(toolForKey({ key: 'v', ctrlKey: true }, 'pen')).toBeNull();
    expect(toolForKey({ key: 'h', target: { tagName: 'INPUT' } as any }, 'pen')).toBeNull();
    expect(toolForKey({ key: 'x' }, 'pen')).toBeNull();
  });
});

describe('shared list auto-refresh', () => {
  it('polls on the interval and pauses while hidden', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    let visible = true;
    const stop = startPolling(fn, SHARED_REFRESH_MS, () => visible);
    vi.advanceTimersByTime(SHARED_REFRESH_MS);
    expect(fn).toHaveBeenCalledTimes(1);
    visible = false;
    vi.advanceTimersByTime(SHARED_REFRESH_MS * 2);
    expect(fn).toHaveBeenCalledTimes(1);
    stop();
    visible = true;
    vi.advanceTimersByTime(SHARED_REFRESH_MS);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
