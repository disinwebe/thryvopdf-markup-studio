import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFPage,
  PDFRef,
  PDFString,
  StandardFonts,
  rgb,
} from 'pdf-lib';
import {
  approxTextWidth,
  arrowHead,
  bbox,
  boxCenter,
  boxOf,
  cloudPointsFromPath,
  rectPoly,
  wrapText,
} from './geometry';
import { countNumbers, DEFAULT_CAL, measureLabel } from './measurement';
import { Bookmark, Calibration, Markup, Pt, Rect, SheetMeta, uid } from './types';
import { isReviewMarkup, numberMarkups } from './numbering';
import { calloutLayout, calloutTextRuns } from './callout';
import { measurementArrowheads } from './snapping';

export interface PageGeom {
  x0: number;
  y0: number;
  /** unrotated crop box size */
  w: number;
  h: number;
  rotation: number;
}

const norm = (r: number) => ((Math.round(r / 90) * 90) % 360 + 360) % 360;

export function pageGeom(page: PDFPage): PageGeom {
  const box = page.getCropBox();
  return { x0: box.x, y0: box.y, w: box.width, h: box.height, rotation: norm(page.getRotation().angle) };
}

export function viewSize(g: PageGeom) {
  return g.rotation % 180 ? { w: g.h, h: g.w } : { w: g.w, h: g.h };
}

/** Viewport (scale 1, top-left origin) point -> PDF user space. */
export function viewToPdf(p: Pt, g: PageGeom): Pt {
  let x: number, y: number;
  switch (g.rotation) {
    case 90:
      x = p.y;
      y = p.x;
      break;
    case 180:
      x = g.w - p.x;
      y = p.y;
      break;
    case 270:
      x = g.w - p.y;
      y = g.h - p.x;
      break;
    default:
      x = p.x;
      y = g.h - p.y;
  }
  return { x: x + g.x0, y: y + g.y0 };
}

export function pdfToView(p: Pt, g: PageGeom): Pt {
  const x = p.x - g.x0,
    y = p.y - g.y0;
  switch (g.rotation) {
    case 90:
      return { x: y, y: x };
    case 180:
      return { x: g.w - x, y };
    case 270:
      return { x: g.h - y, y: g.w - x };
    default:
      return { x, y: g.h - y };
  }
}

const hex = (c: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(c);
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map((v) => +v.toFixed(4)) as [
    number,
    number,
    number,
  ];
};
const f = (n: number) => +n.toFixed(3);
const pdfDate = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(+d)) return undefined;
  const p = (n: number) => String(n).padStart(2, '0');
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
};
const latin1 = (s: string) =>
  s.replace(/[^\x20-\x7e\xa0-\xff]/g, '?').replace(/([\\()])/g, '\\$1');

interface Built {
  subtype: string;
  ops: string;
  rect: Rect; // pdf space
  extra: Record<string, unknown>;
  blend?: string;
}

const SUBTYPE: Record<string, string> = {
  highlight: 'Highlight',
  text: 'FreeText',
  callout: 'FreeText',
  cloud: 'Square',
  rect: 'Square',
  ellipse: 'Circle',
  line: 'Line',
  arrow: 'Line',
  polyline: 'PolyLine',
  pen: 'Ink',
  stamp: 'Stamp',
  note: 'Text',
  'm-length': 'Line',
  'm-polylength': 'PolyLine',
  'm-area': 'Polygon',
  'm-perimeter': 'Polygon',
  'm-angle': 'PolyLine',
  'm-count': 'Circle',
};

