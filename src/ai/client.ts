// Renderer-side helpers: page images/text for Gemini, sent through the Electron main process.
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { pageText } from '../pdf/pdfjs';

export interface PageImage {
  part: AiPart;
  /** page size in page space (viewport at scale 1), used to map boxes back onto the page */
  pageW: number;
  pageH: number;
}

/** Renders a page as JPEG, long edge `maxPx`, in the same orientation the viewer shows. */
export async function pageImage(pdf: PDFDocumentProxy, index: number, maxPx = 2000, quality = 0.85): Promise<PageImage> {
  const page = await pdf.getPage(index + 1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(4, maxPx / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, annotationMode: pdfjs.AnnotationMode.ENABLE }).promise;
  const data = canvas.toDataURL('image/jpeg', quality).split(',')[1] ?? '';
  canvas.width = canvas.height = 0;
  return { part: { image: { mimeType: 'image/jpeg', data } }, pageW: base.width, pageH: base.height };
}

export async function cachedText(pdf: PDFDocumentProxy, index: number, cache?: Map<number, string>): Promise<string> {
  let t = cache?.get(index);
  if (t === undefined) {
    t = await pageText(pdf, index);
    cache?.set(index, t);
  }
  return t;
}

export async function ask(args: { parts: AiPart[]; system?: string; json?: boolean; temperature?: number }): Promise<string> {
  const api = window.api;
  if (!api?.aiGenerate) throw new Error('The AI Assistant is only available in the desktop app.');
  const r = await api.aiGenerate(args);
  if (!r.ok) throw new Error(r.error);
  return r.text;
}

/** Runs `fn` over items one at a time, reporting progress and stopping when `cancelled()` turns true. */
export async function eachPage<T>(
  items: T[],
  fn: (item: T, i: number) => Promise<void>,
  progress: (done: number, total: number) => void,
  cancelled: () => boolean,
): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    if (cancelled()) return;
    progress(i, items.length);
    await fn(items[i], i);
  }
  progress(items.length, items.length);
}
