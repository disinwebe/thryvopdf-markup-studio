import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Raster } from '../core/compare';
import { pdfBytesForDisplay } from '../core/annotations';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy, PDFPageProxy };

export async function loadPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  let displayBytes = bytes;
  try {
    displayBytes = await pdfBytesForDisplay(bytes);
  } catch (error) {
    console.warn('Could not prepare PDF annotation display; using the original PDF.', error);
  }
  return pdfjs.getDocument({ data: displayBytes.slice() }).promise;
}

export interface PdfComment {
  id: string;
  subtype: string;
  author: string;
  text: string;
}

/** Returns standard PDF comments, excluding duplicate popup entries. */
export async function pagePdfComments(pdf: PDFDocumentProxy, index: number): Promise<PdfComment[]> {
  const page = await pdf.getPage(index + 1);
  const annotations = await page.getAnnotations({ intent: 'display' });
  const popupIds = new Set(annotations.map((a) => a.popupRef).filter(Boolean));
  return annotations
    .filter((a) => !(a.annotationFlags & 34) && !(a.subtype === 'Popup' && popupIds.has(a.id)))
    .map((a) => ({
      id: a.id,
      subtype: a.subtype || 'Annotation',
      author: a.titleObj?.str || '',
      text: a.contentsObj?.str || '',
    }))
    .filter((a) => a.text.trim().length > 0);
}

export async function pageSize(pdf: PDFDocumentProxy, index: number) {
  const page = await pdf.getPage(index + 1);
  const v = page.getViewport({ scale: 1 });
  return { w: v.width, h: v.height };
}

export async function renderToCanvas(
  pdf: PDFDocumentProxy,
  index: number,
  scale: number,
  canvas: HTMLCanvasElement,
): Promise<RenderTask> {
  const page = await pdf.getPage(index + 1);
  const viewport = page.getViewport({ scale });
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return page.render({
    canvasContext: ctx,
    viewport,
    annotationMode: pdfjs.AnnotationMode.ENABLE,
  });
}

/** Renders a page scaled to fit inside w x h (letterboxed on white) and returns raw pixels. */
export async function renderRaster(
  pdf: PDFDocumentProxy,
  index: number,
  w: number,
  h: number,
): Promise<{ raster: Raster; canvas: HTMLCanvasElement }> {
  const page = await pdf.getPage(index + 1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(w / base.width, h / base.height);
  const viewport = page.getViewport({ scale, offsetX: (w - base.width * scale) / 2, offsetY: (h - base.height * scale) / 2 });
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  await page.render({ canvasContext: ctx, viewport, annotationMode: pdfjs.AnnotationMode.ENABLE }).promise;
  const img = ctx.getImageData(0, 0, w, h);
  return { raster: { data: img.data, width: w, height: h }, canvas };
}

export async function pageText(pdf: PDFDocumentProxy, index: number): Promise<string> {
  const page = await pdf.getPage(index + 1);
  const tc = await page.getTextContent();
  return tc.items.map((i) => ('str' in i ? i.str : '')).join(' ');
}

export interface SearchHit {
  page: number;
  snippet: string;
}

export async function searchDoc(
  pdf: PDFDocumentProxy,
  query: string,
  cache?: Map<number, string>,
): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (let i = 0; i < pdf.numPages; i++) {
    let t = cache?.get(i);
    if (t === undefined) {
      t = await pageText(pdf, i);
      cache?.set(i, t);
    }
    const at = t.toLowerCase().indexOf(q);
    if (at >= 0) hits.push({ page: i, snippet: t.slice(Math.max(0, at - 30), at + q.length + 40).trim() });
  }
  return hits;
}
