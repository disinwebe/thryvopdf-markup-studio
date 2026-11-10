import { describe, expect, it } from 'vitest';
import { hitMarkup } from '../src/core/geometry';
import { orderedPageLayers, reorderPageLayers, topPageLayerAt } from '../src/core/layerOrder';
import { cloudPointsFromPath } from '../src/core/geometry';
import type { Markup } from '../src/core/types';
import type { PageObject } from '../src/core/pageContent';

const markup = (id: string, type: Markup['type'], zOrder?: number): Markup => ({
  id, page: 0, type, points: [{ x: 10, y: 10 }, { x: 90, y: 90 }],
  color: '#000000', width: 2, opacity: 1, status: 'None', author: 'Test',
  date: '2026-01-01T00:00:00Z', comments: [], ...(zOrder === undefined ? {} : { zOrder }),
});

const pageObject = (id: string, zOrder?: number): PageObject => ({
  id, page: 0, kind: 'signature', x: 10, y: 10, width: 80, height: 80,
  color: '#000000', fontSize: 0, ...(zOrder === undefined ? {} : { zOrder }),
});

describe('page object stacking', () => {
  it('orders page objects with markup layers and brings targets to either end', () => {
    const markups = [markup('stamp', 'stamp')];
    const objects = [pageObject('text'), pageObject('signature')];
    expect(orderedPageLayers(markups, objects).map((layer) => layer.value.id)).toEqual(['stamp', 'text', 'signature']);

    const front = reorderPageLayers(markups, objects, 'stamp', 'front');
    expect(orderedPageLayers(front.markups, front.pageObjects).map((layer) => layer.value.id)).toEqual(['text', 'signature', 'stamp']);
    const back = reorderPageLayers(front.markups, front.pageObjects, 'signature', 'back');
    expect(orderedPageLayers(back.markups, back.pageObjects).map((layer) => layer.value.id)).toEqual(['signature', 'text', 'stamp']);
  });

  it('picks the visible topmost object when layers overlap', () => {
    const top = topPageLayerAt([markup('stamp', 'stamp', 1)], [pageObject('signature', 2)], { x: 20, y: 20 }, (item) => hitMarkup(item, { x: 20, y: 20 }, 2));
    expect(top?.value.id).toBe('signature');
  });
});

describe('point-by-point clouds', () => {
  it('follows a polygon instead of its bounding rectangle and preserves old rectangle clouds', () => {
    const triangle = [{ x: 10, y: 10 }, { x: 100, y: 10 }, { x: 10, y: 100 }];
    const outline = cloudPointsFromPath(triangle, 12);
    expect(outline.length).toBeGreaterThan(20);
    const cloud = markup('triangle', 'cloud');
    cloud.points = triangle;
    expect(hitMarkup(cloud, { x: 70, y: 70 }, 1)).toBe(false);
    expect(cloudPointsFromPath([{ x: 0, y: 0 }, { x: 100, y: 50 }], 10).length).toBeGreaterThan(20);
  });
});
