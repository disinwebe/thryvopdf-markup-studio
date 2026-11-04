import { describe, expect, it } from 'vitest';
import { Raster, autoAlign, compareRasters } from '../src/core/compare';

function blank(w: number, h: number): Raster {
  return { data: new Uint8ClampedArray(w * h * 4).fill(255), width: w, height: h };
}
function rect(r: Raster, x0: number, y0: number, x1: number, y1: number) {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const o = (y * r.width + x) * 4;
      r.data[o] = r.data[o + 1] = r.data[o + 2] = 0;
    }
}

describe('compare', () => {
  it('reports no changes for identical sheets', () => {
    const a = blank(60, 60),
      b = blank(60, 60);
    rect(a, 10, 10, 40, 12);
    rect(b, 10, 10, 40, 12);
    const { stats } = compareRasters(a, b);
    expect(stats.added).toBe(0);
    expect(stats.removed).toBe(0);
    expect(stats.unchanged).toBeGreaterThan(0);
  });

  it('colour-codes additions and removals', () => {
    const a = blank(80, 80),
      b = blank(80, 80);
    rect(a, 5, 5, 25, 8); // only in A -> removed
    rect(b, 50, 50, 70, 53); // only in B -> added
    rect(a, 10, 40, 40, 42);
    rect(b, 10, 40, 40, 42);
    const { overlay, stats } = compareRasters(a, b);
    expect(stats.removed).toBe(60);
    expect(stats.added).toBe(60);
    const px = (x: number, y: number) => Array.from(overlay.data.slice((y * 80 + x) * 4, (y * 80 + x) * 4 + 3));
    expect(px(10, 6)).toEqual([226, 38, 38]);
    expect(px(60, 51)).toEqual([24, 110, 235]);
    expect(px(20, 41)).toEqual([150, 150, 150]);
    expect(px(0, 0)).toEqual([255, 255, 255]);
    expect(stats.changeRatio).toBeGreaterThan(0);
  });

  it('tolerates tiny misalignment', () => {
    const a = blank(60, 60),
      b = blank(60, 60);
    rect(a, 10, 20, 50, 22);
    rect(b, 10, 21, 50, 23);
    expect(compareRasters(a, b, { tolerance: 2 }).stats.added).toBe(0);
    expect(compareRasters(a, b, { tolerance: 0 }).stats.added).toBeGreaterThan(0);
  });

  it('auto-aligns a shifted sheet', () => {
    const a = blank(120, 120),
      b = blank(120, 120);
    rect(a, 20, 30, 80, 34);
    rect(a, 20, 30, 24, 90);
    rect(b, 27, 22, 87, 26);
    rect(b, 27, 22, 31, 82);
    const { dx, dy } = autoAlign(a, b, 20);
    expect({ dx, dy }).toEqual({ dx: -7, dy: 8 });
    const { stats } = compareRasters(a, b, { dx, dy, tolerance: 0 });
    expect(stats.added + stats.removed).toBe(0);
  });

  it('requires equal dimensions', () => {
    expect(() => compareRasters(blank(10, 10), blank(11, 10))).toThrow();
  });
});
