import { dist } from './geometry';
import { Calibration, Markup, Pt, Unit } from './types';

export const UNIT_TO_M: Record<Unit, number> = { ft: 0.3048, in: 0.0254, m: 1, mm: 0.001 };

/** Default (uncalibrated) scale: 1 PDF point = 1/72 inch of paper. */
export const DEFAULT_CAL: Calibration = { unit: 'in', unitsPerPoint: 1 / 72, calibrated: false };

export const convertLength = (v: number, from: Unit, to: Unit) => (v * UNIT_TO_M[from]) / UNIT_TO_M[to];
export const convertArea = (v: number, from: Unit, to: Unit) => v * (UNIT_TO_M[from] / UNIT_TO_M[to]) ** 2;

export function pathLength(pts: Pt[], closed = false): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  if (closed && pts.length > 2) l += dist(pts[pts.length - 1], pts[0]);
  return l;
}

export function polygonArea(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i],
      b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

/** Interior angle in degrees at `vertex` between rays to a and c. */
export function angleDeg(a: Pt, vertex: Pt, c: Pt): number {
  const v1 = { x: a.x - vertex.x, y: a.y - vertex.y };
  const v2 = { x: c.x - vertex.x, y: c.y - vertex.y };
  const l = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (l === 0) return 0;
  const cos = Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / l));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Calibrate from two points and a known real distance. */
export function calibrateFromDistance(a: Pt, b: Pt, realDistance: number, unit: Unit): Calibration {
  const d = dist(a, b);
  if (d <= 0 || !(realDistance > 0)) throw new Error('Invalid calibration distance');
  return { unit, unitsPerPoint: realDistance / d, calibrated: true };
}

/** Calibrate from a drawing scale: 1 paper inch represents `real` units. */
export function calibrateFromScale(paperInches: number, real: number, unit: Unit): Calibration {
  if (!(paperInches > 0) || !(real > 0)) throw new Error('Invalid scale');
  return { unit, unitsPerPoint: real / (paperInches * 72), calibrated: true };
}

export type MeasureKind = 'length' | 'area' | 'perimeter' | 'angle' | 'count';

export interface Measurement {
  kind: MeasureKind;
  value: number;
  unit: string;
  /** perimeter for area measurements */
  perimeter?: number;
}

export function countNumbers(markups: Pick<Markup, 'id' | 'type' | 'subject'>[]): Map<string, number> {
  const map = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const m of markups) {
    if (m.type !== 'm-count') continue;
    const subject = m.subject || 'Count';
    const count = (counts.get(subject) ?? 0) + 1;
    counts.set(subject, count);
    map.set(m.id, count);
  }
  return map;
}

export function measure(m: Markup, cal: Calibration = DEFAULT_CAL): Measurement | null {
  const k = cal.unitsPerPoint;
  switch (m.type) {
    case 'm-length':
    case 'm-polylength':
      return { kind: 'length', value: pathLength(m.points) * k, unit: cal.unit };
    case 'm-perimeter':
      return { kind: 'perimeter', value: pathLength(m.points, true) * k, unit: cal.unit };
    case 'm-area':
      return {
        kind: 'area',
        value: polygonArea(m.points) * k * k,
        unit: cal.unit + '²',
        perimeter: pathLength(m.points, true) * k,
      };
    case 'm-angle':
      return m.points.length >= 3
        ? { kind: 'angle', value: angleDeg(m.points[0], m.points[1], m.points[2]), unit: '°' }
        : null;
    case 'm-count':
      return { kind: 'count', value: 1, unit: 'ea' };
    default:
      return null;
  }
}

export function formatValue(v: number, unit: string): string {
  if (unit === 'ea') return String(Math.round(v));
  const digits = unit === '°' ? 1 : unit === 'mm' ? 0 : 2;
  return `${v.toFixed(digits)} ${unit}`;
}

export function formatFeetInches(feet: number): string {
  const sign = feet < 0 ? '-' : '';
  let totalIn = Math.round(Math.abs(feet) * 12 * 16) / 16;
  const ft = Math.floor(totalIn / 12);
  totalIn -= ft * 12;
  return `${sign}${ft}' ${totalIn.toFixed(totalIn % 1 ? 2 : 0)}"`;
}

export function measureLabel(m: Markup, cal: Calibration = DEFAULT_CAL): string {
  const r = measure(m, cal);
  if (!r || r.kind === 'count') return '';
  const base = formatValue(r.value, r.unit);
  return cal.calibrated || r.kind === 'angle' ? base : base + ' (uncal.)';
}

export interface TakeoffRow {
  subject: string;
  kind: MeasureKind;
  count: number;
  total: number;
  unit: string;
}

/** Unit used when summing across pages that may have different calibrations. */
export function takeoffSummary(
  markups: Markup[],
  cals: (page: number) => Calibration,
  outUnit: Unit = 'ft',
): TakeoffRow[] {
  const rows = new Map<string, TakeoffRow>();
  for (const m of markups) {
    const cal = cals(m.page);
    const r = measure(m, cal);
    if (!r) continue;
    let value = r.value;
    let unit = r.unit;
    if (r.kind === 'length' || r.kind === 'perimeter') {
      value = convertLength(r.value, cal.unit, outUnit);
      unit = outUnit;
    } else if (r.kind === 'area') {
      value = convertArea(r.value, cal.unit, outUnit);
      unit = outUnit + '²';
    }
    const subject = m.subject?.trim() || defaultSubject(m);
    const key = `${subject}|${r.kind}`;
    const row = rows.get(key) ?? { subject, kind: r.kind, count: 0, total: 0, unit };
    row.count += 1;
    row.total += value;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => a.subject.localeCompare(b.subject) || a.kind.localeCompare(b.kind));
}

export function defaultSubject(m: Pick<Markup, 'type'>): string {
  switch (m.type) {
    case 'm-length':
      return 'Length';
    case 'm-polylength':
      return 'Polylength';
    case 'm-area':
      return 'Area';
    case 'm-perimeter':
      return 'Perimeter';
    case 'm-angle':
      return 'Angle';
    case 'm-count':
      return 'Count';
    default:
      return m.type;
  }
}

export function csvEscape(v: unknown): string {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n';

export function formatTakeoffDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function takeoffCsv(markups: Markup[], cals: (page: number) => Calibration, outUnit: Unit = 'ft'): string {
  const rows: unknown[][] = [['Takeoff summary'], ['Subject', 'Type', 'Items', 'Total', 'Unit']];
  for (const r of takeoffSummary(markups, cals, outUnit))
    rows.push([r.subject, r.kind, r.count, r.kind === 'count' ? r.count : +r.total.toFixed(3), r.unit]);
  rows.push([], ['Measurement details'], ['Page', 'Subject', 'Type', 'Value', 'Unit', 'Perimeter', 'Author', 'Date']);
  for (const m of markups) {
    const r = measure(m, cals(m.page));
    if (!r) continue;
    rows.push([
      m.page + 1,
      m.subject || defaultSubject(m),
      r.kind,
      +r.value.toFixed(3),
      r.unit,
      r.perimeter !== undefined ? +r.perimeter.toFixed(3) : '',
      m.author,
      formatTakeoffDate(m.date),
    ]);
  }
  return toCsv(rows);
}
