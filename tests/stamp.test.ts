import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { readState, saveWithState } from '../src/core/annotations';
import { stampDimensions, validStampImage } from '../src/core/stamp';
import { applyHandle, cloudPoints, translate } from '../src/core/geometry';
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
  it('uses the cloud arc diameter when generating cloud points', () => {
    const box = { x: 0, y: 0, w: 200, h: 120 };
    expect(cloudPoints(box, 6).length).toBeGreaterThan(cloudPoints(box, 24).length);
  });

  it('persists cloud arc diameter with the markup state', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([300, 400]);
    const cloud = { ...markup(), type: 'cloud' as const, stampImage: undefined, cloudArc: 27 };
    const bytes = await saveWithState(await pdf.save(), { markups: [cloud], calibrations: {}, sheets: {}, bookmarks: [] });
    const saved = await readState(await PDFDocument.load(bytes));
    expect(saved.markups[0].cloudArc).toBe(27);
  });

  it('validates bounded PNGs for local and server-side use', () => {
    expect(validStampImage(image)).toBe(true);
    expect(validMarkup(markup())).toBe(null);
    const cloud = { ...markup(), type: 'cloud' as const, stampImage: undefined };
    expect(validMarkup({ ...cloud, cloudArc: 24 })).toBe(null);
    expect(validMarkup({ ...cloud, cloudArc: 81 })).toBe('Invalid cloud arc diameter.');
    expect(validStampImage({ ...image, data: 'data:image/svg+xml;base64,abc' })).toBe(false);
    expect(validMarkup({ ...markup(), stampImage: { ...image, width: 801 } })).toBe('Invalid stamp image.');
    expect(validMarkup({ ...markup(), type: 'rect' })).toBe('Invalid stamp image.');
    expect(stampDimensions(1600, 800)).toEqual({ width: 800, height: 400 });
    expect(() => stampDimensions(0, 5)).toThrow();
  });

  it('validates and persists an embedded image markup with comments and grouping metadata', async () => {
    const source = {
      ...markup(),
      id: 'image1',
      type: 'image' as const,
      image,
      imageLockAspectRatio: true,
      stampImage: undefined,
      groupId: 'group1',
      comments: [{ id: 'comment1', author: 'Test', date: '2026-01-01T00:00:00Z', text: 'See attached image' }],
    };
    expect(validMarkup(source)).toBe(null);
    expect(validMarkup({ ...source, groupId: 'invalid group' })).toBe('Invalid group id.');
    expect(validMarkup({ ...source, image: undefined })).toBe('Invalid markup image.');
    const pdf = await PDFDocument.create();
    pdf.addPage([300, 400]);
    const bytes = await saveWithState(await pdf.save(), { markups: [source], calibrations: {}, sheets: {}, bookmarks: [] });
    const reopened = await PDFDocument.load(bytes);
    expect((await readState(reopened)).markups[0]).toMatchObject({
      image,
      imageLockAspectRatio: true,
      groupId: 'group1',
      comments: [{ text: 'See attached image' }],
    });
    const annotation = (reopened.getPages()[0].node.Annots() as PDFArray).lookup(0, PDFDict);
    const appearance = annotation.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N'));
    if (!(appearance instanceof PDFRawStream)) throw new Error('Expected an image annotation appearance');
    expect(appearance.dict.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('XObject'), PDFDict).has(PDFName.of('MarkupImage'))).toBe(true);
    expect(new TextDecoder().decode(appearance.contents)).toContain('/MarkupImage Do');
  });

  it('limits batched image changes below the server request cap', () => {
    const docs = Array.from({ length: 70 }, (_, i) => ({ ...markup(), id: `m${i}`, stampImage: { ...image, data: 'data:image/png;base64,' + 'A'.repeat(170000) } }));
    const batch = batchChanges(docs, []).upserts;
    expect(batch.length).toBeLessThan(docs.length);
    expect(new TextEncoder().encode(JSON.stringify({ upserts: batch, deletes: [] })).length).toBeLessThan(4 * 1024 * 1024);
  });

  it('locks custom stamp resizing to the image ratio by default and allows free resizing', () => {
    const source = markup();
    const locked = applyHandle(source, 2, { x: 140, y: 160 });
    const lockedWidth = Math.abs(locked.points[1].x - locked.points[0].x);
    const lockedHeight = Math.abs(locked.points[1].y - locked.points[0].y);
    expect(lockedWidth / lockedHeight).toBeCloseTo(70 / 80);

    const free = applyHandle({ ...source, stampLockAspectRatio: false }, 2, { x: 140, y: 160 });
    expect(free.points).toEqual([{ x: 10, y: 20 }, { x: 140, y: 160 }]);
  });

  it('locks image markup resizing to its embedded image ratio', () => {
    const source: Markup = {
      ...markup(),
      type: 'image',
      image: { ...image, width: 70, height: 80 },
      stampImage: undefined,
    };
    const resized = applyHandle(source, 2, { x: 140, y: 160 });
    const width = Math.abs(resized.points[1].x - resized.points[0].x);
    const height = Math.abs(resized.points[1].y - resized.points[0].y);
    expect(width / height).toBeCloseTo(70 / 80);
  });

  it('preserves image, move, resize and opacity in a real PDF annotation', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([300, 400]);
    const moved = translate(markup(), 10, 15);
    const changed = applyHandle({ ...moved, stampLockAspectRatio: false }, 2, { x: 140, y: 160 });
    changed.opacity = 0.55;
    const bytes = await saveWithState(await pdf.save(), { markups: [changed], calibrations: {}, sheets: {}, bookmarks: [] });
    const reopened = await PDFDocument.load(bytes);
    const state = await readState(reopened);
    expect(state.markups[0]).toMatchObject({ stampImage: image, stampLockAspectRatio: false, opacity: 0.55, points: changed.points });
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
