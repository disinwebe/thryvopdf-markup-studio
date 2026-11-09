import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { contentsOf, readState, saveWithState } from '../src/core/annotations';
import { numberMarkups } from '../src/core/numbering';
import { Markup, uid } from '../src/core/types';

const mk = (id: string, comments: Markup['comments'], extra: Partial<Markup> = {}): Markup => ({
  id, page: 0, type: 'rect', points: [{ x: 10, y: 10 }, { x: 80, y: 60 }], color: '#e53935', width: 2, opacity: 1,
  status: 'None', author: 'Alice', date: '2024-05-01T10:00:00.000Z', comments, ...extra,
});
const c = (id: string, text: string, author = 'Bob') => ({ id, author, date: '2024-05-02T10:00:00.000Z', text });
const blank = async () => {
  const d = await PDFDocument.create();
  d.addPage([400, 300]);
  return d.save();
};
const str = (v: unknown) => (v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : undefined);
const annots = (doc: PDFDocument) => {
  const a = doc.getPages()[0].node.Annots() as PDFArray;
  return Array.from({ length: a.size() }, (_, i) => ({ ref: a.get(i) as PDFRef, d: a.lookup(i, PDFDict) }));
};

const reviewItems = (doc: PDFDocument) => annots(doc).filter((x) => String(x.d.get(PDFName.of('Subtype'))) !== '/Popup');

