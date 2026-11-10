import { degrees, PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import type { SavedSignature } from '../app/signatures';
import { pageGeom, viewToPdf } from './annotations';
import type { Pt } from './types';

export const SYMBOLS = [
  { value: 'check', label: 'Check mark', glyph: '✓' },
  { value: 'x', label: 'X mark', glyph: '×' },
  { value: 'star', label: 'Star', glyph: '★' },
  { value: 'circle', label: 'Circle', glyph: '●' },
  { value: 'open-circle', label: 'Open circle', glyph: '○' },
  { value: 'plus', label: 'Plus', glyph: '+' },
  { value: 'minus', label: 'Minus', glyph: '−' },
  { value: 'question', label: 'Question mark', glyph: '?' },
  { value: 'exclamation', label: 'Exclamation mark', glyph: '!' },
] as const;

export type PdfSymbol = typeof SYMBOLS[number]['value'];
export interface PageObject {
  id: string;
  page: number;
  kind: 'text' | 'symbol' | 'signature';
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  fontSize: number;
  text?: string;
  symbol?: PdfSymbol;
  signature?: SavedSignature;
  zOrder?: number;
}

export function resizePageObject(object: PageObject, dx: number, dy: number): PageObject {
  const scale = Math.max(0.1, Math.max((object.width + dx) / object.width, (object.height + dy) / object.height));
  return {
    ...object,
    width: object.width * scale,
    height: object.height * scale,
    fontSize: object.kind === 'text' ? Math.max(6, object.fontSize * scale) : object.fontSize,
  };
}

export type PageContentTool =
  | { kind: 'text'; size: number; color: string }
  | { kind: 'symbol'; symbol: PdfSymbol; size: number; color: string }
  | { kind: 'signature'; signature: SavedSignature };

export async function bakePageObjects(bytes: Uint8Array, objects: PageObject[]): Promise<Uint8Array> {
  let result = bytes;
  const sortedObjects = objects.map((object, index) => ({ object, index })).sort((a, b) =>
    (a.object.zOrder ?? a.index) - (b.object.zOrder ?? b.index) || a.index - b.index);
  for (const { object } of sortedObjects) {
    if (object.kind === 'text') {
      result = await addPdfText(result, object.page, { x: object.x, y: object.y }, object.text ?? '', object.fontSize, object.color);
    } else if (object.kind === 'symbol' && object.symbol) {
      result = await addPdfSymbol(result, object.page, { x: object.x + object.width / 2, y: object.y + object.height / 2 }, object.symbol, Math.min(object.width, object.height), object.color);
    } else if (object.kind === 'signature' && object.signature) {
      result = await addPdfPng(result, object.page, { x: object.x, y: object.y }, object.signature.data, object.signature.width, object.signature.height, object.width);
    }
  }
  return result;
}

const pdfColor = (value: string) => {
  const match = /^#?([0-9a-f]{6})$/i.exec(value);
  const hex = match?.[1] ?? '202020';
  return rgb(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255);
};

async function loadTarget(bytes: Uint8Array, pageIndex: number) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const page = pdf.getPages()[pageIndex];
  if (!page) throw new Error(`Could not find PDF page ${pageIndex + 1}.`);
  return { pdf, page, geom: pageGeom(page) };
}

export async function addPdfText(
  bytes: Uint8Array,
  pageIndex: number,
  position: Pt,
  text: string,
  size: number,
  color: string,
): Promise<Uint8Array> {
  const value = text.trim();
  if (!value) throw new Error('Enter text before placing it on the PDF.');
  const { pdf, page, geom } = await loadTarget(bytes, pageIndex);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const lines = value.split(/\r?\n/);
  const baseline = viewToPdf({ x: position.x, y: position.y + size }, geom);
  page.drawText(lines.join('\n'), {
    x: baseline.x,
    y: baseline.y,
    size,
    lineHeight: size * 1.2,
    font,
    color: pdfColor(color),
    rotate: degrees(-geom.rotation),
  });
  return pdf.save();
}

export async function addPdfPng(
  bytes: Uint8Array,
  pageIndex: number,
  position: Pt,
  imageData: string,
  imageWidth: number,
  imageHeight: number,
  width: number,
): Promise<Uint8Array> {
  const { pdf, page, geom } = await loadTarget(bytes, pageIndex);
  const image = await pdf.embedPng(imageData);
  const height = width * imageHeight / imageWidth;
  const center = viewToPdf({ x: position.x + width / 2, y: position.y + height / 2 }, geom);
  const rotation = -geom.rotation * Math.PI / 180;
  const originX = center.x - (Math.cos(rotation) * width / 2 - Math.sin(rotation) * height / 2);
  const originY = center.y - (Math.sin(rotation) * width / 2 + Math.cos(rotation) * height / 2);
  page.drawImage(image, {
    x: originX,
    y: originY,
    width,
    height,
    rotate: degrees(-geom.rotation),
  });
  return pdf.save();
}

export async function addPdfSymbol(
  bytes: Uint8Array,
  pageIndex: number,
  center: Pt,
  symbol: PdfSymbol,
  size: number,
  color: string,
): Promise<Uint8Array> {
  const { pdf, page, geom } = await loadTarget(bytes, pageIndex);
  const c = pdfColor(color);
  const pt = (x: number, y: number) => viewToPdf({ x, y }, geom);
  const line = (a: Pt, b: Pt, thickness = Math.max(2, size / 10)) => {
    const start = pt(a.x, a.y);
    const end = pt(b.x, b.y);
    page.drawLine({ start, end, thickness, color: c });
  };
  const left = center.x - size / 2;
  const top = center.y - size / 2;
  switch (symbol) {
    case 'check':
      line({ x: left + size * .12, y: top + size * .52 }, { x: left + size * .4, y: top + size * .8 });
      line({ x: left + size * .4, y: top + size * .8 }, { x: left + size * .9, y: top + size * .18 });
      break;
    case 'x':
      line({ x: left + size * .18, y: top + size * .18 }, { x: left + size * .82, y: top + size * .82 });
      line({ x: left + size * .82, y: top + size * .18 }, { x: left + size * .18, y: top + size * .82 });
      break;
    case 'star': {
      const points = Array.from({ length: 10 }, (_, index) => {
        const radius = index % 2 ? size * .22 : size * .48;
        const angle = -Math.PI / 2 + index * Math.PI / 5;
        return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
      });
      points.forEach((point, index) => line(point, points[(index + 1) % points.length]));
      break;
    }
    case 'circle':
    case 'open-circle': {
      const centerPdf = pt(center.x, center.y);
      page.drawCircle({
        x: centerPdf.x,
        y: centerPdf.y,
        size: size * .42,
        color: symbol === 'circle' ? c : undefined,
        borderColor: c,
        borderWidth: Math.max(2, size / 10),
      });
      break;
    }
    case 'plus':
      line({ x: center.x, y: top + size * .1 }, { x: center.x, y: top + size * .9 });
      line({ x: left + size * .1, y: center.y }, { x: left + size * .9, y: center.y });
      break;
    case 'minus':
      line({ x: left + size * .1, y: center.y }, { x: left + size * .9, y: center.y });
      break;
    case 'question':
    case 'exclamation': {
      const font = await pdf.embedFont(StandardFonts.HelveticaBold);
      const glyph = symbol === 'question' ? '?' : '!';
      const baseline = pt(center.x - size * .22, center.y - size * .34);
      page.drawText(glyph, { x: baseline.x, y: baseline.y, size, font, color: c, rotate: degrees(-geom.rotation) });
      break;
    }
  }
  return pdf.save();
}