/** Build the appearance-stream operators and annotation-specific keys for a markup. */
export function buildAppearance(
  m: Markup,
  g: PageGeom,
  cal: Calibration = DEFAULT_CAL,
  tag?: number,
  countNo?: number,
  textWidth: (text: string, size: number) => number = approxTextWidth,
): Built {
  const cv = (p: Pt) => viewToPdf(p, g);
  const col = hex(m.color);
  const stroke = `${f(m.width)} w ${col.join(' ')} RG 1 J 1 j`;
  const fillC = m.fill ? hex(m.fill) : null;
  const path = (pts: Pt[], close = false) => {
    const q = pts.map(cv);
    return q.map((p, i) => `${f(p.x)} ${f(p.y)} ${i ? 'l' : 'm'}`).join(' ') + (close ? ' h' : '');
  };
  const circlePath = (point: Pt, radius: number) => {
    const c = 0.5523 * radius;
    const P = (x: number, y: number) => cv({ x, y });
    const q0 = P(point.x + radius, point.y), q1 = P(point.x + radius, point.y + c), q2 = P(point.x + c, point.y + radius), q3 = P(point.x, point.y + radius);
    const q4 = P(point.x - c, point.y + radius), q5 = P(point.x - radius, point.y + c), q6 = P(point.x - radius, point.y);
    const q7 = P(point.x - radius, point.y - c), q8 = P(point.x - c, point.y - radius), q9 = P(point.x, point.y - radius);
    const q10 = P(point.x + c, point.y - radius), q11 = P(point.x + radius, point.y - c);
    return `${f(q0.x)} ${f(q0.y)} m ${f(q1.x)} ${f(q1.y)} ${f(q2.x)} ${f(q2.y)} ${f(q3.x)} ${f(q3.y)} c ` +
      `${f(q4.x)} ${f(q4.y)} ${f(q5.x)} ${f(q5.y)} ${f(q6.x)} ${f(q6.y)} c ` +
      `${f(q7.x)} ${f(q7.y)} ${f(q8.x)} ${f(q8.y)} ${f(q9.x)} ${f(q9.y)} c ` +
      `${f(q10.x)} ${f(q10.y)} ${f(q11.x)} ${f(q11.y)} ${f(q0.x)} ${f(q0.y)} c f`;
  };
  const textAngle = (g.rotation * Math.PI) / 180;
  const tm = (p: Pt) => {
    const q = cv(p);
    const c = Math.cos(textAngle),
      s = Math.sin(textAngle);
    return `${f(c)} ${f(s)} ${f(-s)} ${f(c)} ${f(q.x)} ${f(q.y)} Tm`;
  };
  const textLines = (lines: string[], origin: Pt, size: number, color: number[], font = 'F1', mode = 0) =>
    lines
      .map(
        (ln, i) =>
          `BT /${font} ${size} Tf ${color.join(' ')} rg ${mode} Tr ${tm({ x: origin.x, y: origin.y + size * (i + 1) * 1.15 - size * 0.2 })} (${latin1(ln)}) Tj ET`,
      )
      .join('\n');

  let ops = '';
  let viewPts: Pt[] = [...m.points];
  const extra: Record<string, unknown> = {};
  let blend: string | undefined;
  const labelAt = (text: string, x: number, y: number, size = 11) => {
    if (!text) return '';
    const square = text.indexOf('²');
    const base = square < 0 ? text : text.slice(0, square);
    const raised = square < 0 ? '' : '2' + text.slice(square + 1);
    const drawLabel = (label: string, labelX: number, baseline: number, labelSize: number) => {
      const origin = { x: labelX, y: baseline - labelSize * 0.95 };
      const matrix = tm({ x: origin.x, y: origin.y + labelSize * 0.95 });
      const areaLabel = m.type === 'm-area';
      const fill = areaLabel ? '1 1 1' : col.join(' ');
      const outline = areaLabel ? col.join(' ') : '1 1 1';
      return `\nq ${outline} RG 1 w BT /F2 ${labelSize} Tf ${outline} rg 1 Tr ${matrix} (${latin1(label)}) Tj ET ` +
        `BT /F2 ${labelSize} Tf ${fill} rg 0 Tr ${matrix} (${latin1(label)}) Tj ET Q`;
    };
    const raisedSize = size * 0.7;
    const superscriptGap = 0.35;
    const raisedX = x + textWidth(base, size) + superscriptGap;
    const raisedY = y - size * 0.35;
    return drawLabel(base, x, y, size) +
      (raised ? drawLabel(raised, raisedX, raisedY, raisedSize) : '');
  };
  const labelWidth = (text: string, size: number) => {
    const square = text.indexOf('²');
    return square < 0
      ? textWidth(text, size)
      : textWidth(text.slice(0, square), size) + textWidth('2' + text.slice(square + 1), size * 0.7) + 1;
  };
  const label = (anchor: Pt, dx = 4, dy = -6) => {
    const t = measureLabel(m, cal);
    return labelAt(t, anchor.x + dx, anchor.y + dy);
  };
  const includeLabel = (text: string, x: number, baseline: number, size = 11) => {
    if (!text) return;
    const width = labelWidth(text, size);
    viewPts.push(
      { x: x - 3, y: baseline - size - 4 },
      { x: x + width + 3, y: baseline + 5 },
    );
  };

  switch (m.type) {
    case 'highlight': {
      const r = boxOf(m);
      viewPts = rectPoly(r);
      ops = `${col.join(' ')} rg ${path(viewPts, true)} f`;
      blend = 'Multiply';
      const q = viewPts.map(cv);
      extra.QuadPoints = [q[0], q[1], q[3], q[2]].flatMap((p) => [f(p.x), f(p.y)]);
      break;
    }
    case 'rect': {
      const r = boxOf(m);
      viewPts = rectPoly(r);
      ops = `${stroke} ${fillC ? fillC.join(' ') + ' rg' : ''} ${path(viewPts, true)} ${fillC ? 'B' : 'S'}`;
      break;
    }
    case 'cloud': {
      viewPts = cloudPointsFromPath(m.points, m.cloudArc);
      ops = `${stroke} ${fillC ? fillC.join(' ') + ' rg' : ''} ${path(viewPts, true)} ${fillC ? 'B' : 'S'}`;
      break;
    }
    case 'ellipse': {
      const r = boxOf(m);
      const k = 0.5523;
      const cx = r.x + r.w / 2,
        cy = r.y + r.h / 2,
        rx = r.w / 2,
        ry = r.h / 2;
      const P = (x: number, y: number) => {
        const q = cv({ x, y });
        return `${f(q.x)} ${f(q.y)}`;
      };
      ops =
        `${stroke} ${fillC ? fillC.join(' ') + ' rg' : ''} ${P(cx + rx, cy)} m ` +
        `${P(cx + rx, cy + ry * k)} ${P(cx + rx * k, cy + ry)} ${P(cx, cy + ry)} c ` +
        `${P(cx - rx * k, cy + ry)} ${P(cx - rx, cy + ry * k)} ${P(cx - rx, cy)} c ` +
        `${P(cx - rx, cy - ry * k)} ${P(cx - rx * k, cy - ry)} ${P(cx, cy - ry)} c ` +
        `${P(cx + rx * k, cy - ry)} ${P(cx + rx, cy - ry * k)} ${P(cx + rx, cy)} c h ${fillC ? 'B' : 'S'}`;
      viewPts = rectPoly(r);
      break;
    }
    case 'line':
    case 'arrow':
    case 'm-length': {
      const [a, b] = m.points;
      ops = `${stroke} ${path([a, b])} S`;
      if (m.type === 'arrow') {
        const head = arrowHead(a, b, 8 + m.width * 2);
        ops += ` ${col.join(' ')} rg ${path(head, true)} f`;
        extra.LE = ['None', 'OpenArrow'];
      }
      if (m.type === 'm-length') {
        viewPts = [a, b];
        const heads = measurementArrowheads(m);
        const startArrow = m.measurementArrowheads === 'start' || m.measurementArrowheads === 'both';
        const endArrow = m.measurementArrowheads === 'end' || m.measurementArrowheads === 'both';
        if (startArrow || endArrow) {
          ops = `${stroke} ${path([a, b])} S`;
          if (!startArrow) ops += ` ${col.join(' ')} rg ${circlePath(a, 2.5)}`;
          if (!endArrow) ops += ` ${col.join(' ')} rg ${circlePath(b, 2.5)}`;
          ops += ` ${col.join(' ')} rg ${heads.map((head) => path(head, true)).join(' ')} f`;
          extra.LE = [startArrow ? 'ClosedArrow' : 'None', endArrow ? 'ClosedArrow' : 'None'];
          viewPts.push(...heads.flat());
        } else ops += ` ${col.join(' ')} rg ${circlePath(a, 2.5)} ${circlePath(b, 2.5)}`;
        const anchor = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const text = measureLabel(m, cal);
        includeLabel(text, anchor.x + 4, anchor.y - 6);
        ops += label(anchor);
      }
      extra.L = [...[a, b].map(cv)].flatMap((p) => [f(p.x), f(p.y)]);
      break;
    }
    case 'polyline':
    case 'm-polylength':
    case 'm-angle': {
      ops = `${stroke} ${path(m.points)} S`;
      if (m.type !== 'polyline') {
        const anchor = m.points[Math.floor(m.points.length / 2)] ?? m.points[0];
        const dx = m.type === 'm-angle' ? 6 : 4;
        const text = measureLabel(m, cal);
        includeLabel(text, anchor.x + dx, anchor.y - 6);
        ops += label(anchor, dx, -6);
      }
      extra.Vertices = m.points.map(cv).flatMap((p) => [f(p.x), f(p.y)]);
      break;
    }
    case 'pen': {
      ops = `${stroke} ${path(m.points)} S`;
      extra.InkList = [m.points.map(cv).flatMap((p) => [f(p.x), f(p.y)])];
      break;
    }
    case 'm-area':
    case 'm-perimeter': {
      const fc = m.type === 'm-area' ? fillC ?? col : null;
      ops = `${stroke} ${fc ? fc.join(' ') + ' rg' : ''} ${path(m.points, true)} ${fc ? 'B' : 'S'}`;
      const centre = {
        x: m.points.reduce((sum, p) => sum + p.x, 0) / m.points.length,
        y: m.points.reduce((sum, p) => sum + p.y, 0) / m.points.length,
      };
      const text = measureLabel(m, cal);
      const x = centre.x - labelWidth(text, 11) / 2;
      includeLabel(text, x, centre.y);
      ops += labelAt(text, x, centre.y);
      extra.Vertices = m.points.map(cv).flatMap((p) => [f(p.x), f(p.y)]);
      break;
    }
    case 'm-count': {
      const p = m.points[0];
      const r = 7,
        k = 0.5523 * r;
      const P = (x: number, y: number) => {
        const q = cv({ x, y });
        return `${f(q.x)} ${f(q.y)}`;
      };
      ops =
        `${col.join(' ')} rg ${P(p.x + r, p.y)} m ${P(p.x + r, p.y + k)} ${P(p.x + k, p.y + r)} ${P(p.x, p.y + r)} c ` +
        `${P(p.x - k, p.y + r)} ${P(p.x - r, p.y + k)} ${P(p.x - r, p.y)} c ${P(p.x - r, p.y - k)} ${P(p.x - k, p.y - r)} ${P(p.x, p.y - r)} c ` +
        `${P(p.x + k, p.y - r)} ${P(p.x + r, p.y - k)} ${P(p.x + r, p.y)} c f`;
      ops += ` 1 1 1 RG 1 w ${circlePath(p, r)} S`;
      if (countNo !== undefined) {
        const count = String(countNo);
        const countSize = count.length > 2 ? 6 : count.length > 1 ? 8 : 10;
        const countWidth = textWidth(count, countSize);
        const countX = p.x - countWidth / 2;
        const countY = p.y + countSize * 0.37;
        ops += ` BT /F2 ${countSize} Tf 1 1 1 rg 0 Tr ${tm({ x: countX, y: countY })} (${latin1(count)}) Tj ET`;
      }
      viewPts = [
        { x: p.x - r, y: p.y - r },
        { x: p.x + r, y: p.y + r },
      ];
      if (countNo !== undefined) {
        const count = String(countNo);
        const countSize = count.length > 2 ? 6 : count.length > 1 ? 8 : 10;
        const countX = p.x - textWidth(count, countSize) / 2;
        const countY = p.y + countSize * 0.37;
        viewPts.push(
          { x: countX - 1, y: countY - countSize - 1 },
          { x: countX + textWidth(count, countSize) + 1, y: countY + 1 },
        );
      }
      break;
    }
    case 'text':
    case 'callout': {
      const r = boxOf(m);
      const size = m.fontSize ?? 12;
      const lines = wrapText(m.text ?? '', Math.max(10, r.w - 8), size);
      viewPts = rectPoly(r);
      ops = `${stroke} ${fillC ? fillC.join(' ') + ' rg' : '1 1 1 rg'} ${path(viewPts, true)} B\n`;
      ops += textLines(lines, { x: r.x + 4, y: r.y + 3 }, size, col);
      if (m.type === 'callout' && m.points[2]) {
        const tip = m.points[2];
        const c = boxCenter(m);
        const edge = clampToRect(c, tip, r);
        ops += `\n${stroke} ${path([edge, tip])} S ${col.join(' ')} rg ${path(arrowHead(edge, tip, 7 + m.width), true)} f`;
        viewPts = [...viewPts, tip];
        extra.CL = [edge, tip].map(cv).flatMap((p) => [f(p.x), f(p.y)]);
        extra.IT = 'FreeTextCallout';
      }
      extra.DA = `/Helv ${size} Tf ${col.join(' ')} rg`;
      break;
    }
    case 'stamp': {
      const r = boxOf(m);
      if (m.stampImage) {
        const origin = cv({ x: r.x, y: r.y + r.h });
        const right = cv({ x: r.x + r.w, y: r.y + r.h });
        const top = cv({ x: r.x, y: r.y });
        ops = `q ${f(right.x - origin.x)} ${f(right.y - origin.y)} ${f(top.x - origin.x)} ${f(top.y - origin.y)} ${f(origin.x)} ${f(origin.y)} cm /StampImage Do Q`;
        viewPts = rectPoly(r);
        extra.Name = 'Draft';
        break;
      }
      const t = (m.stamp ?? m.text ?? 'STAMP').toUpperCase();
      const size = Math.max(6, Math.min(r.h * 0.5, (r.w - 10) / Math.max(1, t.length * 0.62)));
      viewPts = rectPoly(r);
      ops = `${f(Math.max(2, m.width))} w ${col.join(' ')} RG ${path(viewPts, true)} S\n`;
      const tw = approxTextWidth(t, size);
      ops += textLines([t], { x: r.x + (r.w - tw) / 2, y: r.y + (r.h - size * 1.15) / 2 + 0.5 }, f(size), col);
      extra.Name = 'Draft';
      break;
    }
    case 'note': {
      const p = m.points[0];
      const r = { x: p.x - 10, y: p.y - 10, w: 20, h: 20 };
      viewPts = rectPoly(r);
      ops = `1 0.93 0.4 rg 0.4 0.3 0 RG 1 w ${path(viewPts, true)} B 0.4 0.3 0 RG ${path([
        { x: p.x - 6, y: p.y - 4 },
        { x: p.x + 6, y: p.y - 4 },
      ])} S ${path([
        { x: p.x - 6, y: p.y },
        { x: p.x + 6, y: p.y },
      ])} S ${path([
        { x: p.x - 6, y: p.y + 4 },
        { x: p.x + 2, y: p.y + 4 },
      ])} S`;
      extra.Name = 'Note';
      break;
    }
  }

  const pad = m.width / 2 + 12;
  const bb = bbox(viewPts.map(cv));
  let rect = { x: bb.x - pad, y: bb.y - pad, w: bb.w + pad * 2, h: bb.h + pad * 2 };
  const co = calloutLayout(m);
  if (co) {
    // Comment box with a leader line to the annotation's end point, drawn as part of the same annotation.
    const A = cv(co.anchor);
    const E = cv(co.edge);
    const viewCorners = [
      { x: co.x, y: co.y }, { x: co.x + co.w, y: co.y },
      { x: co.x + co.w, y: co.y + co.h }, { x: co.x, y: co.y + co.h },
    ];
    const corners = viewCorners.map(cv);
    const txt = calloutTextRuns(co, tag).map((run) => {
      const color = run.kind === 'number' ? '1 1 1' : run.kind === 'author' ? '0.62 0.07 0.21' : '0.13 0.13 0.13';
      return `BT /F1 ${f(run.size)} Tf ${color} rg ${tm(run)} (${latin1(run.text)}) Tj ET\n`;
    }).join('');
    const badge = calloutTextRuns(co, tag).find((run) => run.badge)?.badge;
    let badgeOps = '';
    if (badge) {
      const centre = cv({ x: badge.cx, y: badge.cy });
      const r = badge.r;
      const k = r * 0.5523;
      const circle = `${f(centre.x + r)} ${f(centre.y)} m ${f(centre.x + r)} ${f(centre.y + k)} ${f(centre.x + k)} ${f(centre.y + r)} ${f(centre.x)} ${f(centre.y + r)} c ${f(centre.x - k)} ${f(centre.y + r)} ${f(centre.x - r)} ${f(centre.y + k)} ${f(centre.x - r)} ${f(centre.y)} c ${f(centre.x - r)} ${f(centre.y - k)} ${f(centre.x - k)} ${f(centre.y - r)} ${f(centre.x)} ${f(centre.y - r)} c ${f(centre.x + k)} ${f(centre.y - r)} ${f(centre.x + r)} ${f(centre.y - k)} ${f(centre.x + r)} ${f(centre.y)} c h`;
      badgeOps = `0.882 0.114 0.282 rg ${circle} f\n`;
      corners.push({ x: centre.x - r, y: centre.y - r }, { x: centre.x + r, y: centre.y + r });
    }
    ops += `\nq /GS1 gs 0.882 0.114 0.282 RG 1.5 w ${f(E.x)} ${f(E.y)} m ${f(A.x)} ${f(A.y)} l S `;
    ops += `1 1 1 rg ${path(viewCorners, true)} B\n${badgeOps}${txt}Q`;
    const xs = [...corners.map((c) => c.x), A.x];
    const ys = [...corners.map((c) => c.y), A.y];
    const x0 = Math.min(rect.x, ...xs) - 2;
    const y0 = Math.min(rect.y, ...ys) - 2;
    const x1 = Math.max(rect.x + rect.w, ...xs) + 2;
    const y1 = Math.max(rect.y + rect.h, ...ys) + 2;
    rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  return { subtype: SUBTYPE[m.type] ?? 'Square', ops, rect, extra, blend };
}

function clampToRect(from: Pt, to: Pt, r: Rect): Pt {
  const dx = to.x - from.x,
    dy = to.y - from.y;
  let t = 1;
  if (dx > 0) t = Math.min(t, (r.x + r.w - from.x) / dx);
  else if (dx < 0) t = Math.min(t, (r.x - from.x) / dx);
  if (dy > 0) t = Math.min(t, (r.y + r.h - from.y) / dy);
  else if (dy < 0) t = Math.min(t, (r.y - from.y) / dy);
  return { x: from.x + dx * t, y: from.y + dy * t };
}

const KEY_MARKUP = PDFName.of('PMS');
const KEY_PAGE = PDFName.of('PMSPage');
const KEY_REPLY = PDFName.of('PMSReply');
const KEY_LINE_STREAMS = PDFName.of('PMSLineStreams');

export interface DocState {
  markups: Markup[];
  calibrations: Record<number, Calibration>;
  sheets: Record<number, SheetMeta>;
  bookmarks: Bookmark[];
}

export async function writeAnnotations(
  doc: PDFDocument,
  markups: Markup[],
  calibrations: Record<number, Calibration> = {},
): Promise<void> {
  const ctx = doc.context;
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();
  for (const page of pages) {
    removeOwnAnnots(page);
    removeLineContent(page);
    setPageData(page, { lines: [] });
  }
  const numbers = numberMarkups(markups);
  const countNos = countNumbers(markups);
  const byPage = new Map<number, Markup[]>();
  for (const m of markups) byPage.set(m.page, [...(byPage.get(m.page) ?? []), m]);
  for (const [idx, list] of byPage) {
    const page = pages[idx];
    if (!page) continue;
    const maxZ = Math.max(-1, ...list.map((markup) => markup.zOrder ?? -1));
    const ordered = list.map((markup, index) => ({ markup, index, order: markup.zOrder ?? (maxZ >= 0 ? maxZ + 1 + index : index) }))
      .sort((a, b) => a.order - b.order || a.index - b.index)
      .map(({ markup }) => markup);
    const g = pageGeom(page);
    const lines = ordered.filter((m) => m.type === 'line');
    setPageData(page, { lines: lines.map((m) => ({ ...m, comments: [] })) });
    writeLineContent(page, g, lines);
    for (const m of ordered) {
      if (m.type === 'line') continue;
      const b = buildAppearance(
        m,
        g,
        calibrations[idx] ?? DEFAULT_CAL,
        numbers.get(m.id),
        countNos.get(m.id),
        (text, size) => boldFont.widthOfTextAtSize(text, size),
      );
      const opacity = m.type === 'm-area' || m.type === 'm-count' ? Math.max(0.5, m.opacity) : m.opacity;
      const gs = ctx.obj({ Type: 'ExtGState', CA: opacity, ca: opacity, ...(b.blend ? { BM: b.blend } : {}) });
      const gs1 = ctx.obj({ Type: 'ExtGState', CA: 1, ca: 1, BM: 'Normal' });
      const stampImage = m.type === 'stamp' && m.stampImage ? await doc.embedPng(m.stampImage.data) : undefined;
      const ap = ctx.stream('/GS0 gs\n' + b.ops, {
        Type: 'XObject',
        Subtype: 'Form',
        BBox: [f(b.rect.x), f(b.rect.y), f(b.rect.x + b.rect.w), f(b.rect.y + b.rect.h)],
        Resources: ctx.obj({ Font: { F1: font.ref, F2: boldFont.ref }, ExtGState: { GS0: gs, GS1: gs1 }, ...(stampImage ? { XObject: { StampImage: stampImage.ref } } : {}) }),
      });
      const apRef = ctx.register(ap);
      const dict: Record<string, unknown> = {
        Type: 'Annot',
        Subtype: b.subtype,
        Rect: [f(b.rect.x), f(b.rect.y), f(b.rect.x + b.rect.w), f(b.rect.y + b.rect.h)],
        F: 4,
        C: hex(m.color),
        CA: m.opacity,
        BS: { W: m.width, S: 'S' },
        AP: { N: apRef },
        ...b.extra,
      };
      if (m.type === 'cloud') dict.BE = { S: 'C', I: 2 };
      const annot = ctx.obj(dict as never) as unknown as PDFDict;
      if (isReviewMarkup(m)) annot.set(PDFName.of('Contents'), PDFHexString.fromText(contentsOf(m)));
      annot.set(PDFName.of('T'), PDFHexString.fromText(m.author));
      annot.set(PDFName.of('NM'), PDFString.of(m.id));
      annot.set(PDFName.of('Subj'), PDFHexString.fromText(m.subject || m.type));
      const d = pdfDate(m.date);
      if (d) annot.set(PDFName.of('M'), PDFString.of(d));
      annot.set(KEY_MARKUP, PDFHexString.fromText(JSON.stringify(m)));
      const parentRef = ctx.register(annot);
      if (!isReviewMarkup(m)) {
        page.node.addAnnot(parentRef);
        continue;
      }
      // One review item: the markup itself carries /Contents (text + thread), and a linked /Popup holds the comment window.
      const popup = ctx.obj({
        Type: 'Annot',
        Subtype: 'Popup',
        Rect: [f(b.rect.x + b.rect.w), f(b.rect.y + b.rect.h - 90), f(b.rect.x + b.rect.w + 180), f(b.rect.y + b.rect.h)],
        F: 28,
        Open: false,
        Parent: parentRef,
      } as never) as unknown as PDFDict;
      popup.set(KEY_REPLY, PDFString.of(m.id));
      const popupRef = ctx.register(popup);
      annot.set(PDFName.of('Popup'), popupRef);
      page.node.addAnnot(parentRef);
      page.node.addAnnot(popupRef);
    }
  }
  pages.forEach((page, i) => {
    const cal = calibrations[i];
    if (cal) setPageData(page, { cal });
  });
}

/** Removes the last app-generated drawing stream before it is regenerated on save. */
function removeLineContent(page: PDFPage) {
  const refs = page.node.lookupMaybe(KEY_LINE_STREAMS, PDFArray);
  const contents = page.node.Contents();
  if (refs && contents instanceof PDFArray) {
    const owned = new Set<string>();
    for (let i = 0; i < refs.size(); i++) {
      const ref = refs.get(i);
      if (ref instanceof PDFRef) owned.add(ref.toString());
    }
    for (let i = contents.size() - 1; i >= 0; i--) {
      const ref = contents.get(i);
      if (ref instanceof PDFRef && owned.has(ref.toString())) contents.remove(i);
    }
  }
  page.node.delete(KEY_LINE_STREAMS);
}

/** Removes our saved appearances only from a throwaway copy used for display. */
export async function pdfBytesForDisplay(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  let changed = false;
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    let hasOwn = false;
    if (annots) {
      for (let i = 0; i < annots.size(); i++) {
        const dict = annots.lookupMaybe(i, PDFDict);
        if (dict?.has(KEY_MARKUP) || dict?.has(KEY_REPLY)) {
          hasOwn = true;
          break;
        }
      }
    }
    if (hasOwn) {
      removeOwnAnnots(page);
      changed = true;
    }
    if (page.node.has(KEY_LINE_STREAMS)) {
      removeLineContent(page);
      changed = true;
    }
  }
  return changed ? doc.save() : bytes;
}

