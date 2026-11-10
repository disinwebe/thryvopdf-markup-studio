import { renderToStaticMarkup } from 'react-dom/server';
import { PDFDocument } from 'pdf-lib';
import { countNumbers, DEFAULT_CAL } from '../core/measurement';
import { numberMarkups } from '../core/numbering';
import { pageGeom, saveWithState, type DocState } from '../core/annotations';
import type { Markup } from '../core/types';
import { MarkupShape } from '../components/MarkupShape';
import { flattenMarkups, type PageRaster } from '../core/flatten';
import { orderedPageLayers } from '../core/layerOrder';
import type { PageObject } from '../core/pageContent';

function pageTransform(rotation: number, width: number, height: number) {
  switch (rotation) {
    case 90:
      return `matrix(0 -1 1 0 0 ${height})`;
    case 180:
      return `matrix(-1 0 0 -1 ${width} ${height})`;
    case 270:
      return `matrix(0 1 -1 0 ${width} 0)`;
    default:
      return '';
  }
}

async function toPng(svg: string, width: number, height: number): Promise<Uint8Array> {
  const blobUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    image.src = blobUrl;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create a canvas for rasterizing the markup.');
    context.drawImage(image, 0, 0, width, height);
    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Could not encode the rasterized markup.')), 'image/png');
    });
    return new Uint8Array(await png.arrayBuffer());
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

function pageObjectSvg(object: PageObject): string {
  if (object.kind === 'signature' && object.signature) {
    return `<image href="${object.signature.data}" x="${object.x}" y="${object.y}" width="${object.width}" height="${object.height}" preserveAspectRatio="none"/>`;
  }
  if (object.kind === 'symbol') {
    const glyphs = { check: '✓', x: '×', star: '★', circle: '●', 'open-circle': '○', plus: '+', minus: '−', question: '?', exclamation: '!' };
    return `<text x="${object.x + object.width / 2}" y="${object.y + object.height * 0.82}" text-anchor="middle" font-size="${object.height}" fill="${object.color}">${glyphs[object.symbol ?? 'check']}</text>`;
  }
  const lines = (object.text ?? '').split(/\r?\n/).map((line, index) =>
    `<tspan x="${object.x}" dy="${index === 0 ? 0 : object.fontSize * 1.2}">${escapeXml(line)}</tspan>`).join('');
  return `<text x="${object.x}" y="${object.y + object.fontSize}" font-size="${object.fontSize}" fill="${object.color}" font-family="Helvetica, Arial, sans-serif">${lines}</text>`;
}

function escapeXml(text: string): string {
  return text.replace(/[<>&'"]/g, (character) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
  })[character]!);
}

/** Flattens only stamps and the Text/Symbol/Signature page objects as one ordered visual layer. */
export async function flattenStackableLayers(
  bytes: Uint8Array,
  state: DocState,
  pageObjects: PageObject[],
  stampIds?: string[],
): Promise<{ bytes: Uint8Array; markups: Markup[] }> {
  const requestedStamps = stampIds ? new Set(stampIds) : null;
  const stamps = state.markups.filter((markup) => markup.type === 'stamp' && (!requestedStamps || requestedStamps.has(markup.id)));
  const stackableIds = new Set(stamps.map((markup) => markup.id));
  const pages = new Set([...stamps.map((markup) => markup.page), ...pageObjects.map((object) => object.page)]);
  if (!pages.size) return { bytes: await saveWithState(bytes, state), markups: state.markups };

  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const rasters: PageRaster[] = [];
  for (const pageIndex of pages) {
    const page = pdf.getPages()[pageIndex];
    if (!page) throw new Error(`Could not find PDF page ${pageIndex + 1} for flattening.`);
    const geometry = pageGeom(page);
    const scale = Math.min(3, 4096 / Math.max(geometry.w, geometry.h), Math.sqrt(16_000_000 / (geometry.w * geometry.h)));
    const width = Math.max(1, Math.ceil(geometry.w * scale));
    const height = Math.max(1, Math.ceil(geometry.h * scale));
    const stack = orderedPageLayers(
      stamps.filter((markup) => markup.page === pageIndex),
      pageObjects.filter((object) => object.page === pageIndex),
    );
    const shapes = stack.map((layer) => layer.kind === 'markup'
      ? renderToStaticMarkup(<MarkupShape m={layer.value} cal={state.calibrations[pageIndex] ?? DEFAULT_CAL} />)
      : pageObjectSvg(layer.value)).join('');
    const transform = pageTransform(geometry.rotation, geometry.w, geometry.h);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${geometry.w} ${geometry.h}">${transform ? `<g transform="${transform}">${shapes}</g>` : shapes}</svg>`;
    rasters.push({ page: pageIndex, png: await toPng(svg, width, height) });
  }

  const markups = state.markups.filter((markup) => !stackableIds.has(markup.id));
  for (const raster of rasters) {
    const page = pdf.getPages()[raster.page];
    const image = await pdf.embedPng(raster.png);
    const crop = page.getCropBox();
    page.drawImage(image, { x: crop.x, y: crop.y, width: crop.width, height: crop.height });
  }
  const flattened = await pdf.save();
  return { bytes: await saveWithState(flattened, { ...state, markups }), markups };
}

export async function rasterizeMarkups(
  bytes: Uint8Array,
  state: DocState,
  markupIds: string[],
): Promise<{ bytes: Uint8Array; markups: Markup[] }> {
  const targetIds = new Set(markupIds);
  const targets = state.markups.filter((markup) => targetIds.has(markup.id));
  if (!targets.length) throw new Error('No markups were selected to flatten.');

  const prepared = await saveWithState(bytes, state);
  const pdf = await PDFDocument.load(prepared, { ignoreEncryption: true });
  const numbers = numberMarkups(state.markups);
  const countNos = countNumbers(state.markups);
  const byPage = new Map<number, Markup[]>();
  for (const markup of targets) byPage.set(markup.page, [...(byPage.get(markup.page) ?? []), markup]);

  const rasters: PageRaster[] = [];
  for (const [pageIndex, markups] of byPage) {
    const page = pdf.getPages()[pageIndex];
    if (!page) throw new Error(`Could not find PDF page ${pageIndex + 1} for flattening.`);
    const geometry = pageGeom(page);
    const scale = Math.min(3, 4096 / Math.max(geometry.w, geometry.h), Math.sqrt(16_000_000 / (geometry.w * geometry.h)));
    const width = Math.max(1, Math.ceil(geometry.w * scale));
    const height = Math.max(1, Math.ceil(geometry.h * scale));
    const shapes = markups.map((markup) => renderToStaticMarkup(
      <MarkupShape
        m={markup}
        cal={state.calibrations[pageIndex] ?? DEFAULT_CAL}
        countNo={countNos.get(markup.id)}
        tag={numbers.get(markup.id)}
      />,
    )).join('');
    const transform = pageTransform(geometry.rotation, geometry.w, geometry.h);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${geometry.w} ${geometry.h}">${transform ? `<g transform="${transform}">${shapes}</g>` : shapes}</svg>`;
    rasters.push({ page: pageIndex, png: await toPng(svg, width, height) });
  }

  return flattenMarkups(bytes, state, markupIds, rasters);
}
