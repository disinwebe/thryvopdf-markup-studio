import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { readState, saveWithState } from '../src/core/annotations';
import { hitMarkup, pickTop, wrapText } from '../src/core/geometry';
import { buildFromPlan, chunkEvery, extractPages, mergePdfs, movePage, parseRanges, splitPdf } from '../src/core/organize';
import { Markup, MarkupType } from '../src/core/types';

async function makePdf(pages: number, label = 'P', size: [number, number] = [400, 300]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) doc.addPage(size).drawText(`${label}${i + 1}`, { x: 20, y: 20, font });
  return doc.save();
}

const mk = (type: MarkupType, points: [number, number][], extra: Partial<Markup> = {}): Markup => ({
  id: 'id-' + type,
  page: 0,
  type,
  points: points.map(([x, y]) => ({ x, y })),
  color: '#e53935',
  width: 2,
  opacity: 0.8,
  text: 'Hello (world)',
  status: 'Accepted',
  author: 'Alice',
  date: '2024-05-01T10:00:00.000Z',
  comments: [{ id: 'c1', author: 'Bob', date: '2024-05-02T10:00:00.000Z', text: 'ok' }],
  ...extra,
});

describe('annotations round trip', () => {
  it('writes all markup types as real annotations and reloads them', async () => {
    const bytes = await makePdf(2);
    const types: [MarkupType, [number, number][]][] = [
      ['highlight', [[10, 10], [100, 30]]],
      ['text', [[10, 50], [120, 90]]],
      ['callout', [[10, 100], [120, 140], [200, 200]]],
      ['cloud', [[150, 10], [250, 80]]],
      ['rect', [[150, 100], [250, 150]]],
      ['ellipse', [[260, 10], [350, 60]]],
      ['line', [[10, 200], [100, 220]]],
      ['arrow', [[10, 230], [100, 250]]],
      ['polyline', [[10, 260], [50, 280], [90, 260]]],
      ['pen', [[200, 200], [210, 215], [230, 210]]],
      ['stamp', [[260, 100], [380, 140]]],
      ['note', [[300, 200]]],
      ['m-length', [[10, 10], [60, 10]]],
      ['m-polylength', [[10, 10], [60, 10], [60, 60]]],
      ['m-area', [[10, 10], [60, 10], [60, 60]]],
      ['m-perimeter', [[10, 10], [60, 10], [60, 60]]],
      ['m-angle', [[10, 10], [60, 10], [60, 60]]],
      ['m-count', [[30, 30]]],
    ];
    const markups = types.map(([t, p], i) => mk(t, p, { id: `m${i}`, stamp: 'APPROVED', page: i % 2 }));
    const saved = await saveWithState(bytes, {
      markups,
      calibrations: { 0: { unit: 'ft', unitsPerPoint: 0.25, calibrated: true } },
      sheets: { 1: { number: 'A-102', title: 'Plan', discipline: 'Arch', revision: 'B' } },
      bookmarks: [
        { title: 'Intro', page: 0, level: 0 },
        { title: 'Detail', page: 1, level: 1 },
      ],
    });

    const doc = await PDFDocument.load(saved);
    const subtypes = new Set<string>();
    doc.getPages().forEach((p) => {
      const a = p.node.Annots()!;
      for (let i = 0; i < a.size(); i++) {
        const d = a.lookup(i) as unknown as { get(k: unknown): { toString(): string } | undefined };
        subtypes.add(String(d.get(require_name('Subtype'))));
      }
    });
    for (const s of ['/Highlight', '/FreeText', '/Square', '/Circle', '/Line', '/PolyLine', '/Polygon', '/Ink', '/Stamp', '/Text'])
      expect(subtypes.has(s), s).toBe(true);

    const back = await readState(doc);
    expect(back.markups).toHaveLength(types.length);
    const orig = markups.find((m) => m.type === 'callout')!;
    const got = back.markups.find((m) => m.id === orig.id)!;
    expect(got.points).toEqual(orig.points);
    expect(got.comments[0].text).toBe('ok');
    expect(got.status).toBe('Accepted');
    expect(got.page).toBe(orig.page);
    expect(back.calibrations[0].unitsPerPoint).toBe(0.25);
    expect(back.sheets[1].number).toBe('A-102');
    expect(back.bookmarks).toEqual([
      { title: 'Intro', page: 0, level: 0 },
      { title: 'Detail', page: 1, level: 1 },
    ]);
  });

  it('replaces previous markups on re-save instead of duplicating', async () => {
    const bytes = await makePdf(1);
    const state = { markups: [mk('rect', [[1, 1], [20, 20]])], calibrations: {}, sheets: {}, bookmarks: [] };
    const once = await saveWithState(bytes, state);
    const twice = await saveWithState(once, state);
    expect((await readState(await PDFDocument.load(twice))).markups).toHaveLength(1);
    const cleared = await saveWithState(twice, { ...state, markups: [] });
    expect((await readState(await PDFDocument.load(cleared))).markups).toHaveLength(0);
  });

  it('keeps markups on their page after page reordering', async () => {
    const bytes = await makePdf(3);
    const saved = await saveWithState(bytes, {
      markups: [mk('rect', [[1, 1], [20, 20]], { page: 2 })],
      calibrations: {},
      sheets: {},
      bookmarks: [],
    });
    const reordered = await buildFromPlan([saved], [{ src: 0, index: 2 }, { src: 0, index: 0 }, { src: 0, index: 1 }]);
    const st = await readState(await PDFDocument.load(reordered));
    expect(st.markups[0].page).toBe(0);
  });

  it('handles rotated pages', async () => {
    const doc = await PDFDocument.create();
    const p = doc.addPage([400, 300]);
    p.setRotation({ type: 'degrees' as never, angle: 90 });
    const saved = await saveWithState(await doc.save(), {
      markups: [mk('text', [[10, 10], [100, 50]])],
      calibrations: {},
      sheets: {},
      bookmarks: [],
    });
    expect((await readState(await PDFDocument.load(saved))).markups).toHaveLength(1);
  });
});