/** Plain line tools are PDF page content, not review annotations. */
function writeLineContent(page: PDFPage, g: PageGeom, lines: Markup[]) {
  const drawable = lines.filter((m) => m.points.length >= 2);
  if (!drawable.length) return;
  const initialContents = page.node.Contents();
  const existing = new Set<string>();
  const rawContents = page.node.get(PDFName.of('Contents'));
  if (rawContents instanceof PDFRef) existing.add(rawContents.toString());
  if (rawContents instanceof PDFArray) {
    for (let i = 0; i < rawContents.size(); i++) {
      const ref = rawContents.get(i);
      if (ref instanceof PDFRef) existing.add(ref.toString());
    }
  }
  if (initialContents instanceof PDFArray) {
    for (let i = 0; i < initialContents.size(); i++) {
      const ref = initialContents.get(i);
      if (ref instanceof PDFRef) existing.add(ref.toString());
    }
  }
  for (const m of drawable) {
    page.drawLine({
      start: viewToPdf(m.points[0], g),
      end: viewToPdf(m.points[1], g),
      thickness: m.width,
      color: rgb(...hex(m.color)),
      opacity: m.opacity,
    });
  }
  const contents = page.node.Contents();
  if (!(contents instanceof PDFArray)) {
    throw new Error('Could not persist plain line drawing content.');
  }
  const created: PDFRef[] = [];
  for (let i = 0; i < contents.size(); i++) {
    const ref = contents.get(i);
    if (ref instanceof PDFRef && !existing.has(ref.toString())) created.push(ref);
  }
  if (!created.length) throw new Error('Could not identify plain line drawing content.');
  page.node.set(KEY_LINE_STREAMS, page.doc.context.obj(created));
}

