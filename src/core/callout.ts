import { approxTextWidth, bbox, boxOf, wrapText } from './geometry';
import { clampCommentSize, getCommentSize } from './commentSize';
import { BOX_TYPES, Markup, Pt } from './types';
import { isReviewMarkup } from './numbering';

export const CALLOUT_W = 150;
export const CALLOUT_PAD = 7;
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
  rows: { head: string; lines: string[]; fs: number; headFs: number; headH: number; lineH: number }[];
  hidden: number;
  /** comment text size and the derived metrics used to draw rows */
  fs: number;
  headFs: number;
  headH: number;
  lineH: number;
  rowGap: number;
}

export interface CalloutTextRun {
  text: string;
  x: number;
  y: number;
  size: number;
  kind: 'number' | 'author' | 'body';
}

/** Baselines and sizes are shared by the SVG viewer and the PDF appearance. */
export function calloutTextRuns(co: CalloutLayout, tag?: number): CalloutTextRun[] {
  const runs: CalloutTextRun[] = [];
  const x = co.x + CALLOUT_PAD;
  const labelY = co.y + CALLOUT_PAD + Math.max(co.fs, co.rows[0]?.headFs ?? 0);
  if (tag) {
    const label = `#${tag}`;
    runs.push({ text: label, x, y: labelY, size: co.fs, kind: 'number' });
    if (co.rows[0]?.head) runs.push({ text: co.rows[0].head, x: x + approxTextWidth(label, co.fs) + 6, y: labelY, size: co.rows[0].headFs, kind: 'author' });
  }
  let y = labelY - (co.rows[0]?.fs ?? co.fs);
  co.rows.forEach((row, i) => {
    const head = y + row.fs;
    if (!tag || i !== 0) runs.push({ text: row.head, x, y: head, size: row.headFs, kind: 'author' });
    row.lines.forEach((line, j) => runs.push({ text: line, x, y: head + row.lineH * (j + 1), size: row.fs, kind: 'body' }));
    y += row.headH + row.lines.length * row.lineH + co.rowGap;
  });
  return runs;
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

export function calloutLayout(m: Markup, fs: number = clampCommentSize(m.commentSize ?? getCommentSize())): CalloutLayout | null {
  if (!isReviewMarkup(m) || !m.comments.length || m.calloutHidden) return null;
  const HEAD = (fs * 13) / 9;
  const LINE = (fs * 11) / 9;
  const pos = m.callout ?? defaultCalloutPos(m);
  const width = Math.min(CALLOUT_MAX, Math.max(CALLOUT_MIN_W, m.calloutSize?.width ?? CALLOUT_W));
  const shown = m.comments.slice(-MAX_SHOWN);
  const rows = shown.map((c) => {
    const rowFs = c.fontSize ?? fs;
    const headH = (rowFs * 13) / 9;
    return {
      head: c.author + (c.edited ? ' (edited)' : ''),
      lines: wrapText(c.text, width - CALLOUT_PAD * 2, rowFs),
      fs: rowFs,
      headFs: rowFs * (8.5 / 9),
      headH: headH * 0.9,
      lineH: (rowFs * 11) / 9,
    };
  });
  const h = CALLOUT_PAD * 2 + HEAD + rows.reduce((s, r) => s + r.headH + r.lines.length * r.lineH + 3, 0);
  const box = { x: pos.x, y: pos.y, w: width, h: Math.max(h, Math.min(CALLOUT_MAX, m.calloutSize?.height ?? h)) };
  const layout: CalloutLayout = { ...box, anchor: { x: 0, y: 0 }, edge: { x: 0, y: 0 }, rows, hidden: m.comments.length - shown.length, fs, headFs: fs * (8.5 / 9), headH: HEAD * 0.9, lineH: LINE, rowGap: 3 };
  const bottom = Math.max(...calloutTextRuns(layout, 1).map((run) => run.y), pos.y);
  layout.h = Math.max(layout.h, bottom - pos.y + CALLOUT_PAD);
  const centre = { x: layout.x + layout.w / 2, y: layout.y + layout.h / 2 };
  layout.anchor = anchorOf(m, centre);
  const ex = Math.min(Math.max(layout.anchor.x, layout.x), layout.x + layout.w);
  const ey = Math.min(Math.max(layout.anchor.y, layout.y), layout.y + layout.h);
  layout.edge = ex > layout.x && ex < layout.x + layout.w && ey > layout.y && ey < layout.y + layout.h ? centre : { x: ex, y: ey };
  return layout;
}

export const hitCallout = (m: Markup, p: Pt): boolean => {
  const l = calloutLayout(m);
  return !!l && p.x >= l.x && p.x <= l.x + l.w && p.y >= l.y && p.y <= l.y + l.h;
};

export const moveCallout = (m: Markup, to: Pt): Markup => ({ ...m, callout: to });
