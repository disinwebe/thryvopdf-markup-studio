import { Markup, Pt } from './types';

/** Visible, sequential review numbers: by page, then creation date, then id. Renumbers automatically when markups change. */
export function numberMarkups(markups: Pick<Markup, 'id' | 'page' | 'date' | 'type'>[]): Map<string, number> {
  const order = [...markups]
    .filter((m) => m.type !== 'line')
    .sort((a, b) => a.page - b.page || a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return new Map(order.map((m, i) => [m.id, i + 1]));
}

/** Where the numbered tag sits: the top-left corner of the markup's extent. */
export function tagAnchor(m: Pick<Markup, 'points'>): Pt {
  if (!m.points.length) return { x: 0, y: 0 };
  return { x: Math.min(...m.points.map((p) => p.x)), y: Math.min(...m.points.map((p) => p.y)) };
}

export const TAG_R = 8;