import { PDFName } from 'pdf-lib';
function require_name(n: string) {
  return PDFName.of(n);
}

describe('hit testing', () => {
  it('hits outlines but not interiors of unfilled rectangles', () => {
    const r = mk('rect', [[0, 0], [100, 100]]);
    expect(hitMarkup(r, { x: 0, y: 50 }, 3)).toBe(true);
    expect(hitMarkup(r, { x: 50, y: 50 }, 3)).toBe(false);
    expect(hitMarkup({ ...r, fill: '#fff' }, { x: 50, y: 50 }, 3)).toBe(true);
  });
  it('picks top-most markup on the right page', () => {
    const a = mk('highlight', [[0, 0], [50, 50]], { id: 'a' });
    const b = mk('highlight', [[0, 0], [50, 50]], { id: 'b' });
    expect(pickTop([a, b], 0, { x: 10, y: 10 }, 2)?.id).toBe('b');
    expect(pickTop([a, b], 1, { x: 10, y: 10 }, 2)).toBeUndefined();
  });
  it('wraps text', () => {
    expect(wrapText('aaa bbb ccc', 40, 10).length).toBeGreaterThan(1);
  });
});

describe('organize', () => {
  it('parses ranges', () => {
    expect(parseRanges('1-2, 5, 4-', 6)).toEqual([[0, 1], [4], [3, 4, 5]]);
    expect(() => parseRanges('9', 3)).toThrow();
    expect(() => parseRanges('x', 3)).toThrow();
  });
  it('chunks pages', () => {
    expect(chunkEvery(5, 2)).toEqual([[0, 1], [2, 3], [4]]);
  });
  it('moves pages', () => {
    expect(movePage([0, 1, 2, 3], 0, 2)).toEqual([1, 2, 0, 3]);
  });
  it('merges, extracts, splits and rotates', async () => {
    const a = await makePdf(3, 'A'),
      b = await makePdf(2, 'B');
    const merged = await mergePdfs([a, b]);
    expect((await PDFDocument.load(merged)).getPageCount()).toBe(5);
    expect((await PDFDocument.load(await extractPages(merged, [4, 0]))).getPageCount()).toBe(2);
    const parts = await splitPdf(merged, chunkEvery(5, 2));
    expect(parts).toHaveLength(3);
    const rotated = await buildFromPlan([a], [{ src: 0, index: 0, rotate: 90 }]);
    expect((await PDFDocument.load(rotated)).getPage(0).getRotation().angle).toBe(90);
  });
});
