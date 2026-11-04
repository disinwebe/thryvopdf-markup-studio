import { BOX_TYPES, Markup, Pt, Rect } from './types';

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

export function bbox(pts: Pt[]): Rect {
  if (!pts.length) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Rectangle for box-style markups (uses first two points). */
export function boxOf(m: Pick<Markup, 'points'>): Rect {
  return bbox(m.points.slice(0, 2));
}

export const isBox = (m: Pick<Markup, 'type'>) => BOX_TYPES.includes(m.type);

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

export function distToPath(p: Pt, pts: Pt[], closed = false): number {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, distToSegment(p, pts[i], pts[i + 1]));
  if (closed && pts.length > 2) d = Math.min(d, distToSegment(p, pts[pts.length - 1], pts[0]));
  if (pts.length === 1) d = dist(p, pts[0]);
  return d;
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export const rectPoly = (r: Rect): Pt[] => [
  { x: r.x, y: r.y },
  { x: r.x + r.w, y: r.y },
  { x: r.x + r.w, y: r.y + r.h },
  { x: r.x, y: r.y + r.h },
];

export const inRect = (p: Pt, r: Rect, tol = 0) =>
  p.x >= r.x - tol && p.x <= r.x + r.w + tol && p.y >= r.y - tol && p.y <= r.y + r.h + tol;

/** Closed scalloped outline around a rectangle (revision cloud), as a sampled polygon. */
export function cloudPoints(r: Rect, arc = 14): Pt[] {
  const corners = rectPoly(r);
  const out: Pt[] = [];
  for (let i = 0; i < 4; i++) {
    const a = corners[i],
      b = corners[(i + 1) % 4];
    const len = dist(a, b);
    if (len < 1) continue;
    const n = Math.max(1, Math.round(len / arc));
    const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const nrm = { x: d.y, y: -d.x };
    const seg = len / n;
    for (let k = 0; k < n; k++) {
      const s = { x: a.x + d.x * seg * k, y: a.y + d.y * seg * k };
      const m = { x: s.x + (d.x * seg) / 2, y: s.y + (d.y * seg) / 2 };
      const rad = seg / 2;
      for (let t = 0; t < 10; t++) {
        const ang = (Math.PI * t) / 10;
        out.push({
          x: m.x - d.x * rad * Math.cos(ang) + nrm.x * rad * Math.sin(ang),
          y: m.y - d.y * rad * Math.cos(ang) + nrm.y * rad * Math.sin(ang),
        });
      }
    }
  }
  return out;
}

export function arrowHead(from: Pt, to: Pt, size: number): Pt[] {
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  const a1 = ang + Math.PI - 0.45,
    a2 = ang + Math.PI + 0.45;
  return [
    to,
    { x: to.x + size * Math.cos(a1), y: to.y + size * Math.sin(a1) },
    { x: to.x + size * Math.cos(a2), y: to.y + size * Math.sin(a2) },
  ];
}

const CHAR_W = 0.52;
export const approxTextWidth = (s: string, size: number) => s.length * size * CHAR_W;

export function wrapText(text: string, maxWidth: number, size: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const test = line ? line + ' ' + word : word;
      if (approxTextWidth(test, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = test;
    }
    lines.push(line);
  }
  return lines;
}

export function translate(m: Markup, dx: number, dy: number): Markup {
  return { ...m, points: m.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
}

/** Ramer-Douglas-Peucker simplification for freehand strokes. */
export function simplify(pts: Pt[], eps = 0.6): Pt[] {
  if (pts.length < 3) return pts;
  let maxD = 0,
    idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distToSegment(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD <= eps) return [pts[0], pts[pts.length - 1]];
  return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)];
}

const polyOf = (m: Markup): Pt[] => m.points;

/** Returns true if point hits the markup within tol (page points). */
export function hitMarkup(m: Markup, p: Pt, tol: number): boolean {
  const t = tol + m.width / 2;
  switch (m.type) {
    case 'highlight':
    case 'text':
    case 'stamp':
      return inRect(p, boxOf(m), tol);
    case 'callout':
      return inRect(p, boxOf(m), tol) || (m.points[2] ? distToSegment(p, m.points[2], boxCenter(m)) <= t : false);
    case 'rect':
      return m.fill ? inRect(p, boxOf(m), tol) : distToPath(p, rectPoly(boxOf(m)), true) <= t;
    case 'cloud':
      return m.fill ? inRect(p, boxOf(m), tol) : distToPath(p, rectPoly(boxOf(m)), true) <= t + 6;
    case 'ellipse': {
      const r = boxOf(m);
      const rx = r.w / 2,
        ry = r.h / 2;
      if (rx < 1 || ry < 1) return false;
      const nx = (p.x - (r.x + rx)) / rx,
        ny = (p.y - (r.y + ry)) / ry;
      const d = Math.hypot(nx, ny);
      if (m.fill) return d <= 1 + tol / Math.min(rx, ry);
      return Math.abs(d - 1) * Math.min(rx, ry) <= t;
    }
    case 'note':
    case 'm-count':
      return dist(p, m.points[0]) <= 12 + tol;
    case 'm-area':
      return pointInPolygon(p, polyOf(m)) || distToPath(p, polyOf(m), true) <= t;
    case 'm-perimeter':
      return distToPath(p, polyOf(m), true) <= t;
    default:
      return distToPath(p, polyOf(m)) <= t;
  }
}

export function boxCenter(m: Pick<Markup, 'points'>): Pt {
  const r = boxOf(m);
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function pickTop(markups: Markup[], page: number, p: Pt, tol: number): Markup | undefined {
  for (let i = markups.length - 1; i >= 0; i--) {
    const m = markups[i];
    if (m.page === page && hitMarkup(m, p, tol)) return m;
  }
  return undefined;
}

export type HandleKey = number | 'tip';
export interface Handle {
  key: HandleKey;
  p: Pt;
}

export function handlesOf(m: Markup): Handle[] {
  if (m.type === 'note' || m.type === 'm-count') return [];
  if (isBox(m)) {
    const hs: Handle[] = rectPoly(boxOf(m)).map((p, i) => ({ key: i, p }));
    if (m.type === 'callout' && m.points[2]) hs.push({ key: 'tip', p: m.points[2] });
    return hs;
  }
  return m.points.map((p, i) => ({ key: i, p }));
}

export function applyHandle(m: Markup, key: HandleKey, p: Pt): Markup {
  if (key === 'tip') {
    const pts = m.points.slice();
    pts[2] = p;
    return { ...m, points: pts };
  }
  if (isBox(m)) {
    const corners = rectPoly(boxOf(m));
    const opposite = corners[(key + 2) % 4];
    const pts = m.points.slice();
    pts[0] = opposite;
    pts[1] = p;
    return { ...m, points: pts };
  }
  const pts = m.points.slice();
  pts[key] = p;
  return { ...m, points: pts };
}
