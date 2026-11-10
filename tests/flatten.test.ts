import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { flattenMarkups } from '../src/core/flatten';
import { readState } from '../src/core/annotations';
import type { Markup } from '../src/core/types';

const markup = (id: string, x: number): Markup => ({
  id,
  page: 0,
  type: 'rect',
  points: [{ x, y: 20 }, { x: x + 20, y: 40 }],
  color: '#202020',
  width: 2,
  opacity: 1,
  status: 'None',
  author: 'Reviewer',
  date: '2026-01-01T00:00:00Z',
  comments: [],
});

describe('flattening markups', () => {
  it('bakes selected raster layers into page content and preserves unflattened annotations', async () => {
    const source = await PDFDocument.create();
    source.addPage([200, 200]);
    const canvas = createCanvas(200, 200);
    const context = canvas.getContext('2d');
    context.fillStyle = '#e53935';
    context.fillRect(10, 160, 20, 20);
    const png = new Uint8Array(await canvas.encode('png'));
    const state = {
      markups: [markup('flatten-me', 10), markup('keep-me', 60)],
      calibrations: {},
      sheets: {},
      bookmarks: [],
    };

    const result = await flattenMarkups(await source.save(), state, ['flatten-me'], [{ page: 0, png }]);
    const savedPdf = await PDFDocument.load(result.bytes);
    const savedState = await readState(savedPdf);

    expect(result.markups.map((item) => item.id)).toEqual(['keep-me']);
    expect(savedState.markups.map((item) => item.id)).toEqual(['keep-me']);
    expect(savedPdf.getPages()[0].node.Contents()).toBeTruthy();

    const renderedPdf = await getDocument({ data: result.bytes }).promise;
    try {
      const page = await renderedPdf.getPage(1);
      const viewport = page.getViewport({ scale: 1 });
      const rendered = createCanvas(viewport.width, viewport.height);
      const renderContext = rendered.getContext('2d');
      await page.render({
        canvasContext: renderContext as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;
      const redPixels = renderContext.getImageData(10, 20, 20, 20).data;
      expect(Array.from(redPixels).filter((value, index) => index % 4 === 0 && value > 200).length).toBeGreaterThan(300);
    } finally {
      await renderedPdf.destroy();
    }
  });
});
