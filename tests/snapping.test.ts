import { OPS } from 'pdfjs-dist';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { createSnapIndex, snapPoint } from '../src/core/snapping';
import { snapGeometryFromOperatorList } from '../src/pdf/snapping';

describe('measurement snapping', () => {
  it('snaps to nearby vector endpoints and segment intersections', () => {
    const index = createSnapIndex({
      endpoints: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: -50 }, { x: 50, y: 50 }],
      segments: [
        { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } },
        { a: { x: 50, y: -50 }, b: { x: 50, y: 50 } },
      ],
    });

    expect(snapPoint({ x: 1, y: 2 }, index, 10)).toEqual({ point: { x: 0, y: 0 }, kind: 'endpoint' });
    expect(snapPoint({ x: 51, y: 2 }, index, 10)).toEqual({ point: { x: 50, y: 0 }, kind: 'intersection' });
    expect(snapPoint({ x: 200, y: 200 }, index, 10)).toBeNull();
  });

  it('extracts vector endpoints after applying PDF and viewport transforms', () => {
    const list = {
      fnArray: [OPS.save, OPS.transform, OPS.constructPath, OPS.restore],
      argsArray: [
        null,
        [2, 0, 0, 2, 10, 20],
        [new Uint8Array([OPS.moveTo, OPS.lineTo]), new Float32Array([0, 0, 10, 0])],
        null,
      ],
    };
    const geometry = snapGeometryFromOperatorList(list, [1, 0, 0, -1, 0, 100]);

    expect(geometry.endpoints).toEqual([{ x: 10, y: 80 }, { x: 30, y: 80 }]);
    expect(geometry.segments).toEqual([{ a: { x: 10, y: 80 }, b: { x: 30, y: 80 } }]);
  });

  it('finds real line endpoints and crossings from a PDF page', async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([200, 200]);
    page.drawLine({ start: { x: 20, y: 100 }, end: { x: 180, y: 100 }, thickness: 1 });
    page.drawLine({ start: { x: 100, y: 20 }, end: { x: 100, y: 180 }, thickness: 1 });
    const pdf = await getDocument({ data: await source.save() }).promise;
    try {
      const pdfPage = await pdf.getPage(1);
      const viewport = pdfPage.getViewport({ scale: 1 });
      const geometry = snapGeometryFromOperatorList(
        await pdfPage.getOperatorList(),
        viewport.transform,
      );
      const index = createSnapIndex(geometry);

      expect(snapPoint({ x: 101, y: 102 }, index, 5)).toEqual({
        point: { x: 100, y: 100 },
        kind: 'intersection',
      });
      expect(snapPoint({ x: 21, y: 101 }, index, 5)).toEqual({
        point: { x: 20, y: 100 },
        kind: 'endpoint',
      });
    } finally {
      await pdf.destroy();
    }
  });
});
