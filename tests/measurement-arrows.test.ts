import { createCanvas } from '@napi-rs/canvas';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFString } from 'pdf-lib';
import { AnnotationMode, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readState, saveWithState } from '../src/core/annotations';
import { measurementArrowheads } from '../src/core/snapping';
import type { Markup } from '../src/core/types';

const length: Markup = {
  id: 'arrowed-length',
  page: 0,
  type: 'm-length',
  points: [{ x: 40, y: 70 }, { x: 180, y: 70 }],
  color: '#00897b',
  width: 2,
  opacity: 1,
  status: 'None',
  author: 'A',
  date: '2026-01-02T00:00:00Z',
  comments: [],
  measurementArrowheads: 'both',
  measurementArrowSize: 16,
};
const standardFontDataUrl = join(dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')), 'standard_fonts') + sep;

describe('length measurement arrowheads', () => {
  it('creates arrowheads at both measurement endpoints with the configured size', () => {
    const heads = measurementArrowheads(length);
    expect(heads).toHaveLength(2);
    expect(heads[0][0]).toEqual(length.points[0]);
    expect(heads[1][0]).toEqual(length.points[1]);
    expect(Math.hypot(heads[0][1].x - heads[0][0].x, heads[0][1].y - heads[0][0].y)).toBeCloseTo(16);
  });

  it('persists endpoint arrow settings and renders them into the saved PDF appearance', async () => {
    const source = await PDFDocument.create();
    source.addPage([300, 200]);
    const bytes = await saveWithState(await source.save(), {
      markups: [length],
      calibrations: {},
      sheets: {},
      bookmarks: [],
    });
    const saved = await PDFDocument.load(bytes);
    const annots = saved.getPages()[0].node.Annots() as PDFArray;
    const annot = annots.asArray().map((ref) => saved.context.lookup(ref, PDFDict)).find((candidate) =>
      candidate.lookup(PDFName.of('NM'), PDFString).asString() === length.id,
    );
    expect(annot).toBeDefined();
    const endings = annot!.lookup(PDFName.of('LE'), PDFArray);
    expect(endings.asArray().map((item) => item.toString())).toEqual(['/ClosedArrow', '/ClosedArrow']);
    const appearance = annot!.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N'));
    expect(appearance).toBeInstanceOf(PDFRawStream);
    expect(new TextDecoder().decode((appearance as PDFRawStream).contents)).toContain('f');

    const restored = await readState(saved);
    expect(restored.markups[0].measurementArrowheads).toBe('both');
    expect(restored.markups[0].measurementArrowSize).toBe(16);

    const viewer = await getDocument({ data: bytes, standardFontDataUrl }).promise;
    try {
      const pdfPage = await viewer.getPage(1);
      const viewport = pdfPage.getViewport({ scale: 1 });
      const canvas = createCanvas(viewport.width, viewport.height);
      const context = canvas.getContext('2d');
      await pdfPage.render({
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
        annotationMode: AnnotationMode.ENABLE,
      }).promise;
      const count = (x: number, y: number, width: number, height: number) => {
        const data = context.getImageData(x, y, width, height).data;
        let total = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 1] > 80 && data[i + 1] > data[i] * 1.2) total++;
        }
        return total;
      };
      expect(count(24, 60, 22, 20), 'start arrowhead').toBeGreaterThan(20);
      expect(count(174, 60, 22, 20), 'end arrowhead').toBeGreaterThan(20);
    } finally {
      await viewer.destroy();
    }
  });
});
