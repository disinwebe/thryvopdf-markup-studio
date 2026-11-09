export interface Pt {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type MarkupType =
  | 'highlight'
  | 'text'
  | 'callout'
  | 'cloud'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'polyline'
  | 'pen'
  | 'stamp'
  | 'note'
  | 'm-length'
  | 'm-polylength'
  | 'm-area'
  | 'm-perimeter'
  | 'm-angle'
  | 'm-count';

export type Status = 'None' | 'Accepted' | 'Rejected' | 'Cancelled' | 'Completed' | 'Reviewed';
export const STATUSES: Status[] = ['None', 'Accepted', 'Rejected', 'Cancelled', 'Completed', 'Reviewed'];

export interface Comment {
  id: string;
  author: string;
  /** stamped by the app/server; ownership is checked against it when present */
  authorEmail?: string;
  date: string;
  text: string;
  edited?: string;
  /** Optional per-comment appearance override; absent uses the device's default comment size. */
  fontSize?: number;
}

export interface Markup {
  id: string;
  /** zero-based page index */
  page: number;
  type: MarkupType;
  /** points in page space: viewport at scale 1 (origin top-left, y down) */
  points: Pt[];
  color: string;
  fill?: string;
  width: number;
  opacity: number;
  text?: string;
  fontSize?: number;
  stamp?: string;
  /** Embedded PNG, independent of the source file path. */
  stampImage?: import('./stamp').StampImage;
  status: Status;
  author: string;
  /** stamped when created; deletion is limited to the author */
  authorEmail?: string;
  date: string;
  subject?: string;
  comments: Comment[];
  /** Text size for this review annotation's comment callout. */
  commentSize?: number;
  /** top-left of the movable comment box, page space; default is placed beside the markup */
  callout?: Pt;
  /** Per-annotation callout dimensions in page coordinates. */
  calloutSize?: { width: number; height: number };
  /** Hide the drawing callout without deleting the review thread. */
  calloutHidden?: boolean;
}

export type Unit = 'ft' | 'in' | 'm' | 'mm';
export const UNITS: Unit[] = ['ft', 'in', 'm', 'mm'];

export interface Calibration {
  unit: Unit;
  /** real-world units per PDF point */
  unitsPerPoint: number;
  calibrated: boolean;
}

export interface SheetMeta {
  number: string;
  title: string;
  discipline: string;
  revision: string;
}

export interface Bookmark {
  title: string;
  page: number;
  level: number;
}

export const MEASURE_TYPES: MarkupType[] = [
  'm-length',
  'm-polylength',
  'm-area',
  'm-perimeter',
  'm-angle',
  'm-count',
];
export const isMeasure = (t: MarkupType) => t.startsWith('m-');

export const BOX_TYPES: MarkupType[] = ['highlight', 'text', 'callout', 'cloud', 'rect', 'ellipse', 'stamp'];

export const STAMPS = ['APPROVED', 'REJECTED', 'DRAFT', 'FOR REVIEW', 'REVISED', 'VOID', 'CONFIDENTIAL', 'AS BUILT'];

export const uid = () => {
  const b = new Uint32Array(2);
  (globalThis.crypto ?? { getRandomValues: (a: Uint32Array) => a.map(() => Math.random() * 2 ** 32) }).getRandomValues(b);
  return b[0].toString(36) + b[1].toString(36) + Date.now().toString(36).slice(-3);
};

export const DISCIPLINE_LIST = ['General', 'Architectural', 'Structural', 'Civil', 'Mechanical', 'Electrical', 'Plumbing', 'Fire Protection', 'Landscape', 'Interior'];
