import { describe, expect, it } from 'vitest';
import { anchorOf, calloutLayout, defaultCalloutPos, hitCallout, moveCallout } from '../src/core/callout';
import { canDeleteComment, canDeleteMarkup, canEditComment } from '../src/core/comments';
import { translate } from '../src/core/geometry';
import { saveWithState, readState } from '../src/core/annotations';
import { Markup } from '../src/core/types';
import { PDFDocument } from 'pdf-lib';

const m = (extra: Partial<Markup> = {}): Markup => ({
  id: 'a', page: 0, type: 'arrow', points: [{ x: 10, y: 10 }, { x: 90, y: 60 }], color: '#f00', width: 2, opacity: 1,
  status: 'None', author: 'Ann', date: '2024-01-01T00:00:00Z',
  comments: [{ id: 'c1', author: 'Ann', authorEmail: 'ann@x', date: '2024-01-02T00:00:00Z', text: 'Check the beam size here please' }], ...extra,
});

describe('comment callout geometry', () => {
  it('connects the leader to the last point of line-like annotations', () => {
    const l = calloutLayout(m({ type: 'line' }))!;
    expect(l.anchor).toEqual({ x: 90, y: 60 });
    expect(l.rows[0].head).toBe('Ann');
  });
  it('connects boxes at the border point nearest the comment box', () => {
    expect(anchorOf({ type: 'rect', points: [{ x: 0, y: 0 }, { x: 100, y: 50 }] }, { x: 300, y: 25 })).toEqual({ x: 100, y: 25 });
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