/** /Contents carries markup and comment text; author metadata remains in the saved markup state. */
export function contentsOf(m: Markup): string {
  const thread = m.comments.map((c) => c.text).join('\n');
  return [m.text ?? '', thread].filter(Boolean).join('\n\n');
}

function removeOwnAnnots(page: PDFPage) {
  const annots = page.node.Annots();
  if (!annots) return;
  const keep: PDFObject[] = [];
  for (let i = 0; i < annots.size(); i++) {
    const raw = annots.get(i);
    const d = annots.lookupMaybe(i, PDFDict);
    if (d?.has(KEY_MARKUP) || d?.has(KEY_REPLY)) continue;
    keep.push(raw);
  }
  page.node.set(PDFName.of('Annots'), page.doc.context.obj(keep));
}

function pageData(page: PDFPage): { cal?: Calibration; sheet?: SheetMeta; lines?: Markup[] } {
  const v = page.node.get(KEY_PAGE);
  const s = v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : undefined;
  try {
    return s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
}

function setPageData(page: PDFPage, patch: { cal?: Calibration; sheet?: SheetMeta; lines?: Markup[] }) {
  const merged = { ...pageData(page), ...patch };
  page.node.set(KEY_PAGE, PDFHexString.fromText(JSON.stringify(merged)));
}

export async function readState(doc: PDFDocument): Promise<DocState> {
  const markups: Markup[] = [];
  const calibrations: Record<number, Calibration> = {};
  const sheets: Record<number, SheetMeta> = {};
  doc.getPages().forEach((page, i) => {
    const annots = page.node.Annots();
    if (annots) {
      for (let k = 0; k < annots.size(); k++) {
        const d = annots.lookupMaybe(k, PDFDict);
        const v = d?.get(KEY_MARKUP);
        if (v instanceof PDFString || v instanceof PDFHexString) {
          try {
            const m = JSON.parse(v.decodeText()) as Markup;
            markups.push({ ...m, page: i, comments: m.comments ?? [] });
          } catch {
            /* skip unreadable annotation */
          }
        }
      }
    }
    const pd = pageData(page);
    if (pd.lines) markups.push(...pd.lines.map((m) => ({ ...m, page: i, comments: [] })));
    if (pd.cal) calibrations[i] = pd.cal;
    if (pd.sheet) sheets[i] = pd.sheet;
  });
  // Every markup and comment must have an ID that is unique within the document.
  const seen = new Set<string>();
  for (const m of markups) {
    if (!m.id || seen.has(m.id)) m.id = uid();
    seen.add(m.id);
    const cs = new Set<string>();
    for (const c of m.comments) {
      if (!c.id || cs.has(c.id)) c.id = uid();
      cs.add(c.id);
    }
  }
  return { markups, calibrations, sheets, bookmarks: readBookmarks(doc) };
}

export function writeSheets(doc: PDFDocument, sheets: Record<number, SheetMeta>) {
  doc.getPages().forEach((p, i) => sheets[i] && setPageData(p, { sheet: sheets[i] }));
}

/** Writes markups, calibration, sheet metadata and bookmarks, returning the saved PDF bytes. */
export async function saveWithState(bytes: Uint8Array, state: DocState): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  await writeAnnotations(doc, state.markups, state.calibrations);
  writeSheets(doc, state.sheets);
  writeBookmarks(doc, state.bookmarks);
  return doc.save();
}

