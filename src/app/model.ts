import { PDFDocument } from 'pdf-lib';
import type { PageObject } from '../core/pageContent';
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
  pageObjects: PageObject[];
  undo: Markup[][];
  redo: Markup[][];
  calibrations: Record<number, Calibration>;
  sheets: Record<number, SheetMeta>;
  bookmarks: Bookmark[];
  dirty: boolean;
  page: number;
  /** 0 = fit page on first display */
  zoom: number;
  viewport: { left: number; top: number };
  textCache: Map<number, string>;
  /** Present when this tab is a copy of a document hosted on the server. */
  shared?: SharedInfo;
}

export interface Collaborator {
  name: string;
  email: string;
  discipline?: string;
}

export interface SharedInfo {
  id: string;
  version: number;
  pr: number;
  /** JSON of each markup as last known to the server, used to detect local changes. */
  synced: Record<string, string>;
  collaborators: Collaborator[];
  status: 'live' | 'offline' | 'expired';
  error?: string;
}

export function renamedTab(d: Pick<Doc, 'name' | 'shared'>, name: string): string | null {
  const trimmed = name.trim();
  return d.shared || !trimmed || /[\\/:*?"<>|]/.test(trimmed) ? null : trimmed;
}

export function documentZoomKey(doc: { name: string; path?: string; shared?: { id: string } }): string {
  if (doc.shared) return `shared:${doc.shared.id}`;
  if (doc.path) return `file:${doc.path.toLowerCase()}`;
  return `name:${doc.name.toLowerCase()}`;
}

type ZoomStore = Pick<Storage, 'getItem' | 'setItem'>;
const zoomStorageKey = (key: string) => `thryvopdf-document-zoom-v1:${key}`;
const getZoomStore = (): ZoomStore | null => {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
};

export function loadDocumentZoom(key: string, storage: ZoomStore | null = getZoomStore()): number {
  if (!storage) return 0;
  try {
    const zoom = Number(storage.getItem(zoomStorageKey(key)));
    return Number.isFinite(zoom) && zoom >= 0.05 && zoom <= 8 ? zoom : 0;
  } catch {
    return 0;
  }
}

export function initialDocumentZoom(key: string, fitPage: boolean, storage: ZoomStore | null = getZoomStore()): number {
  return fitPage ? 0 : loadDocumentZoom(key, storage);
}

export function saveDocumentZoom(key: string, zoom: number, storage: ZoomStore | null = getZoomStore()): void {
  if (!storage || !Number.isFinite(zoom) || zoom < 0.05 || zoom > 8) return;
  try { storage.setItem(zoomStorageKey(key), String(zoom)); } catch { /* zoom remains session-only when storage is unavailable */ }
}

export const stateOf = (d: Doc): DocState => ({
  markups: d.markups,
  calibrations: d.calibrations,
  sheets: d.sheets,
  bookmarks: d.bookmarks,
});

export async function createDoc(name: string, bytes: Uint8Array, path?: string, dirty = false, options: { fitPage?: boolean } = {}): Promise<Doc> {
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
    pageObjects: [],
    undo: [],
    redo: [],
    dirty,
    page: 0,
    zoom: initialDocumentZoom(documentZoomKey({ name, path }), options.fitPage === true),
    viewport: { left: 0, top: 0 },
    textCache: new Map(),
  };
}

export type Tool = 'select' | 'hand' | 'calibrate' | MarkupType;

export function shouldResetMeasurementSubject(previous: Tool | null, next: Tool): boolean {
  return !!previous && previous !== next && previous.startsWith('m-') && next.startsWith('m-');
}

export interface Style {
  color: string;
  width: number;
  opacity: number;
  fill: boolean;
  fillColor: string;
  fontSize: number;
  stamp: string;
  stampImage?: import('../core/stamp').StampImage;
  stampLockAspectRatio?: boolean;
  image?: import('../core/stamp').StampImage;
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
    case 'm-spline':
    case 'm-radius':
    case 'm-diameter':
    case 'm-perimeter':
    case 'm-angle':
    case 'm-count':
      return { ...base, color: '#00897b' };
    default:
      return { ...base };
  }
}

export function toolStyle(tool: Tool, custom: Partial<Style> | undefined, defaults: Partial<Pick<Style, 'color' | 'width' | 'opacity'>>, subject = ''): Style {
  return { ...defaultStyle(tool), ...custom, ...defaults, subject };
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
  if (type === 'stamp') {
    m.stamp = style.stamp;
    if (style.stampImage) {
      m.stampImage = style.stampImage;
      m.stampLockAspectRatio = style.stampLockAspectRatio !== false;
    }
  }
  if (type === 'image' && style.image) {
    m.image = style.image;
    m.imageLockAspectRatio = true;
  }
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
  image: 'Image',
  note: 'Note',
  'm-length': 'Length',
  'm-polylength': 'Polylength',
  'm-spline': 'Spline',
  'm-radius': 'Radius',
  'm-diameter': 'Diameter',
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
