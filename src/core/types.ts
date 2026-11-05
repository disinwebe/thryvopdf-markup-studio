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
  date: string;
  text: string;
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
  status: Status;
  author: string;
  date: string;
  subject?: string;
  comments: Comment[];
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

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const DISCIPLINE_LIST = ['General', 'Architectural', 'Structural', 'Civil', 'Mechanical', 'Electrical', 'Plumbing', 'Fire Protection', 'Landscape', 'Interior'];
