import { describe, expect, it } from 'vitest';
import { removeWhiteBackground } from '../src/app/signatures';

describe('signature white-background removal', () => {
  it('clears white and near-white pixels and preserves ink with anti-aliased edges', () => {
    const pixels = new Uint8ClampedArray([
      255, 255, 255, 255,
      250, 250, 250, 255,
      128, 128, 128, 255,
      0, 0, 0, 255,
    ]);

    removeWhiteBackground(pixels);

    expect(Array.from(pixels)).toEqual([
      255, 255, 255, 0,
      250, 250, 250, 0,
      0, 0, 0, 127,
      0, 0, 0, 255,
    ]);
  });

  it('leaves already-transparent pixels unchanged', () => {
    const pixels = new Uint8ClampedArray([255, 255, 255, 0]);

    removeWhiteBackground(pixels);

    expect(Array.from(pixels)).toEqual([255, 255, 255, 0]);
  });
});
