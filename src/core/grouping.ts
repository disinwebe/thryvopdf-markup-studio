import type { Markup } from './types';
import type { PageObject } from './pageContent';

export function expandGroupedSelection(
  markups: Markup[],
  pageObjects: PageObject[],
  page: number,
  markupIds: string[],
  pageObjectIds: string[],
): { markupIds: string[]; pageObjectIds: string[] } {
  const selectedMarkups = new Set(markupIds);
  const selectedObjects = new Set(pageObjectIds);
  const groups = new Set<string>();
  for (const markup of markups) {
    if (markup.page === page && selectedMarkups.has(markup.id) && markup.groupId) groups.add(markup.groupId);
  }
  for (const object of pageObjects) {
    if (object.page === page && selectedObjects.has(object.id) && object.groupId) groups.add(object.groupId);
  }
  if (!groups.size) return { markupIds: [...selectedMarkups], pageObjectIds: [...selectedObjects] };
  for (const markup of markups) if (markup.page === page && markup.groupId && groups.has(markup.groupId)) selectedMarkups.add(markup.id);
  for (const object of pageObjects) if (object.page === page && object.groupId && groups.has(object.groupId)) selectedObjects.add(object.id);
  return { markupIds: [...selectedMarkups], pageObjectIds: [...selectedObjects] };
}

export function groupItems(
  markups: Markup[],
  pageObjects: PageObject[],
  markupIds: string[],
  pageObjectIds: string[],
  groupId: string,
): { markups: Markup[]; pageObjects: PageObject[] } {
  const markupSet = new Set(markupIds);
  const objectSet = new Set(pageObjectIds);
  return {
    markups: markups.map((markup) => markupSet.has(markup.id) ? { ...markup, groupId } : markup),
    pageObjects: pageObjects.map((object) => objectSet.has(object.id) ? { ...object, groupId } : object),
  };
}

export function ungroupItems(
  markups: Markup[],
  pageObjects: PageObject[],
  markupIds: string[],
  pageObjectIds: string[],
): { markups: Markup[]; pageObjects: PageObject[]; changed: boolean } {
  const markupSet = new Set(markupIds);
  const objectSet = new Set(pageObjectIds);
  const groups = new Set<string>();
  for (const markup of markups) if (markupSet.has(markup.id) && markup.groupId) groups.add(markup.groupId);
  for (const object of pageObjects) if (objectSet.has(object.id) && object.groupId) groups.add(object.groupId);
  if (!groups.size) return { markups, pageObjects, changed: false };
  const nextMarkups = markups.map((markup) => {
    if (!markup.groupId || (!groups.has(markup.groupId) && !markupSet.has(markup.id))) return markup;
    const { groupId: _groupId, ...rest } = markup;
    return rest;
  });
  const nextObjects = pageObjects.map((object) => {
    if (!object.groupId || (!groups.has(object.groupId) && !objectSet.has(object.id))) return object;
    const { groupId: _groupId, ...rest } = object;
    return rest;
  });
  return { markups: nextMarkups, pageObjects: nextObjects, changed: true };
}
