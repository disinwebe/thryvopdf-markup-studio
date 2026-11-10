import { describe, expect, it } from 'vitest';
import { selectInWindow } from '../src/core/selection';
import type { PageObject } from '../src/core/pageContent';
import type { Markup } from '../src/core/types';

const markup = (id: string, type: Markup['type'], points: Markup['points'], comments: Markup['comments'] = []): Markup => ({
  id,
  page: 0,
  type,
  points,
  color: '#222222',
  width: 2,
  opacity: 1,
  status: 'None',
  author: 'Reviewer',
  date: '2026-11-10T00:00:00.000Z',
  comments,
});

const pageObject: PageObject = {
  id: 'signature',
  page: 0,
  kind: 'signature',
  x: 200,
  y: 200,
  width: 50,
  height: 30,
  color: '#222222',
  fontSize: 0,
};

describe('window selection', () => {
  it('selects markup types, page objects, and a comment callout independently', () => {
    const comment = { id: 'comment', author: 'Reviewer', date: '2026-11-10T00:00:00.000Z', text: 'Review this' };
    const items = [
      markup('rect', 'rect', [{ x: 10, y: 10 }, { x: 30, y: 30 }], [comment]),
      markup('measure', 'm-length', [{ x: 100, y: 100 }, { x: 140, y: 100 }]),
      markup('stamp', 'stamp', [{ x: 160, y: 160 }, { x: 180, y: 180 }]),
    ];

    expect(selectInWindow(items, [pageObject], { x: 15, y: 15, w: 5, h: 5 })).toEqual({
      markupIds: ['rect'],
      calloutIds: [],
      pageObjectIds: [],
    });
    expect(selectInWindow(items, [pageObject], { x: 62, y: 2, w: 10, h: 12 })).toEqual({
      markupIds: [],
      calloutIds: ['rect'],
      pageObjectIds: [],
    });
    expect(selectInWindow(items, [pageObject], { x: 190, y: 190, w: 70, h: 60 })).toEqual({
      markupIds: [],
      calloutIds: [],
      pageObjectIds: ['signature'],
    });
  });
});
