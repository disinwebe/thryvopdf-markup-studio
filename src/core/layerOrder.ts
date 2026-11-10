import type { PageObject } from './pageContent';
import type { Markup } from './types';

export type PageLayer = { kind: 'markup'; value: Markup } | { kind: 'page-object'; value: PageObject };

export function orderedPageLayers(markups: Markup[], pageObjects: PageObject[]): PageLayer[] {
  const maxExplicit = Math.max(-1, ...markups.map((item) => item.zOrder ?? -1), ...pageObjects.map((item) => item.zOrder ?? -1));
  const layers: Array<PageLayer & { order: number; index: number }> = [
    ...markups.map((value, index) => ({ kind: 'markup' as const, value, order: value.zOrder ?? (maxExplicit >= 0 ? maxExplicit + 1 + index : index), index })),
    ...pageObjects.map((value, index) => ({ kind: 'page-object' as const, value, order: value.zOrder ?? (maxExplicit >= 0 ? maxExplicit + 1 + markups.length + index : markups.length + index), index: markups.length + index })),
  ];
  return layers.sort((a, b) => a.order - b.order || a.index - b.index).map(({ kind, value }) => ({ kind, value } as PageLayer));
}

export function reorderPageLayers(markups: Markup[], pageObjects: PageObject[], id: string, direction: 'front' | 'back') {
  const layers = orderedPageLayers(markups, pageObjects);
  const targetIndex = layers.findIndex((layer) => layer.value.id === id);
  if (targetIndex < 0) return { markups, pageObjects, changed: false };
  const [target] = layers.splice(targetIndex, 1);
  layers.splice(direction === 'front' ? layers.length : 0, 0, target);
  return {
    markups: layers.filter((layer): layer is Extract<PageLayer, { kind: 'markup' }> => layer.kind === 'markup')
      .map((layer) => ({ ...layer.value, zOrder: layers.indexOf(layer) })),
    pageObjects: layers.filter((layer): layer is Extract<PageLayer, { kind: 'page-object' }> => layer.kind === 'page-object')
      .map((layer) => ({ ...layer.value, zOrder: layers.indexOf(layer) })),
    changed: true,
  };
}

export function topPageLayerAt(markups: Markup[], pageObjects: PageObject[], point: { x: number; y: number }, hitMarkup: (markup: Markup) => boolean) {
  const hits = orderedPageLayers(markups, pageObjects).filter((layer) => layer.kind === 'page-object'
    ? point.x >= layer.value.x && point.x <= layer.value.x + layer.value.width && point.y >= layer.value.y && point.y <= layer.value.y + layer.value.height
    : hitMarkup(layer.value));
  return hits[hits.length - 1] ?? null;
}
