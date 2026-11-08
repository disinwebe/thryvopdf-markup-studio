import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream } from 'pdf-lib';
import { MarkupShape } from '../src/components/MarkupShape';
import { DEFAULT_CAL } from '../src/core/measurement';
import { buildAppearance, readState, saveWithState } from '../src/core/annotations';
import { calloutLayout } from '../src/core/callout';
import { markupCsv } from '../src/core/markupCsv';
import type { Markup } from '../src/core/types';

const m: Markup = { id: 'm1', type: 'rect', page: 0, points: [{ x: 10, y: 20 }, { x: 70, y: 60 }], color: '#000000', width: 2, opacity: 0.3, status: 'None', author: 'A', date: '2026-01-01T00:00:00Z', comments: [{ id: 'c1', author: 'B', date: '2026-01-01', text: 'Review text' }], callout: { x: 100, y: 80 } };
const stamp: Markup = { ...m, id: 'stamp', type: 'stamp', stamp: 'APPROVED' };

describe('visible review comments', () => {
  it('renders a high contrast numbered tag, border and leader on screen', () => {
    const svg = renderToStaticMarkup(<svg><MarkupShape m={m} cal={DEFAULT_CAL} tag={1} /></svg>);
    expect(svg).toContain('class="review-tag"');
    expect(svg).toContain('#1</text>');
    expect(svg).toContain('class="callout-box"');
    expect(svg).toContain('stroke="#e11d48"');
    expect(svg).toContain('stroke-width="1.5"');
    expect(svg).toContain('Review text');
  });
  it('draws the PDF box in page coordinates with a number and full-opacity stroke', () => {
    const appearance = buildAppearance(m, { x0: 0, y0: 0, w: 400, h: 300, rotation: 0 }, DEFAULT_CAL, 1);
    const box = calloutLayout(m)!;
    expect(appearance.ops).toContain(`100 220 m 250 220 l 250 ${+(300 - 80 - box.h).toFixed(3)} l 100 ${+(300 - 80 - box.h).toFixed(3)} l h B`);
    expect(appearance.ops).toContain('/GS1 gs 0.882 0.114 0.282 RG 1.5 w');
    expect(appearance.ops).toContain('(#1) Tj');
  });
  it('omits comment author from saved appearance and Contents without changing the app review data', async () => {
    const comment = { ...m.comments[0], author: 'Distinct Author', text: 'Author: this text is literal' };
    const original = await PDFDocument.create();
    original.addPage([400, 300]);
    const bytes = await saveWithState(await original.save(), { markups: [{ ...m, comments: [comment] }], calibrations: {}, sheets: {}, bookmarks: [] });
    const saved = await PDFDocument.load(bytes);
    const annotation = (saved.getPages()[0].node.Annots() as PDFArray).lookup(0, PDFDict);
    expect(annotation.lookup(PDFName.of('Contents'), PDFHexString).decodeText()).toBe(comment.text);
    expect(annotation.lookup(PDFName.of('T'), PDFHexString).decodeText()).toBe('A');
    const ap = annotation.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N'));
    expect(ap).toBeInstanceOf(PDFRawStream);
    const ops = new TextDecoder().decode((ap as PDFRawStream).contents);
    expect(ops).toContain('(Author: this text is literal) Tj');
    expect(ops).not.toContain('Distinct Author');
    expect((await readState(saved)).markups[0].comments[0]).toEqual(comment);
    expect(renderToStaticMarkup(<svg><MarkupShape m={{ ...m, comments: [comment] }} cal={DEFAULT_CAL} tag={1} /></svg>)).toContain('Distinct Author');
  });
  it('does not render a tag or comment box for a legacy stamp', async () => {
    expect(calloutLayout(stamp)).toBeNull();
    const svg = renderToStaticMarkup(<svg><MarkupShape m={stamp} cal={DEFAULT_CAL} tag={1} /></svg>);
    expect(svg).not.toContain('review-tag');
    expect(svg).not.toContain('callout-box');
    expect(markupCsv([stamp], 'test.pdf')).not.toContain('Review text');
    const original = await PDFDocument.create();
    original.addPage([400, 300]);
    const bytes = await saveWithState(await original.save(), { markups: [stamp], calibrations: {}, sheets: {}, bookmarks: [] });
    const saved = await PDFDocument.load(bytes);
    const annots = saved.getPages()[0].node.Annots() as PDFArray;
    expect(annots.size()).toBe(1);
    const annotation = annots.lookup(0, PDFDict);
    expect(annotation.has(PDFName.of('Popup'))).toBe(false);
    expect(annotation.has(PDFName.of('Contents'))).toBe(false);
    const appearance = annotation.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N'));
    expect(appearance).toBeInstanceOf(PDFRawStream);
    expect(new TextDecoder().decode((appearance as PDFRawStream).contents)).not.toContain('Review text');
    expect((await readState(saved)).markups[0].comments).toEqual(stamp.comments);
  });
});
