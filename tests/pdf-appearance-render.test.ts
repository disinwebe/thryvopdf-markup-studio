import { createCanvas } from '@napi-rs/canvas';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { degrees, PDFDocument } from 'pdf-lib';
import { AnnotationMode, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { saveWithState } from '../src/core/annotations';
import { calloutLayout } from '../src/core/callout';
import type { Markup } from '../src/core/types';

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
  for (const rotation of [0, 90, 180, 270]) {
    it(`renders the tag, leader and bordered box at their page coordinates after reopening (${rotation} degrees)`, async () => {
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
        const light = (r: number, g: number, b: number) => r > 190 && g > 80 && b > 90;
        const box = calloutLayout(review)!;
        expect(pixels(ctx, 32, 32, 16, 16, red)).toBeGreaterThan(50);
        // The highlight's Multiply blend must not hide the white number inside the red tag.
        expect(pixels(ctx, 36, 36, 8, 8, light)).toBeGreaterThan(15);
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
});
