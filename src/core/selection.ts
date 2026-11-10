import { calloutLayout } from './callout';
import { boxOf } from './geometry';
import type { PageObject } from './pageContent';
import type { Markup, Pt, Rect } from './types';

export function normalizedRect(a: Pt, b: Pt): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

export function markupSelectionBounds(markup: Markup): Rect {
  const shape = boxOf(markup);
  const callout = calloutLayout(markup);
  if (!callout) return shape;
  const x = Math.min(shape.x, callout.x);
  const y = Math.min(shape.y, callout.y);
  return { x, y, w: Math.max(shape.x + shape.w, callout.x + callout.w) - x, h: Math.max(shape.y + shape.h, callout.y + callout.h) - y };
}

export function selectInWindow(markups: Markup[], pageObjects: PageObject[], window: Rect) {
  const markupIds = markups.filter((markup) => overlaps(boxOf(markup), window)).map((markup) => markup.id);
  const calloutIds = markups.filter((markup) => {
    const callout = calloutLayout(markup);
    return !!callout && overlaps({ x: callout.x, y: callout.y, w: callout.w, h: callout.h }, window);
  }).map((markup) => markup.id);
  return {
    markupIds,
    calloutIds,
    pageObjectIds: pageObjects.filter((object) => overlaps(
      { x: object.x, y: object.y, w: object.width, h: object.height },
      window,
    )).map((object) => object.id),
  };
}