export function writeBookmarks(doc: PDFDocument, bookmarks: Bookmark[]) {
  const ctx = doc.context;
  const pages = doc.getPages();
  const valid = bookmarks.filter((b) => pages[b.page]);
  if (!valid.length) {
    doc.catalog.delete(PDFName.of('Outlines'));
    return;
  }
  interface Node {
    b: Bookmark;
    ref: PDFRef;
    dict: PDFDict;
    kids: Node[];
  }
  const outlineRef = ctx.nextRef();
  const roots: Node[] = [];
  const stack: Node[] = [];
  for (const b of valid) {
    const dict = ctx.obj({}) as PDFDict;
    const node: Node = { b, ref: ctx.register(dict), dict, kids: [] };
    const level = Math.min(b.level, stack.length);
    stack.length = level;
    (level ? stack[level - 1].kids : roots).push(node);
    stack.push(node);
  }
  const count = (n: Node): number => 1 + n.kids.reduce((s, k) => s + count(k), 0);
  const link = (nodes: Node[], parent: PDFRef) => {
    nodes.forEach((n, i) => {
      n.dict.set(PDFName.of('Title'), PDFHexString.fromText(n.b.title));
      n.dict.set(PDFName.of('Parent'), parent);
      n.dict.set(PDFName.of('Dest'), ctx.obj([pages[n.b.page].ref, 'Fit']));
      if (i > 0) n.dict.set(PDFName.of('Prev'), nodes[i - 1].ref);
      if (i < nodes.length - 1) n.dict.set(PDFName.of('Next'), nodes[i + 1].ref);
      if (n.kids.length) {
        n.dict.set(PDFName.of('First'), n.kids[0].ref);
        n.dict.set(PDFName.of('Last'), n.kids[n.kids.length - 1].ref);
        n.dict.set(PDFName.of('Count'), PDFNumber.of(n.kids.reduce((s, k) => s + count(k), 0)));
        link(n.kids, n.ref);
      }
    });
  };
  link(roots, outlineRef);
  const outline = ctx.obj({
    Type: 'Outlines',
    First: roots[0].ref,
    Last: roots[roots.length - 1].ref,
    Count: roots.reduce((s, k) => s + count(k), 0),
  });
  ctx.assign(outlineRef, outline);
  doc.catalog.set(PDFName.of('Outlines'), outlineRef);
}

