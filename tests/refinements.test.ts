import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { anchorOf, calloutLayout } from '../src/core/callout';
import { Markup } from '../src/core/types';

const arrow = (): Markup => ({
  id: 'arrow-1',
  page: 0,
  type: 'arrow',
  points: [{ x: 25, y: 30 }, { x: 150, y: 100 }],
  color: '#ff0000',
  width: 2,
  opacity: 1,
  status: 'None',
  author: 'A',
  date: '2024-01-01T00:00:00Z',
  comments: [{ id: 'c1', author: 'A', date: '2024-01-02T00:00:00Z', text: 'Review here' }],
});

describe('markup property and comment refinements', () => {
  it('connects arrow comment callouts to the first point, not the arrow tip', () => {
    expect(anchorOf(arrow(), { x: 300, y: 150 })).toEqual({ x: 25, y: 30 });
    expect(calloutLayout(arrow())?.anchor).toEqual({ x: 25, y: 30 });
  });

  it('lays out each markup property as a full-width vertical row', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.props\s*>\s*label\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/s);
    expect(css).toMatch(/\.props\s*>\s*label\s+input[^}]*width:\s*100%/);
  });
});
