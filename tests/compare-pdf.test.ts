import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { prepareComparisonPdf } from '../src/core/comparePdf';
import type { DocState } from '../src/core/annotations';

describe('Compare document preparation', () => {
  it('includes live markup annotations, comment callouts, and page-content text', async () => {
    const source = await PDFDocument.create();
    source.addPage([300, 400]);
    const state: DocState = {
      markups: [{
        id: 'cloud-review',
        page: 0,
        type: 'cloud',
        points: [{ x: 20, y: 30 }, { x: 100, y: 30 }, { x: 20, y: 110 }],
        color: '#e53935',
        width: 2,
        opacity: 1,
        status: 'None',
        author: 'Reviewer',
        date: '2026-11-10T00:00:00Z',
        comments: [{ id: 'comment', author: 'Reviewer', date: '2026-11-10T00:00:00Z', text: 'Check this cloud.' }],
        callout: { x: 140, y: 40 },
      }],
      calibrations: {},
      sheets: {},
      bookmarks: [],
    };
    const pageObjects = [{
      id: 'review-text',
      page: 0,
      kind: 'text' as const,
      x: 150,
      y: 180,
      width: 100,
      height: 24,
      color: '#202020',
      fontSize: 18,
      text: 'Compare text',
    }];
    const bytes = await prepareComparisonPdf(await source.save(), pageObjects, state);
    const pdf = await getDocument({ data: bytes }).promise;
    try {
      const page = await pdf.getPage(1);
      const annotations = await page.getAnnotations({ intent: 'display' });
      expect(annotations.some((annotation) => annotation.subtype === 'Square')).toBe(true);
      expect(annotations.some((annotation) => annotation.subtype === 'Popup')).toBe(true);
      const textContent = await page.getTextContent();
      expect(textContent.items.map((item) => 'str' in item ? item.str : '').join('')).toContain('Compare text');
    } finally {
      await pdf.destroy();
    }
  });
});
