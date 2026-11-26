import { createCanvas } from '@napi-rs/canvas';
import { degrees, PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { addPdfPng, addPdfSymbol, addPdfText, bakePageObjects, fitPageText, pageTextWidth, resizePageObject, wrapPageText } from '../src/core/pageContent';

describe('PDF page content tools', () => {
  it('wraps page text onto new lines at the text box width', () => {
    const lines = wrapPageText('The quick brown fox jumps over the lazy dog', 100, 12);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe('The quick brown fox jumps over the lazy dog');
    for (const line of lines) expect(pageTextWidth(line, 12)).toBeLessThanOrEqual(100.01);
    expect(wrapPageText('first\nsecond', 500, 12)).toEqual(['first', 'second']);
    const long = wrapPageText('A'.repeat(40), 60, 12);
    expect(long.join('')).toBe('A'.repeat(40));
    for (const line of long) expect(pageTextWidth(line, 12)).toBeLessThanOrEqual(60.01);
  });

  it('sizes text boxes to their text but wraps at the page edge', () => {
    const base = { id: 't', page: 0, kind: 'text' as const, x: 400, y: 50, width: 144, height: 36, color: '#202020', fontSize: 24, text: 'Text' };
    const short = fitPageText(base, 'Hi', 612);
    expect(short.width).toBeCloseTo(Math.max(40, pageTextWidth('Hi', 24)));
    const long = fitPageText(base, 'This sentence is far too long to fit before the right edge of the page', 612);
    expect(long.x + long.width).toBeLessThanOrEqual(612);
    const lines = wrapPageText(long.text!, long.width, 24).length;
    expect(lines).toBeGreaterThan(1);
    expect(long.height).toBeCloseTo(lines * 24 * 1.2 + 24 * 0.15);
    const edited = fitPageText(long, long.text + ' and then some more words', 612);
    expect(edited.width).toBeCloseTo(long.width);
  });

  it('wraps baked page text inside its box', async () => {
    const source = await PDFDocument.create();
    source.addPage([300, 400]);
    const object = { id: 'w', page: 0, kind: 'text' as const, x: 20, y: 20, width: 120, height: 30, color: '#202020', fontSize: 14, text: 'One two three four five six seven eight' };
    const bytes = await bakePageObjects(await source.save(), [object]);
    const renderedPdf = await getDocument({ data: bytes }).promise;
    try {
      const page = await renderedPdf.getPage(1);
      const items = (await page.getTextContent()).items.filter((item) => 'str' in item && item.str.trim());
      const rows = new Set(items.map((item) => Math.round(('transform' in item ? item.transform[5] : 0))));
      expect(rows.size).toBe(wrapPageText(object.text, object.width, object.fontSize).length);
      expect(rows.size).toBeGreaterThan(1);
    } finally {
      await renderedPdf.destroy();
    }
  });

  it('resizes symbols and signatures while preserving their aspect ratio', () => {
    const base = { id: 'item', page: 0, x: 10, y: 20, width: 100, height: 50, color: '#202020', fontSize: 20 };
    for (const kind of ['symbol', 'signature'] as const) {
      const object = resizePageObject({ ...base, kind }, 50, 25);
      expect(object.width / object.height).toBeCloseTo(2);
    }
  });

  it('resizes text boxes without changing the text size', () => {
    const text = 'Resizing the box rewraps this text';
    const base = { id: 'text', page: 0, kind: 'text' as const, x: 10, y: 20, width: pageTextWidth(text, 20), height: 27, color: '#202020', fontSize: 20, text };
    const narrow = resizePageObject(base, -150, 0, 612);
    expect(narrow.fontSize).toBe(20);
    expect(narrow.fixedWidth).toBe(true);
    expect(narrow.width).toBeCloseTo(base.width - 150);
    const lines = wrapPageText(text, narrow.width, 20).length;
    expect(lines).toBeGreaterThan(1);
    expect(narrow.height).toBeGreaterThanOrEqual(lines * 20 * 1.2);
    const tall = resizePageObject(base, 0, 100, 612);
    expect(tall.height).toBeCloseTo(127);
    expect(tall.fontSize).toBe(20);
    expect(resizePageObject(base, 5000, 0, 612).width).toBeLessThanOrEqual(612 - base.x);
  });

  it('changes text size and keeps a resized box width when editing', () => {
    const base = { id: 't', page: 0, kind: 'text' as const, x: 50, y: 50, width: 144, height: 36, color: '#202020', fontSize: 24, text: 'Text' };
    const bigger = fitPageText(base, 'Hello', 612, 36);
    expect(bigger.fontSize).toBe(36);
    expect(bigger.width).toBeCloseTo(pageTextWidth('Hello', 36));
    const resized = resizePageObject(bigger, 200, 0, 612);
    const edited = fitPageText(resized, 'Hi', 612, 18);
    expect(edited.width).toBeCloseTo(resized.width);
    expect(edited.fontSize).toBe(18);
    expect(fitPageText(base, 'line one\nline two\nline three', 612).height).toBeCloseTo(3 * 24 * 1.2 + 24 * 0.15);
  });

  it('adds searchable editable text to page content without creating an annotation', async () => {
    const source = await PDFDocument.create();
    source.addPage([300, 400]);
    const bytes = await addPdfText(await source.save(), 0, { x: 20, y: 30 }, 'Editable page text', 18, '#202020');
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPages()[0].node.Annots()?.size() ?? 0).toBe(0);

    const renderedPdf = await getDocument({ data: bytes }).promise;
    try {
      const page = await renderedPdf.getPage(1);
      const text = await page.getTextContent();
      expect(text.items.map((item) => 'str' in item ? item.str : '').join('')).toContain('Editable page text');
    } finally {
      await renderedPdf.destroy();
    }
  });

  it('draws symbols and transparent PNGs into page content instead of annotations', async () => {
    const source = await PDFDocument.create();
    source.addPage([300, 400]);
    const bytes = await addPdfSymbol(await source.save(), 0, { x: 40, y: 40 }, 'check', 24, '#008000');
    const canvas = createCanvas(8, 8);
    const context = canvas.getContext('2d');
    context.fillStyle = '#e53935';
    context.fillRect(0, 0, 8, 8);
    const image = `data:image/png;base64,${Buffer.from(await canvas.encode('png')).toString('base64')}`;
    const withImage = await addPdfPng(bytes, 0, { x: 80, y: 80 }, image, 8, 8, 24);
    const pdf = await PDFDocument.load(withImage);
    expect(pdf.getPages()[0].node.Annots()?.size() ?? 0).toBe(0);
    expect(pdf.getPages()[0].node.Contents()).toBeTruthy();
  });

  it('keeps a placed PNG aligned with the viewport on a rotated page', async () => {
    const source = await PDFDocument.create();
    source.addPage([300, 400]).setRotation(degrees(90));
    const canvas = createCanvas(16, 8);
    const context = canvas.getContext('2d');
    context.fillStyle = '#e53935';
    context.fillRect(0, 0, 16, 8);
    const image = `data:image/png;base64,${Buffer.from(await canvas.encode('png')).toString('base64')}`;
    const bytes = await addPdfPng(await source.save(), 0, { x: 30, y: 40 }, image, 16, 8, 40);
    const renderedPdf = await getDocument({ data: bytes }).promise;
    try {
      const page = await renderedPdf.getPage(1);
      const viewport = page.getViewport({ scale: 1 });
      expect(viewport.width).toBe(400);
      expect(viewport.height).toBe(300);
      const rendered = createCanvas(viewport.width, viewport.height);
      const renderContext = rendered.getContext('2d');
      await page.render({
        canvasContext: renderContext as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;
      const pixels = renderContext.getImageData(0, 0, viewport.width, viewport.height).data;
      const red = [];
      for (let y = 0; y < viewport.height; y++) {
        for (let x = 0; x < viewport.width; x++) {
          const index = (y * viewport.width + x) * 4;
          if (pixels[index] > 170 && pixels[index + 1] < 100) red.push({ x, y });
        }
      }
      expect(Math.min(...red.map((point) => point.x))).toBeCloseTo(30, 0);
      expect(Math.max(...red.map((point) => point.x))).toBeCloseTo(69, 0);
      expect(Math.min(...red.map((point) => point.y))).toBeCloseTo(40, 0);
      expect(Math.max(...red.map((point) => point.y))).toBeCloseTo(59, 0);
    } finally {
      await renderedPdf.destroy();
    }
  });

  it('bakes editable page objects as page content without creating annotations', async () => {
    const source = await PDFDocument.create();
    source.addPage([300, 400]);
    const canvas = createCanvas(8, 8);
    const context = canvas.getContext('2d');
    context.fillStyle = '#006600';
    context.fillRect(0, 0, 8, 8);
    const signature = { id: 'sig', name: 'Signature', data: `data:image/png;base64,${Buffer.from(await canvas.encode('png')).toString('base64')}`, width: 8, height: 8 };
    const bytes = await bakePageObjects(await source.save(), [
      { id: 'text', page: 0, kind: 'text', x: 20, y: 20, width: 100, height: 30, color: '#202020', fontSize: 18, text: 'Editable text' },
      { id: 'symbol', page: 0, kind: 'symbol', x: 80, y: 80, width: 24, height: 24, color: '#ff0000', fontSize: 24, symbol: 'check' },
      { id: 'signature-object', page: 0, kind: 'signature', x: 120, y: 120, width: 40, height: 40, color: '#000000', fontSize: 0, signature },
    ]);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPages()[0].node.Annots()?.size() ?? 0).toBe(0);
    const renderedPdf = await getDocument({ data: bytes }).promise;
    try {
      const page = await renderedPdf.getPage(1);
      const text = await page.getTextContent();
      expect(text.items.map((item) => 'str' in item ? item.str : '').join('')).toContain('Editable text');
    } finally {
      await renderedPdf.destroy();
    }
  });
});