export function readBookmarks(doc: PDFDocument): Bookmark[] {
  const out: Bookmark[] = [];
  const pageRefs = doc.getPages().map((p) => p.ref.toString());
  const outlines = doc.catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict);
  if (!outlines) return out;
  const walk = (first: PDFDict | undefined, level: number) => {
    let cur = first;
    let guard = 0;
    while (cur && guard++ < 5000) {
      const t = cur.get(PDFName.of('Title'));
      const title = t instanceof PDFString || t instanceof PDFHexString ? t.decodeText() : 'Bookmark';
      let dest = cur.lookup(PDFName.of('Dest'));
      if (!dest) {
        const a = cur.lookupMaybe(PDFName.of('A'), PDFDict);
        dest = a?.lookup(PDFName.of('D'));
      }
      if (dest instanceof PDFArray) {
        const ref = dest.get(0);
        const idx = ref ? pageRefs.indexOf(ref.toString()) : -1;
        if (idx >= 0) out.push({ title, page: idx, level });
      }
      walk(cur.lookupMaybe(PDFName.of('First'), PDFDict), level + 1);
      cur = cur.lookupMaybe(PDFName.of('Next'), PDFDict);
    }
  };
  walk(outlines.lookupMaybe(PDFName.of('First'), PDFDict), 0);
  return out;
}
