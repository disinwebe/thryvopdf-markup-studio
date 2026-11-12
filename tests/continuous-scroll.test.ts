import { describe, expect, it } from 'vitest';
import { pageAtScrollOffset } from '../src/components/PageView';

const pages = [
  { page: 0, top: 0, bottom: 800 },
  { page: 1, top: 840, bottom: 1640 },
  { page: 2, top: 1680, bottom: 2480 },
];

describe('continuous page navigation', () => {
  it('selects the page under the scroll position', () => {
    expect(pageAtScrollOffset(pages, 1200)).toBe(1);
  });

  it('selects the next page when the scroll position is in the page gap', () => {
    expect(pageAtScrollOffset(pages, 820)).toBe(1);
  });

  it('keeps the last page selected past the end of the document', () => {
    expect(pageAtScrollOffset(pages, 2600)).toBe(2);
  });

  it('returns the first page when no page positions are available', () => {
    expect(pageAtScrollOffset([], 0)).toBe(0);
  });
});
