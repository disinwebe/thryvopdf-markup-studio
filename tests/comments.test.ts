import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { contentsOf, readState, saveWithState } from '../src/core/annotations';
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

describe('annotation IDs and comments in the PDF', () => {
  it('writes /NM and the comment thread into /Contents, and comments as replies linked by /IRT', async () => {
    const m1 = mk('aaa', [c('c1', 'first'), c('c2', 'second')], { text: 'Check this' });
    const m2 = mk('bbb', [c('c3', 'other markup')]);
    const out = await saveWithState(await blank(), { markups: [m1, m2], calibrations: {}, sheets: {}, bookmarks: [] });
    const doc = await PDFDocument.load(out);
    const all = annots(doc);
    const parent = (nm: string) => all.find((x) => str(x.d.get(PDFName.of('NM'))) === nm)!;
    const p1 = parent('aaa');
    expect(str(p1.d.get(PDFName.of('Contents')))).toBe('Check this\n\nBob: first\nBob: second');
    const replies = all.filter((x) => x.d.has(PDFName.of('IRT')));
    expect(replies).toHaveLength(3);
    const of = (nm: string) => replies.filter((r) => (r.d.get(PDFName.of('IRT')) as PDFRef) === parent(nm).ref).map((r) => str(r.d.get(PDFName.of('Contents'))));
    expect(of('aaa')).toEqual(['first', 'second']);
    expect(of('bbb')).toEqual(['other markup']);
    expect(replies.map((r) => str(r.d.get(PDFName.of('NM')))).sort()).toEqual(['aaa:c1', 'aaa:c2', 'bbb:c3']);
    expect(String(replies[0].d.get(PDFName.of('RT')))).toBe('/R');
  });

  it('round-trips ids and comments, and re-saving does not duplicate replies', async () => {
    const m = mk('keep-me', [c('c1', 'hello')]);
    const once = await saveWithState(await blank(), { markups: [m], calibrations: {}, sheets: {}, bookmarks: [] });
    const st1 = await readState(await PDFDocument.load(once));
    expect(st1.markups).toHaveLength(1);
    expect(st1.markups[0].id).toBe('keep-me');
    expect(st1.markups[0].comments).toEqual(m.comments);
    const twice = await saveWithState(once, { ...st1, markups: [...st1.markups, mk('two', [])] });
    const doc = await PDFDocument.load(twice);
    expect(annots(doc)).toHaveLength(3); // 2 markups + 1 reply
    const st2 = await readState(doc);
    expect(st2.markups.map((x) => x.id).sort()).toEqual(['keep-me', 'two']);
    const cleared = await saveWithState(twice, { ...st2, markups: [] });
    expect(annots(await PDFDocument.load(cleared)).length).toBe(0);
  });

  it('repairs missing or duplicate ids on load and names foreign annotations once', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 300]);
    const foreign = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [0, 0, 10, 10] }));
    const named = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [0, 0, 10, 10] }));
    (doc.context.lookup(named, PDFDict) as PDFDict).set(PDFName.of('NM'), PDFString.of('theirs'));
    page.node.addAnnot(foreign);
    page.node.addAnnot(named);
    const base = await doc.save();
    const dup = [mk('same', [c('x', 'a'), c('x', 'b')]), mk('same', [])];
    const saved = await saveWithState(base, { markups: dup, calibrations: {}, sheets: {}, bookmarks: [] });
    const loaded = await PDFDocument.load(saved);
    const names = annots(loaded).map((x) => str(x.d.get(PDFName.of('NM'))));
    expect(names.every(Boolean)).toBe(true);
    expect(names).toContain('theirs');
    const fixed = await readState(loaded);
    expect(new Set(fixed.markups.map((m) => m.id)).size).toBe(2);
    expect(new Set(fixed.markups[0].comments.map((x) => x.id)).size).toBe(2);
    const again = await saveWithState(saved, fixed);
    expect(annots(await PDFDocument.load(again)).filter((x) => !x.d.has(PDFName.of('IRT'))).map((x) => str(x.d.get(PDFName.of('NM')))))
      .toContain('theirs');
  });

  it('generates unique ids', () => {
    const s = new Set(Array.from({ length: 5000 }, uid));
    expect(s.size).toBe(5000);
    expect(contentsOf(mk('z', [], { text: 'only' }))).toBe('only');
  });
});
