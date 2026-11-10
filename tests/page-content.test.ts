import { createCanvas } from '@napi-rs/canvas';
import { degrees, PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { addPdfPng, addPdfSymbol, addPdfText, bakePageObjects, resizePageObject } from '../src/core/pageContent';

describe('PDF page content tools', () => {
  it('resizes text, symbols, and signatures while preserving their aspect ratio', () => {
    const base = { id: 'item', page: 0, x: 10, y: 20, width: 100, height: 50, color: '#202020', fontSize: 20 };
    for (const kind of ['text', 'symbol', 'signature'] as const) {
      const object = resizePageObject({ ...base, kind }, 50, 25);
      expect(object.width / object.height).toBeCloseTo(2);
      if (kind === 'text') expect(object.fontSize).toBe(30);
    }
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
