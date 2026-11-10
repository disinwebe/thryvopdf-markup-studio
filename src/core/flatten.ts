import { PDFDocument } from 'pdf-lib';
import { saveWithState, type DocState } from './annotations';

export interface PageRaster {
  page: number;
  png: Uint8Array;
}

/** Replaces selected app markups with transparent raster layers in the PDF page content. */
export async function flattenMarkups(
  bytes: Uint8Array,
  state: DocState,
  markupIds: string[],
  rasters: PageRaster[],
): Promise<{ bytes: Uint8Array; markups: DocState['markups'] }> {
  const targets = new Set(markupIds);
  if (!targets.size || !state.markups.some((markup) => targets.has(markup.id))) {
    throw new Error('No markups were selected to flatten.');
  }

  const prepared = await saveWithState(bytes, state);
  const pdf = await PDFDocument.load(prepared, { ignoreEncryption: true });
  for (const raster of rasters) {
    const page = pdf.getPages()[raster.page];
    if (!page) throw new Error(`Could not find PDF page ${raster.page + 1} for flattening.`);
    const image = await pdf.embedPng(raster.png);
    const crop = page.getCropBox();
    page.drawImage(image, {
      x: crop.x,
      y: crop.y,
      width: crop.width,
      height: crop.height,
    });
  }

  const markups = state.markups.filter((markup) => !targets.has(markup.id));
  const flattened = await pdf.save();
  return {
    bytes: await saveWithState(flattened, { ...state, markups }),
    markups,
  };
}