describe('annotation IDs and comments in the PDF', () => {
  it('writes ONE annotation per markup: /NM, /Contents thread, linked popup, no separate replies', async () => {
    const m1 = mk('aaa', [c('c1', 'first'), c('c2', 'second')], { text: 'Check this' });
    const m2 = mk('bbb', [c('c3', 'other markup')]);
    const out = await saveWithState(await blank(), { markups: [m1, m2], calibrations: {}, sheets: {}, bookmarks: [] });
    const doc = await PDFDocument.load(out);
    const all = annots(doc);
    expect(all.filter((x) => x.d.has(PDFName.of('IRT')))).toHaveLength(0);
    expect(all.filter((x) => String(x.d.get(PDFName.of('Subtype'))) === '/Text')).toHaveLength(0);
    const items = reviewItems(doc);
    expect(items).toHaveLength(2);
    const p1 = items.find((x) => str(x.d.get(PDFName.of('NM'))) === 'aaa')!;
    expect(str(p1.d.get(PDFName.of('Contents')))).toBe('Check this\n\nfirst\nsecond');
    const popup = p1.d.lookup(PDFName.of('Popup'), PDFDict);
    expect(popup.get(PDFName.of('Parent'))).toBe(p1.ref);
  });

  it('numbers markups sequentially by page then date, and renumbers when one is removed', () => {
    const a = mk('a', [], { page: 1, date: '2024-01-01T00:00:00Z' });
    const b = mk('b', [], { page: 0, date: '2024-03-01T00:00:00Z' });
    const d = mk('d', [], { page: 0, date: '2024-02-01T00:00:00Z' });
    const n = numberMarkups([a, b, d]);
    expect([n.get('d'), n.get('b'), n.get('a')]).toEqual([1, 2, 3]);
    const after = numberMarkups([a, b]);
    expect([after.get('b'), after.get('a')]).toEqual([1, 2]);
  });

  it('does not number plain lines or stamps, including legacy commented stamps', () => {
    const line = mk('line-id', [], { type: 'line' });
    const stamp = mk('stamp-id', [c('legacy', 'old comment')], { type: 'stamp' });
    const markup = mk('markup-id', []);
    expect(numberMarkups([line, stamp, markup])).toEqual(new Map([['markup-id', 1]]));
  });

  it('persists a plain line as page drawing content, not as a review annotation', async () => {
    const line = mk('line-id', [], {
      type: 'line',
      points: [{ x: 10, y: 20 }, { x: 120, y: 75 }],
      color: '#123456',
      width: 3,
    });
    const source = await PDFDocument.create();
    const sourcePage = source.addPage([400, 300]);
    sourcePage.drawText('Keep existing page content', { x: 10, y: 200 });
    const sourceContents = sourcePage.node.Contents() as PDFArray;
    const originalRefs = Array.from({ length: sourceContents.size() }, (_, i) => String(sourceContents.get(i)));
    const once = await saveWithState(await source.save(), { markups: [line], calibrations: {}, sheets: {}, bookmarks: [] });
    const first = await PDFDocument.load(once);
    expect(first.getPages()[0].node.Annots()?.size()).toBe(0);
    expect(first.getPages()[0].node.Contents()).toBeInstanceOf(PDFArray);
    const firstRefs = first.getPages()[0].node.Contents() as PDFArray;
    expect(originalRefs.every((ref) => Array.from({ length: firstRefs.size() }, (_, i) => String(firstRefs.get(i))).includes(ref))).toBe(true);
    expect((await readState(first)).markups).toEqual([{ ...line, comments: [] }]);

    const twice = await saveWithState(once, await readState(first));
    const second = await PDFDocument.load(twice);
    expect(second.getPages()[0].node.Annots()?.size()).toBe(0);
    const secondContents = second.getPages()[0].node.Contents() as PDFArray;
    expect(secondContents.size()).toBeGreaterThan(0);
    const firstGeneratedRefs = new Set(
      Array.from({ length: (first.getPages()[0].node.Contents() as PDFArray).size() }, (_, i) =>
        String((first.getPages()[0].node.Contents() as PDFArray).get(i)),
      ).filter((ref) => !originalRefs.includes(ref)),
    );
    const secondRefs = Array.from({ length: secondContents.size() }, (_, i) => String(secondContents.get(i)));
    expect(originalRefs.every((ref) => secondRefs.includes(ref))).toBe(true);
    expect(secondRefs.some((ref) => firstGeneratedRefs.has(ref))).toBe(false);
    expect((await readState(second)).markups).toHaveLength(1);
    const third = await PDFDocument.load(await saveWithState(twice, await readState(second)));
    const thirdContents = third.getPages()[0].node.Contents() as PDFArray;
    expect(thirdContents.size()).toBe(secondContents.size());
    const thirdRefs = Array.from({ length: thirdContents.size() }, (_, i) => String(thirdContents.get(i)));
    expect(originalRefs.every((ref) => thirdRefs.includes(ref))).toBe(true);
    expect(thirdRefs.some((ref) => secondRefs.filter((x) => !originalRefs.includes(x)).includes(ref))).toBe(false);
  });

  it('keeps the markup corner free of a number badge and ids distinct from numbers', async () => {
    const out = await saveWithState(await blank(), { markups: [mk('uuid-1', [])], calibrations: {}, sheets: {}, bookmarks: [] });
    const doc = await PDFDocument.load(out);
    const item = reviewItems(doc)[0];
    const ap = item.d.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N')) as unknown as { getContents(): Uint8Array };
    const ops = Buffer.from(ap.getContents()).toString('latin1');
    expect(ops).not.toContain('(#1) Tj');
    expect(ops).not.toContain('0.882 0.114 0.282 rg');
    expect(str(item.d.get(PDFName.of('NM')))).toBe('uuid-1');
  });

  it('keeps comment text author-free in /Contents and labels its author beside the saved callout number', async () => {
    const markup = mk('uuid-comment', [c('comment-1', 'Keep this wording.', 'Bob')]);
    const out = await saveWithState(await blank(), { markups: [markup], calibrations: {}, sheets: {}, bookmarks: [] });
    const doc = await PDFDocument.load(out);
    const item = reviewItems(doc)[0];
    expect(str(item.d.get(PDFName.of('Contents')))).toBe('Keep this wording.');

    const ap = item.d.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N')) as unknown as { getContents(): Uint8Array };
    const ops = Buffer.from(ap.getContents()).toString('latin1');
    expect(ops).toMatch(/\(#1\) Tj ET\nBT[^]*\(Bob\) Tj ET/);
    expect(ops).toContain('(Keep this wording.) Tj');

    const restored = await readState(doc);
    expect(restored.markups[0].comments).toEqual(markup.comments);
  });

  it('round-trips ids and comments, and re-saving does not duplicate popups', async () => {
    const m = mk('keep-me', [c('c1', 'hello')]);
    const once = await saveWithState(await blank(), { markups: [m], calibrations: {}, sheets: {}, bookmarks: [] });
    const st1 = await readState(await PDFDocument.load(once));
    expect(st1.markups).toHaveLength(1);
    expect(st1.markups[0].id).toBe('keep-me');
    expect(st1.markups[0].comments).toEqual(m.comments);
    const twice = await saveWithState(once, { ...st1, markups: [...st1.markups, mk('two', [])] });
    const doc = await PDFDocument.load(twice);
    expect(annots(doc)).toHaveLength(4); // 2 markups + 2 popups
    expect(reviewItems(doc)).toHaveLength(2);
    const st2 = await readState(doc);
    expect(st2.markups.map((x) => x.id).sort()).toEqual(['keep-me', 'two']);
    const cleared = await saveWithState(twice, { ...st2, markups: [] });
    expect(annots(await PDFDocument.load(cleared)).length).toBe(0);
  });
  it('preserves direct and indirect foreign annotations without adding names or dropping them', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 300]);
    const foreign = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [0, 0, 10, 10] }));
    const named = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [0, 0, 10, 10] }));
    (doc.context.lookup(named, PDFDict) as PDFDict).set(PDFName.of('NM'), PDFString.of('theirs'));
    const direct = doc.context.obj({
      Type: 'Annot',
      Subtype: 'Text',
      Rect: [20, 20, 30, 30],
      Contents: PDFHexString.fromText('External comment'),
      CustomData: PDFString.of('preserve-me'),
    }) as PDFDict;
    page.node.set(PDFName.of('Annots'), doc.context.obj([direct, foreign, named]) as PDFArray);
    const base = await doc.save();
    const untouchedBase = base.slice();
    const duplicates = [mk('same', [c('x', 'first'), c('x', 'second')]), mk('same', [])];
    const saved = await saveWithState(base, { markups: duplicates, calibrations: {}, sheets: {}, bookmarks: [] });
    expect(base).toEqual(untouchedBase);

    const loaded = await PDFDocument.load(saved);
    const savedAnnots = loaded.getPages()[0].node.Annots() as PDFArray;
    expect(savedAnnots.get(0)).toBeInstanceOf(PDFDict);
    expect(savedAnnots.get(1)).toBeInstanceOf(PDFRef);
    const savedDirect = savedAnnots.lookup(0, PDFDict);
    expect(savedDirect.get(PDFName.of('NM'))).toBeUndefined();
    expect(str(savedDirect.get(PDFName.of('Contents')))).toBe('External comment');
    expect(str(savedDirect.get(PDFName.of('CustomData')))).toBe('preserve-me');
    expect(str(savedAnnots.lookup(1, PDFDict).get(PDFName.of('NM')))).toBeUndefined();
    expect(str(savedAnnots.lookup(2, PDFDict).get(PDFName.of('NM')))).toBe('theirs');

    const fixed = await readState(loaded);
    expect(new Set(fixed.markups.map((m) => m.id)).size).toBe(2);
    expect(new Set(fixed.markups[0].comments.map((x) => x.id)).size).toBe(2);
    const again = await saveWithState(saved, fixed);
    const againAnnots = (await PDFDocument.load(again)).getPages()[0].node.Annots() as PDFArray;
    expect(againAnnots.get(0)).toBeInstanceOf(PDFDict);
    expect(againAnnots.lookup(0, PDFDict).get(PDFName.of('NM'))).toBeUndefined();
    expect(str(againAnnots.lookup(0, PDFDict).get(PDFName.of('Contents')))).toBe('External comment');
    expect(str(againAnnots.lookup(1, PDFDict).get(PDFName.of('NM')))).toBeUndefined();
    expect(str(againAnnots.lookup(2, PDFDict).get(PDFName.of('NM')))).toBe('theirs');
  });

  it('generates unique ids', () => {
    const s = new Set(Array.from({ length: 5000 }, uid));
    expect(s.size).toBe(5000);
    expect(contentsOf(mk('z', [], { text: 'only' }))).toBe('only');
  });
});
