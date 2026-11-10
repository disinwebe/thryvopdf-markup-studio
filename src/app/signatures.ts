import { uid } from '../core/types';

export interface SavedSignature {
  id: string;
  name: string;
  data: string;
  width: number;
  height: number;
}

const STORAGE_KEY = 'thryvopdf.signatures.v1';
const MAX_FILE_BYTES = 1_500_000;
const MAX_TOTAL_BYTES = 4_000_000;
const MAX_SIGNATURES = 12;
const WHITE_BACKGROUND_TOLERANCE = 16;

export function loadSignatures(): { items: SavedSignature[]; error?: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { items: [] };
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { items: [], error: 'Saved signatures could not be read.' };
    return {
      items: parsed.filter((item): item is SavedSignature =>
        !!item && typeof item.id === 'string' && typeof item.name === 'string' &&
        typeof item.data === 'string' && Number.isFinite(item.width) && Number.isFinite(item.height)),
    };
  } catch {
    return { items: [], error: 'Signature storage is unavailable in this app session.' };
  }
}

export function saveSignatures(signatures: SavedSignature[]): void {
  const totalBytes = signatures.reduce((total, signature) => total + Math.ceil(signature.data.length * 3 / 4), 0);
  if (signatures.length > MAX_SIGNATURES || totalBytes > MAX_TOTAL_BYTES) {
    throw new Error('Signature storage limit reached. Remove a signature or upload smaller PNG files.');
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(signatures));
  } catch {
    throw new Error('Could not save signatures to this device. Remove a signature or upload a smaller PNG.');
  }
}

export function removeWhiteBackground(pixels: Uint8ClampedArray): void {
  for (let index = 0; index < pixels.length; index += 4) {
    const sourceAlpha = pixels[index + 3];
    if (sourceAlpha === 0) continue;

    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const opacity = 255 - Math.min(red, green, blue);
    if (opacity <= WHITE_BACKGROUND_TOLERANCE) {
      pixels[index + 3] = 0;
      continue;
    }

    pixels[index] = Math.min(255, Math.round((red - 255 + opacity) * 255 / opacity));
    pixels[index + 1] = Math.min(255, Math.round((green - 255 + opacity) * 255 / opacity));
    pixels[index + 2] = Math.min(255, Math.round((blue - 255 + opacity) * 255 / opacity));
    pixels[index + 3] = Math.round(sourceAlpha * opacity / 255);
  }
}

export async function importSignature(
  file: File,
  currentSignatures: SavedSignature[] = loadSignatures().items,
  shouldRemoveWhiteBackground = false,
): Promise<SavedSignature> {
  if (file.type !== 'image/png' || !/\.png$/i.test(file.name)) throw new Error(`${file.name}: select a PNG file.`);
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name}: PNG exceeds the 1.5 MB size limit.`);
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read the PNG file.'));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
  const image = new Image();
  image.src = data;
  await image.decode();
  if (image.width < 1 || image.height < 1 || image.width > 4096 || image.height > 2048 || image.width * image.height > 4_000_000) {
    throw new Error(`${file.name}: image dimensions are too large.`);
  }
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Could not validate PNG transparency.');
  context.drawImage(image, 0, 0);
  const imageData = context.getImageData(0, 0, image.width, image.height);
  if (shouldRemoveWhiteBackground) removeWhiteBackground(imageData.data);
  const pixels = imageData.data;
  let transparent = false;
  let visible = false;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] === 0) transparent = true;
    else visible = true;
  }
  if (!transparent || !visible) throw new Error(`${file.name}: signature PNG must contain visible ink on a transparent background.`);
  if (currentSignatures.length >= MAX_SIGNATURES) throw new Error(`You can manage up to ${MAX_SIGNATURES} signatures.`);
  if (shouldRemoveWhiteBackground) context.putImageData(imageData, 0, 0);
  const savedData = shouldRemoveWhiteBackground ? canvas.toDataURL('image/png') : data;
  const size = currentSignatures.reduce((total, signature) => total + Math.ceil(signature.data.length * 3 / 4), 0) + Math.ceil(savedData.length * 3 / 4);
  if (size > MAX_TOTAL_BYTES) throw new Error('Signature storage limit reached. Remove a signature or upload a smaller PNG.');
  return { id: uid(), name: file.name.replace(/\.png$/i, ''), data: savedData, width: image.width, height: image.height };
}
