export const MAX_STAMP_SOURCE_BYTES = 20 * 1024 * 1024;
// Keep the full markup below the server's 256 KiB per-markup limit.
export const MAX_STAMP_DATA_LENGTH = 180_000;
export const MAX_STAMP_SIDE = 800;

export interface StampImage {
  data: string;
  width: number;
  height: number;
}

export function validStampImage(image: StampImage): boolean {
  return !!image && Number.isInteger(image.width) && image.width > 0 && image.width <= MAX_STAMP_SIDE &&
    Number.isInteger(image.height) && image.height > 0 && image.height <= MAX_STAMP_SIDE &&
    typeof image.data === 'string' && image.data.length <= MAX_STAMP_DATA_LENGTH &&
    /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(image.data);
}

export function stampDimensions(width: number, height: number, maxSide = MAX_STAMP_SIDE): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 ||
      width > 100_000 || height > 100_000 || width * height > 100_000_000) {
    throw new Error('The image or PDF page has invalid or excessively large dimensions.');
  }
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Canvas conversion is shared by image and PDF imports; reduce dimensions to fit server limits. */
export function encodeStampCanvas(source: HTMLCanvasElement): StampImage {
  let canvas = source;
  for (;;) {
    const data = canvas.toDataURL('image/png');
    const image = { data, width: canvas.width, height: canvas.height };
    if (validStampImage(image)) return image;
    if (canvas.width <= 64 && canvas.height <= 64) throw new Error('The stamp is too complex to fit the shared markup size limit.');
    const next = document.createElement('canvas');
    next.width = Math.max(1, Math.round(canvas.width * 0.75));
    next.height = Math.max(1, Math.round(canvas.height * 0.75));
    const ctx = next.getContext('2d');
    if (!ctx) throw new Error('Could not create stamp image canvas.');
    ctx.drawImage(canvas, 0, 0, next.width, next.height);
    canvas = next;
  }
}
