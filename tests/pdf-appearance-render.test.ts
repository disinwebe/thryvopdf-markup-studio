import { createCanvas } from '@napi-rs/canvas';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { degrees, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { AnnotationMode, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { readState, saveWithState } from '../src/core/annotations';
import { CALLOUT_PAD, calloutLayout, calloutTextRuns } from '../src/core/callout';
import type { Markup, MarkupType } from '../src/core/types';

const review: Markup = {
  id: 'review', type: 'highlight', page: 0,
  points: [{ x: 40, y: 40 }, { x: 100, y: 65 }],
  color: '#202020', width: 2, opacity: 0.3, status: 'None', author: 'A',
  date: '2026-01-02T00:00:00Z', callout: { x: 130, y: 80 },
  comments: [{ id: 'c', author: 'B', date: '2026-01-02', text: 'Review text' }],
};
const stamp: Markup = {
  ...review, id: 'stamp', type: 'stamp', date: '2026-01-01T00:00:00Z',
  points: [{ x: 30, y: 195 }, { x: 110, y: 225 }], stamp: 'APPROVED',
};
const standardFontDataUrl = join(dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')), 'standard_fonts') + sep;

function pixels(ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>, x: number, y: number, w: number, h: number, test: (r: number, g: number, b: number) => boolean) {
  const data = ctx.getImageData(x, y, w, h).data;
  let count = 0;
  for (let i = 0; i < data.length; i += 4) if (test(data[i], data[i + 1], data[i + 2])) count++;
  return count;
}

describe('saved PDF annotation appearances', () => {
  it('rasterizes all shared-layout comment text runs at their viewer baselines', async () => {
    const markup: Markup = { ...review, comments: [
      { id: '1', author: 'Alice', text: 'First review', date: '2026-01-01', fontSize: 18 },
      { id: '2', author: 'Bob', text: 'Second review', date: '2026-01-02', fontSize: 7 },
    ] };
    const source = await PDFDocument.create();
    source.addPage([460, 360]);
    const saved = await saveWithState(await source.save(), { markups: [markup], calibrations: {}, sheets: {}, bookmarks: [] });
    const pdf = await getDocument({ data: saved, standardFontDataUrl }).promise;
    try {
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = createCanvas(viewport.width, viewport.height);
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport, annotationMode: AnnotationMode.ENABLE }).promise;
      for (const run of calloutTextRuns(calloutLayout(markup)!, 1)) {
        const x = Math.floor(run.x * 2);
        const y = Math.floor((run.y - run.size) * 2);
        const w = Math.ceil(Math.min(run.text.length * run.size * 0.7, 100) * 2);
        const h = Math.ceil(run.size * 2);
        const ink = run.kind === 'body' ? (r: number, g: number, b: number) => r < 100 && g < 100 && b < 100 : (r: number, g: number, b: number) => r > 100 && g < 120 && b < 140;
        expect(pixels(ctx, x, y, w, h, ink), run.text).toBeGreaterThan(2);
      }
    } finally {
      await pdf.destroy();
    }
  });
  it('renders the comment author beside the saved PDF comment number', async () => {
    const source = await PDFDocument.create();
    source.addPage([460, 360]);
    const saved = await saveWithState(await source.save(), { markups: [review], calibrations: {}, sheets: {}, bookmarks: [] });
    const pdf = await getDocument({ data: saved, standardFontDataUrl }).promise;
    try {
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 1 });
      const canvas = createCanvas(viewport.width, viewport.height);
      const ctx = canvas.getContext('2d');
      await page.render({
        canvasContext: ctx as unknown as CanvasRenderingContext2D,
        viewport,
        annotationMode: AnnotationMode.ENABLE,
      }).promise;
      const box = calloutLayout(review)!;
      const rose = (r: number, g: number, b: number) => r > 100 && g < 100 && b < 130;
      const authorX = box.x + CALLOUT_PAD;
      const authorY = box.y + CALLOUT_PAD + box.fs * 0.2;
      expect(pixels(ctx, authorX, authorY, 24, 14, rose)).toBeGreaterThan(0);
    } finally {
      await pdf.destroy();
    }
  });

  for (const rotation of [0, 90, 180, 270]) {
    it(`renders the comment ID, leader and bordered box without an extra markup-corner ID after reopening (${rotation} degrees)`, async () => {
      const source = await PDFDocument.create();
      const sourcePage = source.addPage([460, 360]);
      sourcePage.setCropBox(20, 30, 400, 300);
      sourcePage.setRotation(degrees(rotation));
      const saved = await saveWithState(await source.save(), { markups: [stamp, review], calibrations: {}, sheets: {}, bookmarks: [] });
      const pdf = await getDocument({ data: saved, standardFontDataUrl }).promise;
      try {
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1 });
        const canvas = createCanvas(viewport.width, viewport.height);
        const ctx = canvas.getContext('2d');
        await page.render({
          canvasContext: ctx as unknown as CanvasRenderingContext2D,
          viewport,
          annotationMode: AnnotationMode.ENABLE,
        }).promise;
        const red = (r: number, g: number, b: number) => r > 170 && g < 130 && b < 140;
        const box = calloutLayout(review)!;
        expect(pixels(ctx, 32, 32, 16, 16, red)).toBe(0);
        expect(pixels(ctx, box.x, box.y - 1, box.w, 3, red)).toBeGreaterThan(box.w * 0.8);
        expect(pixels(ctx, box.x, Math.round(box.y + box.h) - 1, box.w, 3, red)).toBeGreaterThan(box.w * 0.8);
        expect(pixels(ctx, box.x - 1, box.y, 3, Math.floor(box.h), red)).toBeGreaterThan(box.h * 0.8);
        expect(pixels(ctx, box.x + box.w - 1, box.y, 3, Math.floor(box.h), red)).toBeGreaterThan(box.h * 0.8);
        expect(pixels(ctx, 100, 64, 30, 20, red)).toBeGreaterThan(10);
        expect(pixels(ctx, 22, 187, 16, 16, red)).toBe(0);
      } finally {
        await pdf.destroy();
      }
    });
  }

  it('keeps mixed review IDs and borders visible alongside an intact image stamp on the same saved page', async () => {
        const source = await PDFDocument.create();
        source.addPage([900, 600]);
        const image = createCanvas(8, 8);
        const imageCtx = image.getContext('2d');
        imageCtx.fillStyle = '#0055cc';
        imageCtx.fillRect(0, 0, 8, 8);
        const shapes: MarkupType[] = ['cloud', 'arrow', 'highlight', 'rect', 'text', 'note'];
        const markups = shapes.map((type, i): Markup => {
          const x = 30 + (i % 3) * 280;
          const y = 40 + Math.floor(i / 3) * 190;
          return {
            ...review, id: `mixed-${i}`, type, color: '#202020', opacity: type === 'highlight' ? 0.3 : 1,
            points: type === 'note' ? [{ x, y }] : [{ x, y }, { x: x + 60, y: y + 30 }],
            callout: { x: x + 95, y: y + 15 },
            text: type === 'text' ? 'Markup text' : undefined,
          };
        });
        const imageStamp: Markup = {
          ...stamp, id: 'mixed-stamp', opacity: 1, points: [{ x: 30, y: 450 }, { x: 130, y: 490 }],
          stampImage: { data: image.toDataURL('image/png'), width: 8, height: 8 },
        };
        const bytes = await saveWithState(await source.save(), { markups: [imageStamp, ...markups], calibrations: {}, sheets: {}, bookmarks: [] });
        const reopened = await PDFDocument.load(bytes);
        const annots = reopened.getPages()[0].node.Annots() as PDFArray;
        for (let i = 0; i < markups.length; i++) {
          const annot = annots.lookup(1 + i * 2, PDFDict);
          const appearance = annot.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N'));
          if (!(appearance instanceof PDFRawStream)) throw new Error('Review appearance is missing');
          expect(new TextDecoder().decode(appearance.contents), `${markups[i].type} number`).toContain(`(#${i + 1}) Tj`);
        }
        const stampAppearance = annots.lookup(0, PDFDict).lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N'));
        if (!(stampAppearance instanceof PDFRawStream)) throw new Error('Stamp appearance is missing');
        const stampOps = new TextDecoder().decode(stampAppearance.contents);
        expect(stampOps).toContain('/StampImage Do');
        expect(stampOps).not.toContain(' Tj');

        const pdf = await getDocument({ data: bytes, standardFontDataUrl }).promise;
        try {
          const page = await pdf.getPage(1);
          const viewport = page.getViewport({ scale: 1 });
          const canvas = createCanvas(viewport.width, viewport.height);
          const ctx = canvas.getContext('2d');
          await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport, annotationMode: AnnotationMode.ENABLE }).promise;
          const red = (r: number, g: number, b: number) => r > 170 && g < 130 && b < 140;
          for (const markup of markups) {
            const { x, y } = markup.points[0];
            const box = calloutLayout(markup)!;
            expect(pixels(ctx, x - 8, y - 8, 16, 16, red), `${markup.type} markup-corner ID`).toBeLessThan(45);
            expect(pixels(ctx, box.x, box.y - 1, box.w, 3, red), `${markup.type} border`).toBeGreaterThan(box.w * 0.8);
          }
          const blue = (r: number, g: number, b: number) => r < 40 && g > 40 && g < 130 && b > 150;
          expect(pixels(ctx, 35, 455, 90, 30, blue)).toBeGreaterThan(2500);
          expect(pixels(ctx, 20, 440, 120, 60, red)).toBe(0);
        } finally {
          await pdf.destroy();
        }
  });

  const types: MarkupType[] = [
        'highlight', 'text', 'callout', 'cloud', 'rect', 'ellipse', 'arrow', 'polyline', 'pen', 'note',
        'm-length', 'm-polylength', 'm-area', 'm-perimeter', 'm-angle', 'm-count',
      ];
      for (const rotation of [0, 90, 180, 270]) {
        it(`renders all review types and an unnumbered image stamp after save and reopen (${rotation} degrees)`, async () => {
          const source = await PDFDocument.create();
          const image = createCanvas(8, 8);
          const imageCtx = image.getContext('2d');
          imageCtx.fillStyle = '#0055cc';
          imageCtx.fillRect(0, 0, 8, 8);
          const stampImage = { data: image.toDataURL('image/png'), width: 8, height: 8 };
          const imageStamp: Markup = { ...stamp, page: types.length, opacity: 1, stampImage };
          const markups = types.map((type, page): Markup => ({
            ...review, type, page, id: `review-${type}`, color: '#202020',
            points: type === 'note' || type === 'm-count'
              ? [{ x: 40, y: 40 }]
              : type === 'callout' || type === 'm-angle' || type === 'm-area' || type === 'm-perimeter'
                ? [{ x: 40, y: 40 }, { x: 100, y: 65 }, { x: 80, y: 70 }]
                : review.points,
            text: type === 'text' || type === 'callout' ? 'Markup text' : undefined,
          }));
          for (let i = 0; i <= types.length; i++) {
            const p = source.addPage([460, 360]);
            p.setCropBox(20, 30, 400, 300);
            p.setRotation(degrees(rotation));
          }
          const first = await saveWithState(await source.save(), { markups: [...markups, imageStamp], calibrations: {}, sheets: {}, bookmarks: [] });
          const saved = await saveWithState(first, await readState(await PDFDocument.load(first)));
          const pdf = await getDocument({ data: saved, standardFontDataUrl }).promise;
          try {
            for (const [index, markup] of markups.entries()) {
              const page = await pdf.getPage(index + 1);
              const viewport = page.getViewport({ scale: 1 });
              const canvas = createCanvas(viewport.width, viewport.height);
              const ctx = canvas.getContext('2d');
              await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport, annotationMode: AnnotationMode.ENABLE }).promise;
              const red = (r: number, g: number, b: number) => r > 170 && g < 130 && b < 140;
              const box = calloutLayout(markup)!;
              expect(pixels(ctx, 32, 32, 16, 16, red), `${markup.type} markup-corner ID`).toBeLessThan(45);
              expect(pixels(ctx, box.x, box.y - 1, box.w, 3, red), `${markup.type} top`).toBeGreaterThan(box.w * 0.8);
              expect(pixels(ctx, box.x, Math.round(box.y + box.h) - 1, box.w, 3, red), `${markup.type} bottom`).toBeGreaterThan(box.w * 0.8);
              expect(pixels(ctx, box.x - 1, box.y, 3, Math.floor(box.h), red), `${markup.type} left`).toBeGreaterThan(box.h * 0.8);
              expect(pixels(ctx, box.x + box.w - 1, box.y, 3, Math.floor(box.h), red), `${markup.type} right`).toBeGreaterThan(box.h * 0.8);
              const middleX = Math.round((box.anchor.x + box.edge.x) / 2);
              const middleY = Math.round((box.anchor.y + box.edge.y) / 2);
              expect(pixels(ctx, middleX - 3, middleY - 3, 7, 7, red), `${markup.type} leader`).toBeGreaterThan(3);
            }
            const page = await pdf.getPage(types.length + 1);
            const viewport = page.getViewport({ scale: 1 });
            const canvas = createCanvas(viewport.width, viewport.height);
            const ctx = canvas.getContext('2d');
            await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport, annotationMode: AnnotationMode.ENABLE }).promise;
            const blue = (r: number, g: number, b: number) => r < 40 && g > 40 && g < 130 && b > 150;
            const red = (r: number, g: number, b: number) => r > 170 && g < 130 && b < 140;
            expect(pixels(ctx, 35, 200, 70, 20, blue), 'image stamp remains visible').toBeGreaterThan(1000);
            expect(pixels(ctx, 0, 0, viewport.width, viewport.height, red), 'stamp has no review tag or callout').toBe(0);
          } finally {
            await pdf.destroy();
          }
        }, 30000);
  }
});
