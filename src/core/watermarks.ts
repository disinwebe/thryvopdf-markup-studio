import { Markup } from './types';

/** Parse a 1-based page list such as "1-3, 5" into sorted, unique zero-based indexes. */
export function parseWatermarkPages(value: string, pageCount: number): number[] {
  if (!Number.isInteger(pageCount) || pageCount < 1) throw new Error('The document has no pages.');
  const parts = value.split(',').map((part) => part.trim());
  if (!parts.length || parts.some((part) => !part)) {
    throw new Error('Enter pages as numbers or ranges, for example 1-3, 5.');
  }

  const pages = new Set<number>();
  for (const part of parts) {
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
    if (!match) throw new Error('Enter pages as numbers or ranges, for example 1-3, 5.');
    const first = Number(match[1]);
    const last = Number(match[2] ?? match[1]);
    if (first < 1 || last < first || last > pageCount) {
      throw new Error(`Page ranges must be between 1 and ${pageCount}, with the first page no greater than the last.`);
    }
    for (let page = first; page <= last; page++) pages.add(page - 1);
  }
  return [...pages].sort((a, b) => a - b);
}

export interface WatermarkGroup {
  key: string;
  markups: Markup[];
}

export function groupWatermarks(markups: readonly Markup[]): WatermarkGroup[] {
  const groups = new Map<string, Markup[]>();
  for (const markup of markups) {
    if (!markup.watermark) continue;
    const key = markup.watermarkId || markup.id;
    groups.set(key, [...(groups.get(key) ?? []), markup]);
  }
  return [...groups.entries()]
    .map(([key, items]) => ({ key, markups: items.sort((a, b) => a.page - b.page) }))
    .sort((a, b) => a.markups[0].page - b.markups[0].page);
}
