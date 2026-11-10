import { describe, expect, it } from 'vitest';
import { anchorOf, calloutLayout, defaultCalloutPos, hitCallout, moveCallout } from '../src/core/callout';
import { canDeleteComment, canDeleteMarkup, canEditComment } from '../src/core/comments';
import { distToPath, translate } from '../src/core/geometry';
import { saveWithState, readState } from '../src/core/annotations';
import { Markup } from '../src/core/types';
import { PDFDocument } from 'pdf-lib';
import { markupCsv } from '../src/core/markupCsv';
import { buildAppearance } from '../src/core/annotations';

const m = (extra: Partial<Markup> = {}): Markup => ({
  id: 'a', page: 0, type: 'arrow', points: [{ x: 10, y: 10 }, { x: 90, y: 60 }], color: '#f00', width: 2, opacity: 1,
  status: 'None', author: 'Ann', date: '2024-01-01T00:00:00Z',
  comments: [{ id: 'c1', author: 'Ann', authorEmail: 'ann@x', date: '2024-01-02T00:00:00Z', text: 'Check the beam size here please' }], ...extra,
});

describe('comment callout geometry', () => {
  it('connects the leader to the last point of line-like annotations', () => {
    const l = calloutLayout(m({ type: 'polyline' }))!;
    expect(l.anchor).toEqual({ x: 90, y: 60 });
    expect(l.rows[0].head).toBe('Ann');
  });
  it('lays out comment text with independent font sizes', () => {
    const item = m({
      comments: [
        { id: 'small', author: 'A', date: '', text: 'small text', fontSize: 7 },
        { id: 'large', author: 'B', date: '', text: 'large text', fontSize: 18 },
      ],
    });
    const layout = calloutLayout(item, 9)!;
    expect(layout.rows.map((row) => row.fs)).toEqual([7, 18]);
    expect(layout.rows[1].lineH).toBeGreaterThan(layout.rows[0].lineH);
    expect(layout.h).toBeGreaterThan(calloutLayout(m(), 9)!.h);
  });
  it('connects boxes at the border point nearest the comment box', () => {
    expect(anchorOf({ type: 'rect', points: [{ x: 0, y: 0 }, { x: 100, y: 50 }] }, { x: 300, y: 25 })).toEqual({ x: 100, y: 25 });
  });
  it('keeps Cloud comment connectors attached to the nearest polygon edge as the Cloud moves', () => {
    const cloud = m({
      type: 'cloud',
      points: [{ x: 10, y: 10 }, { x: 100, y: 10 }, { x: 10, y: 100 }],
      callout: { x: 130, y: 30 },
    });
    const before = calloutLayout(cloud)!;
    expect(distToPath(before.anchor, cloud.points, true)).toBeLessThan(0.001);
    const moved = translate(cloud, 30, 20);
    expect(calloutLayout(moved)!.anchor).toEqual({ x: before.anchor.x + 30, y: before.anchor.y + 20 });
  });
  it('has no box without comments, and moves/translates with the markup', () => {
    expect(calloutLayout(m({ comments: [] }))).toBeNull();
    const moved = moveCallout(m(), { x: 200, y: 20 });
    const l = calloutLayout(moved)!;
    expect([l.x, l.y]).toEqual([200, 20]);
    expect(hitCallout(moved, { x: 210, y: 25 })).toBe(true);
    expect(hitCallout(moved, { x: 5, y: 5 })).toBe(false);
    expect(translate(moved, 10, 5).callout).toEqual({ x: 210, y: 25 });
    expect(defaultCalloutPos(m())).toEqual({ x: 120, y: 0 });
  });
  it('persists the box position and draws it in the single PDF annotation', async () => {
    const d = await PDFDocument.create();
    d.addPage([400, 300]);
    const out = await saveWithState(await d.save(), { markups: [m({ callout: { x: 150, y: 120 } })], calibrations: {}, sheets: {}, bookmarks: [] });
    const st = await readState(await PDFDocument.load(out));
    expect(st.markups[0].callout).toEqual({ x: 150, y: 120 });
    expect(st.markups[0].comments[0].authorEmail).toBe('ann@x');
  });
  it('persists individual comment font sizes in the saved PDF metadata and appearance', async () => {
    const source = await PDFDocument.create();
    source.addPage([600, 400]);
    const item = m({ comments: [
      { id: 'small', author: 'Ann', date: '', text: 'Small text', fontSize: 7 },
      { id: 'large', author: 'Bob', date: '', text: 'Large text', fontSize: 18 },
    ] });
    const saved = await saveWithState(await source.save(), { markups: [item], calibrations: {}, sheets: {}, bookmarks: [] });
    const stored = (await readState(await PDFDocument.load(saved))).markups[0];
    expect(stored.comments.map((comment) => comment.fontSize)).toEqual([7, 18]);
    const appearance = buildAppearance(stored, { x0: 0, y0: 0, w: 600, h: 400, rotation: 0 }, undefined, 1);
    expect(appearance.ops).toContain('/F1 7 Tf');
    expect(appearance.ops).toContain('/F1 18 Tf');
  });
  it('persists resized and hidden callouts without drawing a second number at the markup corner', async () => {
    const item = m({ callout: { x: 150, y: 120 }, calloutSize: { width: 220, height: 110 }, calloutHidden: true });
    expect(calloutLayout(item)).toBeNull();
    expect(markupCsv([item], 'drawing.pdf')).toContain('Check the beam size here please');
    const source = await PDFDocument.create();
    source.addPage([600, 400]);
    const out = await saveWithState(await source.save(), { markups: [item], calibrations: {}, sheets: {}, bookmarks: [] });
    const stored = (await readState(await PDFDocument.load(out))).markups[0];
    expect(stored.calloutSize).toEqual({ width: 220, height: 110 });
    expect(stored.calloutHidden).toBe(true);
    const shown = { ...stored, calloutHidden: false };
    expect(calloutLayout(shown)).toMatchObject({ x: 150, y: 120, w: 220, h: 110 });
    const hiddenAppearance = buildAppearance(stored, { x0: 0, y0: 0, w: 600, h: 400, rotation: 0 }, undefined, 1);
    expect(hiddenAppearance.ops).not.toContain('(#1) Tj');
    expect(hiddenAppearance.ops).not.toContain('Check the beam size here please');
    const shownAppearance = buildAppearance(shown, { x0: 0, y0: 0, w: 600, h: 400, rotation: 0 }, undefined, 1).ops;
    expect(shownAppearance).toContain('Check the beam size here please');
    expect(shownAppearance).toContain('(#1) Tj');
  });
});

describe('comment permissions (client mirror)', () => {
  const c = m().comments[0];
  const ann = { name: 'Ann', email: 'ann@x', role: 'user' };
  const bob = { name: 'Bob', email: 'bob@x', role: 'user' };
  const adm = { name: 'Root', email: 'root@x', role: 'admin' };
  it('author edits and deletes; others cannot; admin may only delete comments, never the markup', () => {
    expect([canEditComment(c, ann), canDeleteComment(c, ann)]).toEqual([true, true]);
    expect([canEditComment(c, bob), canDeleteComment(c, bob)]).toEqual([false, false]);
    expect([canEditComment(c, adm), canDeleteComment(c, adm)]).toEqual([false, true]);
    expect([canDeleteMarkup(m(), bob), canDeleteMarkup(m(), ann), canDeleteMarkup(m(), adm)]).toEqual([false, true, false]);
  });
});
