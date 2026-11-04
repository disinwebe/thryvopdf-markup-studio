export interface Raster {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export interface CompareOptions {
  /** luminance below this counts as ink */
  threshold?: number;
  /** pixel radius within which a stroke in the other sheet counts as unchanged */
  tolerance?: number;
  /** offset applied to sheet B (pixels) */
  dx?: number;
  dy?: number;
}

export interface CompareStats {
  added: number;
  removed: number;
  unchanged: number;
  /** changed ink / total ink, 0..1 */
  changeRatio: number;
}

export const COLOR_REMOVED: [number, number, number] = [226, 38, 38];
export const COLOR_ADDED: [number, number, number] = [24, 110, 235];
export const COLOR_SAME: [number, number, number] = [150, 150, 150];

export function inkMask(r: Raster, threshold = 200): Uint8Array {
  const m = new Uint8Array(r.width * r.height);
  const d = r.data;
  for (let i = 0; i < m.length; i++) {
    const o = i * 4;
    const a = d[o + 3] / 255;
    // composite on white
    const lum = (0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]) * a + 255 * (1 - a);
    m[i] = lum < threshold ? 1 : 0;
  }
  return m;
}

export function dilate(mask: Uint8Array, w: number, h: number, rad: number): Uint8Array {
  if (rad <= 0) return mask;
  const tmp = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (!mask[row + x]) continue;
      const x0 = Math.max(0, x - rad),
        x1 = Math.min(w - 1, x + rad);
      for (let k = x0; k <= x1; k++) tmp[row + k] = 1;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      if (!tmp[y * w + x]) continue;
      const y0 = Math.max(0, y - rad),
        y1 = Math.min(h - 1, y + rad);
      for (let k = y0; k <= y1; k++) out[k * w + x] = 1;
    }
  }
  return out;
}

function shifted(mask: Uint8Array, w: number, h: number, dx: number, dy: number): Uint8Array {
  if (!dx && !dy) return mask;
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    const sy = y - dy;
    if (sy < 0 || sy >= h) continue;
    for (let x = 0; x < w; x++) {
      const sx = x - dx;
      if (sx >= 0 && sx < w) out[y * w + x] = mask[sy * w + sx];
    }
  }
  return out;
}

/** Finds the (dx, dy) shift of B that best overlays it onto A. Both rasters must share dimensions. */
export function autoAlign(a: Raster, b: Raster, maxShift = 40, threshold = 200): { dx: number; dy: number } {
  const w = Math.min(a.width, b.width),
    h = Math.min(a.height, b.height);
  const ma = inkMask(a, threshold),
    mb = inkMask(b, threshold);
  const pts: number[] = [];
  const stride = Math.max(1, Math.floor(ma.reduce((s, v) => s + v, 0) / 20000));
  let n = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (ma[y * a.width + x] && n++ % stride === 0) pts.push(x, y);
  if (!pts.length) return { dx: 0, dy: 0 };

  const score = (dx: number, dy: number) => {
    let s = 0;
    for (let i = 0; i < pts.length; i += 2) {
      const sx = pts[i] - dx,
        sy = pts[i + 1] - dy;
      if (sx >= 0 && sx < w && sy >= 0 && sy < h && mb[sy * b.width + sx]) s++;
    }
    return s;
  };
  let best = { dx: 0, dy: 0, s: score(0, 0) };
  const search = (cx: number, cy: number, range: number, step: number) => {
    for (let dy = cy - range; dy <= cy + range; dy += step)
      for (let dx = cx - range; dx <= cx + range; dx += step) {
        const s = score(dx, dy);
        if (s > best.s) best = { dx, dy, s };
      }
  };
  search(0, 0, maxShift, 4);
  search(best.dx, best.dy, 3, 1);
  return { dx: best.dx, dy: best.dy };
}

export function compareRasters(
  a: Raster,
  b: Raster,
  opts: CompareOptions = {},
): { overlay: Raster; stats: CompareStats } {
  const { threshold = 200, tolerance = 1, dx = 0, dy = 0 } = opts;
  const w = a.width,
    h = a.height;
  if (b.width !== w || b.height !== h) throw new Error('Rasters must have identical dimensions');
  const ma = inkMask(a, threshold);
  const mb = shifted(inkMask(b, threshold), w, h, dx, dy);
  const da = dilate(ma, w, h, tolerance);
  const db = dilate(mb, w, h, tolerance);
  const out = new Uint8ClampedArray(w * h * 4);
  let added = 0,
    removed = 0,
    unchanged = 0;
  for (let i = 0; i < ma.length; i++) {
    const o = i * 4;
    let col: [number, number, number] | null = null;
    if (ma[i] && !db[i]) {
      col = COLOR_REMOVED;
      removed++;
    } else if (mb[i] && !da[i]) {
      col = COLOR_ADDED;
      added++;
    } else if (ma[i] || mb[i]) {
      col = COLOR_SAME;
      unchanged++;
    }
    if (col) {
      out[o] = col[0];
      out[o + 1] = col[1];
      out[o + 2] = col[2];
    } else {
      out[o] = out[o + 1] = out[o + 2] = 255;
    }
    out[o + 3] = 255;
  }
  const total = added + removed + unchanged;
  return {
    overlay: { data: out, width: w, height: h },
    stats: { added, removed, unchanged, changeRatio: total ? (added + removed) / total : 0 },
  };
}
