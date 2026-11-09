import { createCanvas, Path2D } from '@napi-rs/canvas';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { AnnotationMode, getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import { describe, expect, it } from 'vitest';
import { loadPdf, pagePdfComments, renderToCanvas } from '../src/pdf/pdfjs';
import { readState, saveWithState } from '../src/core/annotations';
import type { Markup } from '../src/core/types';

GlobalWorkerOptions.workerSrc = pathToFileURL(createRequire(import.meta.url).resolve('pdfjs-dist/build/pdf.worker.min.mjs')).href;
globalThis.Path2D = Path2D as unknown as typeof globalThis.Path2D;
const standardFontDataUrl = join(dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')), 'standard_fonts') + sep;

describe('imported PDF annotations', () => {
  it('renders standard annotation appearances without changing the imported PDF bytes', async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([300, 300]);
    const context = source.context;
    const appearance = context.stream('1 0 0 rg 0 0 100 60 re f', {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [0, 0, 100, 60],
      Resources: {},
    });
    const appearanceRef = context.register(appearance);
    const annotation = context.obj({
      Type: 'Annot',
      Subtype: 'Square',
      Rect: [40, 50, 140, 110],
      F: 4,
      NM: PDFString.of('foreign-square'),
      AP: { N: appearanceRef },
    }) as PDFDict;
    page.node.addAnnot(context.register(annotation));

    const bytes = await source.save();
    const originalBytes = bytes.slice();
    const pdf = await loadPdf(bytes);
    const canvas = createCanvas(300, 300);
    try {
      const task = await renderToCanvas(pdf, 0, 1, canvas as unknown as HTMLCanvasElement);
      await task.promise;

      const ctx = canvas.getContext('2d');
      const pixel = ctx.getImageData(60, 210, 1, 1).data;
      expect(pixel[0]).toBeGreaterThan(200);
      expect(pixel[1]).toBeLessThan(80);
      expect(pixel[2]).toBeLessThan(80);
      expect(bytes).toEqual(originalBytes);

      const reopened = await PDFDocument.load(bytes);
      const annots = reopened.getPages()[0].node.Annots() as PDFArray;
      expect(annots.size()).toBe(1);
      expect(annots.lookup(0, PDFDict).lookup(PDFName.of('NM'), PDFString).decodeText()).toBe('foreign-square');
    } finally {
      await pdf.destroy();
    }
  });

  it('displays foreign comments without duplicating linked popups, and removes only app-owned display content', async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([300, 300]);
    const ctx = source.context;
    const parent = ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 30, 30], Contents: PDFString.of('External comment'), T: PDFString.of('Reviewer'), F: 4 }) as PDFDict;
    const parentRef = ctx.register(parent);
    const popup = ctx.obj({ Type: 'Annot', Subtype: 'Popup', Parent: parentRef, Rect: [30, 30, 130, 130], F: 4 });
    const popupRef = ctx.register(popup);
    parent.set(PDFName.of('Popup'), popupRef);
    page.node.addAnnot(parentRef);
    page.node.addAnnot(popupRef);
    const markup: Markup = {
      id: 'own', page: 0, type: 'rect', points: [{ x: 100, y: 80 }, { x: 160, y: 120 }],
      color: '#ff0000', width: 4, opacity: 1, status: 'None', author: 'Me',
      date: '2026-01-01', comments: [{ id: 'c', author: 'Me', date: '2026-01-01', text: 'Own comment' }],
    };
    const line: Markup = { ...markup, id: 'line', type: 'line', points: [{ x: 180, y: 40 }, { x: 240, y: 40 }], comments: [] };
    const bytes = await saveWithState(await source.save(), { markups: [markup, line], calibrations: {}, sheets: {}, bookmarks: [] });
    const before = bytes.slice();
    const original = await getDocument({ data: bytes.slice(), standardFontDataUrl }).promise;
    try {
      const originalPage = await original.getPage(1);
      const canvas = createCanvas(300, 300);
      await originalPage.render({
        canvasContext: canvas.getContext('2d') as unknown as CanvasRenderingContext2D,
        viewport: originalPage.getViewport({ scale: 1 }),
        annotationMode: AnnotationMode.ENABLE,
      }).promise;
      const image = canvas.getContext('2d').getImageData(0, 0, 300, 300).data;
      const isRed = (x: number, y: number) => {
        const i = (y * 300 + x) * 4;
        return image[i] > 170 && image[i + 1] < 100 && image[i + 2] < 100;
      };
      expect(isRed(100, 100)).toBe(true);
      expect(isRed(200, 40)).toBe(true);
    } finally {
      await original.destroy();
    }
    const pdf = await loadPdf(bytes);
    try {
      expect(await pagePdfComments(pdf, 0)).toEqual([{ id: expect.any(String), subtype: 'Text', author: 'Reviewer', text: 'External comment' }]);
      const annotations = await (await pdf.getPage(1)).getAnnotations();
      expect(annotations.some((a) => a.contentsObj?.str?.includes('Own comment'))).toBe(false);
      const canvas = createCanvas(300, 300);
      await (await renderToCanvas(pdf, 0, 1, canvas as unknown as HTMLCanvasElement)).promise;
      const image = canvas.getContext('2d').getImageData(0, 0, 300, 300).data;
      const red = (x: number, y: number) => {
        const i = (y * 300 + x) * 4;
        return image[i] > 170 && image[i + 1] < 100 && image[i + 2] < 100;
      };
      expect(red(100, 100)).toBe(false);
      expect(red(200, 40)).toBe(false);
      expect(bytes).toEqual(before);
      expect((await readState(await PDFDocument.load(bytes))).markups.map((m) => m.id).sort()).toEqual(['line', 'own']);
    } finally {
      await pdf.destroy();
    }

    for (const markups of [
      [{ ...markup, points: [{ x: 180, y: 80 }, { x: 240, y: 120 }] }, line],
      [],
    ]) {
      const updated = await saveWithState(bytes, { markups, calibrations: {}, sheets: {}, bookmarks: [] });
      const reopened = await loadPdf(updated);
      try {
        expect((await pagePdfComments(reopened, 0)).map((c) => c.text)).toEqual(['External comment']);
        const canvas = createCanvas(300, 300);
        await (await renderToCanvas(reopened, 0, 1, canvas as unknown as HTMLCanvasElement)).promise;
        const image = canvas.getContext('2d').getImageData(0, 0, 300, 300).data;
        for (const [x, y] of [[100, 100], [180, 100], [200, 40]]) {
          const i = (y * 300 + x) * 4;
          expect(image[i + 1], `stale or duplicate markup at ${x},${y}`).toBeGreaterThan(200);
        }
      } finally {
        await reopened.destroy();
      }
    }
  });
});
