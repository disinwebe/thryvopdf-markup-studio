import { loadPdf } from '../pdf/pdfjs';
import { encodeStampCanvas, MAX_STAMP_SOURCE_BYTES, stampDimensions, StampImage } from '../core/stamp';

export async function importStamp(file: PickedFile, choosePage: (total: number) => number | null): Promise<StampImage | null> {
  if (!file.data.length || file.data.length > MAX_STAMP_SOURCE_BYTES) throw new Error('Choose a non-empty image or PDF smaller than 20 MB.');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create stamp image canvas.');
  if (/\.pdf$/i.test(file.name)) {
    const pdf = await loadPdf(file.data);
    try {
      const pageNo = pdf.numPages === 1 ? 1 : choosePage(pdf.numPages);
      if (pageNo === null) return null;
      if (!Number.isInteger(pageNo) || pageNo < 1 || pageNo > pdf.numPages) throw new Error(`Choose a page from 1 to ${pdf.numPages}.`);
      const page = await pdf.getPage(pageNo);
      const base = page.getViewport({ scale: 1 });
      const size = stampDimensions(base.width, base.height);
      canvas.width = size.width;
      canvas.height = size.height;
      const viewport = page.getViewport({ scale: Math.min(size.width / base.width, size.height / base.height) });
      await page.render({ canvasContext: ctx, viewport }).promise;
    } finally {
      await pdf.destroy();
    }
  } else {
    const ext = file.name.split('.').pop()?.toLowerCase();
    const mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
      ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : ext === 'bmp' ? 'image/bmp' : '';
    if (!mime) throw new Error('Choose a PNG, JPEG, WebP, GIF, BMP, or PDF file.');
    const blob = new Blob([file.data as BlobPart], { type: mime });
    const bitmap = await createImageBitmap(blob);
    try {
      const size = stampDimensions(bitmap.width, bitmap.height);
      canvas.width = size.width;
      canvas.height = size.height;
      ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    } finally {
      bitmap.close();
    }
  }
  return encodeStampCanvas(canvas);
}
