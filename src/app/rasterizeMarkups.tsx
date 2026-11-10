import { renderToStaticMarkup } from 'react-dom/server';
import { PDFDocument } from 'pdf-lib';
import { countNumbers, DEFAULT_CAL } from '../core/measurement';
import { numberMarkups } from '../core/numbering';
import { pageGeom, saveWithState, type DocState } from '../core/annotations';
import type { Markup } from '../core/types';
import { MarkupShape } from '../components/MarkupShape';
import { flattenMarkups, type PageRaster } from '../core/flatten';

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
