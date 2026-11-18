import { describe, expect, it } from 'vitest';
import { parsePageRange, selectPrintPages } from '../src/app/printPages';

describe('print page ranges', () => {
  it('parses inclusive ranges and removes duplicates while preserving order', () => {
    expect(parsePageRange('1-3, 5, 3-4', 6)).toEqual([0, 1, 2, 4, 3]);
  });

  it('rejects malformed, reversed, and out-of-document ranges', () => {
    expect(() => parsePageRange('1,,3', 5)).toThrow('Enter pages');
    expect(() => parsePageRange('4-2', 5)).toThrow('between 1 and 5');
    expect(() => parsePageRange('1-6', 5)).toThrow('between 1 and 5');
  });

  it('combines current/custom selection, odd-even filtering, and reverse order', () => {
    expect(selectPrintPages({ pageCount: 6, mode: 'current', currentPage: 3, range: '', subset: 'all', reverse: false })).toEqual([3]);
    expect(selectPrintPages({ pageCount: 6, mode: 'custom', currentPage: 0, range: '1-6', subset: 'even', reverse: true })).toEqual([5, 3, 1]);
  });
});
