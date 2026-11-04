import { PDFDocument } from 'pdf-lib';
import { DocState, readState } from '../core/annotations';
import { Bookmark, Calibration, Markup, MarkupType, Pt, SheetMeta, uid } from '../core/types';
import { PDFDocumentProxy, loadPdf } from '../pdf/pdfjs';

export interface Doc {
  id: string;
  name: string;
  path?: string;
  bytes: Uint8Array;
  pdf: PDFDocumentProxy;
  numPages: number;
  markups: Markup[];
  undo: Markup[][];
  redo: Markup[][];
  calibrations: Record<number, Calibration>;
  sheets: Record<number, SheetMeta>;
  bookmarks: Bookmark[];
  dirty: boolean;
  page: number;
  /** 0 = fit page on first display */
  zoom: number;
  textCache: Map<number, string>;
}

export const stateOf = (d: Doc): DocState => ({
  markups: d.markups,
  calibrations: d.calibrations,
  sheets: d.sheets,
  bookmarks: d.bookmarks,
});

export async function createDoc(name: string, bytes: Uint8Array, path?: string, dirty = false): Promise<Doc> {
  const pdf = await loadPdf(bytes);
  let st: DocState = { markups: [], calibrations: {}, sheets: {}, bookmarks: [] };
  try {
    st = await readState(await PDFDocument.load(bytes, { ignoreEncryption: true }));
  } catch {
    /* unreadable structure: view only */
  }
  return {
    id: uid(),
    name,
    path,
    bytes,
    pdf,
    numPages: pdf.numPages,
    ...st,
    undo: [],
    redo: [],
    dirty,
    page: 0,
    zoom: 0,
    textCache: new Map(),
  };
}

export type Tool = 'select' | 'hand' | 'calibrate' | MarkupType;

export interface Style {
  color: string;
  width: number;
  opacity: number;
  fill: boolean;
  fillColor: string;
  fontSize: number;
  stamp: string;
  subject: string;
}

const base: Style = {
  color: '#e53935',
  width: 2,
  opacity: 1,
  fill: false,
  fillColor: '#ffffff',
  fontSize: 12,
  stamp: 'APPROVED',
  subject: '',
};

export function defaultStyle(tool: Tool): Style {
  switch (tool) {
    case 'highlight':
      return { ...base, color: '#ffeb3b', opacity: 0.4 };
    case 'text':
    case 'callout':
      return { ...base, fill: true };
    case 'stamp':
      return { ...base, color: '#2e7d32', width: 3 };
    case 'm-area':
      return { ...base, color: '#00897b', opacity: 0.35 };
    case 'm-length':
    case 'm-polylength':
    case 'm-perimeter':
    case 'm-angle':
    case 'm-count':
      return { ...base, color: '#00897b' };
    default:
      return { ...base };
  }
}

export function makeMarkup(
  type: MarkupType,
  page: number,
  points: Pt[],
  style: Style,
  author: string,
  extra: Partial<Markup> = {},
): Markup {
  const m: Markup = {
    id: uid(),
    page,
    type,
    points,
    color: style.color,
    width: style.width,
    opacity: style.opacity,
    status: 'None',
    author,
    date: new Date().toISOString(),
    comments: [],
    ...extra,
  };
  if (type === 'text' || type === 'callout') {
    m.fontSize = style.fontSize;
    m.text = '';
  }
  if (type === 'note') m.text = '';
  if (type === 'stamp') m.stamp = style.stamp;
  if (style.fill && ['rect', 'ellipse', 'cloud', 'text', 'callout'].includes(type)) m.fill = style.fillColor;
  if (type.startsWith('m-') && style.subject.trim()) m.subject = style.subject.trim();
  return m;
}

export const TOOL_LABEL: Record<string, string> = {
  select: 'Select',
  hand: 'Pan',
  calibrate: 'Calibrate',
  highlight: 'Highlight',
  text: 'Text box',
  callout: 'Callout',
  cloud: 'Cloud',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  arrow: 'Arrow',
  polyline: 'Polyline',
  pen: 'Pen',
  stamp: 'Stamp',
  note: 'Note',
  'm-length': 'Length',
  'm-polylength': 'Polylength',
  'm-area': 'Area',
  'm-perimeter': 'Perimeter',
  'm-angle': 'Angle',
  'm-count': 'Count',
};

export function downloadName(name: string, suffix: string, ext = 'pdf') {
  return name.replace(/\.pdf$/i, '') + suffix + '.' + ext;
}

export async function pickFiles(): Promise<PickedFile[]> {
  return window.api ? window.api.openFiles() : [];
}

export async function saveBytes(name: string, data: Uint8Array | string, ext = 'pdf', path?: string) {
  if (window.api) {
    return window.api.saveFile({
      defaultName: name,
      data,
      path,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
  }
  const blob = new Blob([typeof data === 'string' ? data : (data as BlobPart)]);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  return name;
}
