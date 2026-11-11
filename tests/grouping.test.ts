import { describe, expect, it } from 'vitest';
import type { PageObject } from '../src/core/pageContent';
import type { Markup } from '../src/core/types';
import { expandGroupedSelection, groupItems, ungroupItems } from '../src/core/grouping';

const markup = (id: string, groupId?: string): Markup => ({
  id, page: 0, type: 'rect', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
  color: '#000000', width: 1, opacity: 1, status: 'None', author: 'A', date: '2026-01-01', comments: [],
  ...(groupId ? { groupId } : {}),
});
const object = (id: string, groupId?: string): PageObject => ({
  id, page: 0, kind: 'text', x: 0, y: 0, width: 10, height: 10, color: '#000000', fontSize: 10,
  ...(groupId ? { groupId } : {}),
});

describe('selection groups', () => {
  it('groups mixed markups and page objects and expands a single-item selection', () => {
    const grouped = groupItems([markup('a'), markup('b')], [object('c')], ['a', 'b'], ['c'], 'group1');
    expect(grouped.markups.map((item) => item.groupId)).toEqual(['group1', 'group1']);
    expect(expandGroupedSelection(grouped.markups, grouped.pageObjects, 0, ['a'], [])).toEqual({
      markupIds: ['a', 'b'],
      pageObjectIds: ['c'],
    });
  });

  it('does not expand a group selection onto another page', () => {
    const grouped = groupItems([markup('a'), { ...markup('b'), page: 1 }], [], ['a', 'b'], [], 'group1');
    expect(expandGroupedSelection(grouped.markups, [], 0, ['a'], [])).toEqual({ markupIds: ['a'], pageObjectIds: [] });
  });

  it('ungroups every member when one grouped item is selected', () => {
    const grouped = groupItems([markup('a'), markup('b')], [object('c')], ['a', 'b'], ['c'], 'group1');
    expect(ungroupItems(grouped.markups, grouped.pageObjects, ['a'], []).markups.every((item) => !item.groupId)).toBe(true);
    const result = ungroupItems(grouped.markups, grouped.pageObjects, [], ['c']);
    expect(result.changed).toBe(true);
    expect(result.pageObjects[0].groupId).toBeUndefined();
  });
});
