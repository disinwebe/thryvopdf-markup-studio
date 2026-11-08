import { bbox, boxOf, wrapText } from './geometry';
import { getCommentSize } from './commentSize';
import { BOX_TYPES, Markup, Pt } from './types';
import { isReviewMarkup } from './numbering';

export const CALLOUT_W = 150;
export const CALLOUT_PAD = 10;
export const CALLOUT_MIN_W = 80;
export const CALLOUT_MIN_H = 45;
export const CALLOUT_MAX = 4000;
const MAX_SHOWN = 4;

export interface CalloutLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  /** end point of the annotation the leader line connects to */
  anchor: Pt;
  /** where the leader leaves the comment box */
  edge: Pt;
  rows: { head: string; lines: string[] }[];
  hidden: number;
  /** comment text size and the derived metrics used to draw rows */
  fs: number;
  headFs: number;
  headH: number;
  lineH: number;
  rowGap: number;
}

/** The annotation's end point: its last point, or for box-like shapes the border point nearest the comment box. */
export function anchorOf(m: Pick<Markup, 'type' | 'points'>, toward: Pt): Pt {
  if (m.type === 'arrow') return m.points[0] ?? { x: 0, y: 0 };
  const last = m.points[m.points.length - 1] ?? { x: 0, y: 0 };
  if (m.type === 'callout' || !BOX_TYPES.includes(m.type)) return last;
  const r = boxOf(m);
  const cx = Math.min(Math.max(toward.x, r.x), r.x + r.w);
  const cy = Math.min(Math.max(toward.y, r.y), r.y + r.h);
  if (cx > r.x && cx < r.x + r.w && cy > r.y && cy < r.y + r.h) {
    const d = [cx - r.x, r.x + r.w - cx, cy - r.y, r.y + r.h - cy];
    const k = d.indexOf(Math.min(...d));
    return k === 0 ? { x: r.x, y: cy } : k === 1 ? { x: r.x + r.w, y: cy } : k === 2 ? { x: cx, y: r.y } : { x: cx, y: r.y + r.h };
  }
  return { x: cx, y: cy };
}

export function defaultCalloutPos(m: Pick<Markup, 'points'>): Pt {
  const b = bbox(m.points);
  return { x: b.x + b.w + 30, y: b.y - 10 };
}

export function calloutLayout(m: Markup, fs: number = getCommentSize()): CalloutLayout | null {
  if (!isReviewMarkup(m) || !m.comments.length || m.calloutHidden) return null;
  const HEAD = (fs * 13) / 9;
  const LINE = (fs * 11) / 9;
  const pos = m.callout ?? defaultCalloutPos(m);
  const width = Math.min(CALLOUT_MAX, Math.max(CALLOUT_MIN_W, m.calloutSize?.width ?? CALLOUT_W));
  const shown = m.comments.slice(-MAX_SHOWN);
  const rows = shown.map((c) => ({
    head: c.author + (c.edited ? ' (edited)' : ''),
    lines: wrapText(c.text, width - CALLOUT_PAD * 2, fs),
  }));
  const h = CALLOUT_PAD * 2 + HEAD + rows.reduce((s, r) => s + HEAD * 0.9 + r.lines.length * LINE + 3, 0);
  const box = { x: pos.x, y: pos.y, w: width, h: Math.max(h, Math.min(CALLOUT_MAX, m.calloutSize?.height ?? h)) };
  const centre = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  const anchor = anchorOf(m, centre);
  const ex = Math.min(Math.max(anchor.x, box.x), box.x + box.w);
  const ey = Math.min(Math.max(anchor.y, box.y), box.y + box.h);
  let edge = { x: ex, y: ey };
  if (ex > box.x && ex < box.x + box.w && ey > box.y && ey < box.y + box.h) edge = centre;
  return { ...box, anchor, edge, rows, hidden: m.comments.length - shown.length, fs, headFs: fs * (8.5 / 9), headH: HEAD * 0.9, lineH: LINE, rowGap: 3 };
}

export const hitCallout = (m: Markup, p: Pt): boolean => {
  const l = calloutLayout(m);
  return !!l && p.x >= l.x && p.x <= l.x + l.w && p.y >= l.y && p.y <= l.y + l.h;
};

export const moveCallout = (m: Markup, to: Pt): Markup => ({ ...m, callout: to });
