import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { readState, saveWithState } from '../src/core/annotations';
import { stampDimensions, validStampImage } from '../src/core/stamp';
import { applyHandle, translate } from '../src/core/geometry';
import type { Markup } from '../src/core/types';
import { batchChanges } from '../src/app/shared';

const require = createRequire(import.meta.url);
const { validMarkup } = require('../server/docs.cjs');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const image = { data: PNG, width: 1, height: 1 };
const markup = (): Markup => ({
  id: 'stamp1', page: 0, type: 'stamp', points: [{ x: 10, y: 20 }, { x: 80, y: 100 }],
  color: '#ff0000', width: 2, opacity: 0.4, stamp: 'Custom image', stampImage: image,
  status: 'None', author: 'Test', date: '2026-01-01T00:00:00Z', comments: [],
});

describe('custom stamp', () => {
  it('validates bounded PNGs for local and server-side use', () => {
    expect(validStampImage(image)).toBe(true);
    expect(validMarkup(markup())).toBe(null);
    expect(validStampImage({ ...image, data: 'data:image/svg+xml;base64,abc' })).toBe(false);
    expect(validMarkup({ ...markup(), stampImage: { ...image, width: 801 } })).toBe('Invalid stamp image.');
    expect(validMarkup({ ...markup(), type: 'rect' })).toBe('Invalid stamp image.');
    expect(stampDimensions(1600, 800)).toEqual({ width: 800, height: 400 });
    expect(() => stampDimensions(0, 5)).toThrow();
  });

  it('limits batched image changes below the server request cap', () => {
    const docs = Array.from({ length: 70 }, (_, i) => ({ ...markup(), id: `m${i}`, stampImage: { ...image, data: 'data:image/png;base64,' + 'A'.repeat(170000) } }));
    const batch = batchChanges(docs, []).upserts;
    expect(batch.length).toBeLessThan(docs.length);
    expect(new TextEncoder().encode(JSON.stringify({ upserts: batch, deletes: [] })).length).toBeLessThan(4 * 1024 * 1024);
  });

  it('preserves image, move, resize and opacity in a real PDF annotation', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([300, 400]);
    const moved = translate(markup(), 10, 15);
    const changed = applyHandle(moved, 2, { x: 140, y: 160 });
    changed.opacity = 0.55;
    const bytes = await saveWithState(await pdf.save(), { markups: [changed], calibrations: {}, sheets: {}, bookmarks: [] });
    const reopened = await PDFDocument.load(bytes);
    const state = await readState(reopened);
    expect(state.markups[0]).toMatchObject({ stampImage: image, opacity: 0.55, points: changed.points });
    const annots = reopened.getPages()[0].node.Annots() as PDFArray;
    const annot = annots.lookup(0, PDFDict);
    expect(annot.lookup(PDFName.of('Subtype'), PDFName).asString()).toBe('/Stamp');
    const ap = annot.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N'));
    if (!(ap instanceof PDFRawStream)) throw new Error('Expected a PDF appearance stream');
    const resources = ap.dict.lookup(PDFName.of('Resources'), PDFDict);
    expect(resources.lookup(PDFName.of('XObject'), PDFDict).has(PDFName.of('StampImage'))).toBe(true);
    expect(new TextDecoder().decode(ap.contents)).toContain('/StampImage Do');
  });
});
