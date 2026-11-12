import { PDFDocument, degrees } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { applyHandle, handlesOf, hitMarkup, rotateAround } from '../src/core/geometry';
import { readState, saveWithState } from '../src/core/annotations';
import { Markup } from '../src/core/types';
import { groupWatermarks, parseWatermarkPages } from '../src/core/watermarks';
import { STANDARD_COLORS } from '../src/components/StandardColorPicker';

const imageMarkup: Markup = {
  id: 'watermark-image',
  page: 0,
  type: 'image',
  points: [{ x: 10, y: 10 }, { x: 110, y: 50 }],
  color: '#c00000',
  width: 1,
  opacity: 0.25,
  status: 'None',
  author: 'Alice',
  authorEmail: 'alice@example.com',
  date: '2026-01-01T00:00:00.000Z',
  comments: [],
  image: { data: 'data:image/png;base64,aGVsbG8=', width: 2, height: 1 },
  imageLockAspectRatio: true,
  watermark: true,
  watermarkKind: 'image',
  watermarkId: 'linked-watermark',
  rotation: 90,
};

describe('watermark page selection', () => {
  it('parses page numbers and ranges into unique zero-based pages', () => {
    expect(parseWatermarkPages('1-3, 5, 3', 6)).toEqual([0, 1, 2, 4]);
  });

  it.each(['', '1,,3', '0', '4-2', '1-7', '1,x'])('rejects invalid page selection %j', (value) => {
    expect(() => parseWatermarkPages(value, 6)).toThrow();
  });

  it('groups per-page watermark instances for the manager', () => {
    const secondPage = { ...imageMarkup, id: 'watermark-image-page-2', page: 1 };
    const regularMarkup = { ...imageMarkup, id: 'regular-image', watermark: false };
    expect(groupWatermarks([imageMarkup, regularMarkup, secondPage])).toEqual([
      { key: 'linked-watermark', markups: [imageMarkup, secondPage] },
    ]);
  });
});

describe('watermark transforms', () => {
  it('selects and resizes a rotated image watermark using its visible handles', () => {
    const center = { x: 60, y: 30 };
    const rotatedPoint = rotateAround({ x: 20, y: 20 }, center, 90);
    expect(hitMarkup(imageMarkup, rotatedPoint, 1)).toBe(true);

    const handles = handlesOf(imageMarkup);
    expect(handles[0].p).toEqual({ x: 80, y: -20 });
    const moved = applyHandle(imageMarkup, 0, { x: handles[0].p.x - 10, y: handles[0].p.y });
    expect(moved.points).not.toEqual(imageMarkup.points);
    expect(moved.rotation).toBe(90);
  });
});

describe('watermark export and colors', () => {
  it('round-trips editable watermark metadata through PDF annotations', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([400, 300]).setRotation(degrees(0));
    const markup: Markup = {
      ...imageMarkup,
      type: 'stamp',
      stamp: 'CONFIDENTIAL',
      image: undefined,
      watermarkKind: 'text',
      watermarkName: 'CONFIDENTIAL',
      fontSize: 28,
    };
    const saved = await saveWithState(await pdf.save(), {
      markups: [markup],
      calibrations: {},
      sheets: {},
      bookmarks: [],
    });
    const state = await readState(await PDFDocument.load(saved));
    expect(state.markups[0]).toMatchObject({
      watermark: true,
      watermarkKind: 'text',
      watermarkId: 'linked-watermark',
      watermarkName: 'CONFIDENTIAL',
      rotation: 90,
      stamp: 'CONFIDENTIAL',
    });
  });

  it('provides a standard named color palette', () => {
    expect(STANDARD_COLORS).toContainEqual({ name: 'Blue', value: '#0070c0' });
    expect(STANDARD_COLORS).toContainEqual({ name: 'White', value: '#ffffff' });
  });
});
