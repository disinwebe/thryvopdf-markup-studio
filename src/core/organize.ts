import { PDFDocument, degrees } from 'pdf-lib';

export interface PagePlan {
  /** index into the sources array */
  src: number;
  /** zero-based page index in that source */
  index: number;
  /** additional clockwise rotation in degrees (multiple of 90) */
  rotate?: number;
}

/** Builds a new PDF from an arbitrary page plan: reorder, delete, rotate, merge, extract, insert. */
export async function buildFromPlan(sources: Uint8Array[], plan: PagePlan[]): Promise<Uint8Array> {
  const docs = await Promise.all(sources.map((s) => PDFDocument.load(s, { ignoreEncryption: true })));
  const out = await PDFDocument.create();
  for (const step of plan) {
    const src = docs[step.src];
    if (!src || step.index < 0 || step.index >= src.getPageCount()) throw new Error('Page out of range');
    const [copied] = await out.copyPages(src, [step.index]);
    if (step.rotate) {
      const cur = copied.getRotation().angle;
      copied.setRotation(degrees((((cur + step.rotate) % 360) + 360) % 360));
    }
    out.addPage(copied);
  }
  return out.save();
}

export async function pageCount(bytes: Uint8Array): Promise<number> {
  return (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount();
}

export async function mergePdfs(list: Uint8Array[]): Promise<Uint8Array> {
  const plan: PagePlan[] = [];
  for (let s = 0; s < list.length; s++) {
    const n = await pageCount(list[s]);
    for (let i = 0; i < n; i++) plan.push({ src: s, index: i });
  }
  return buildFromPlan(list, plan);
}

export const extractPages = (bytes: Uint8Array, indices: number[]) =>
  buildFromPlan(
    [bytes],
    indices.map((index) => ({ src: 0, index })),
  );

/** Parses "1-3, 5, 8-" (1-based) into zero-based index groups. Each comma part becomes one group. */
export function parseRanges(spec: string, total: number): number[][] {
  const groups: number[][] = [];
  for (const part of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d*)\s*-\s*(\d*)$/.exec(part);
    let a: number, b: number;
    if (m) {
      a = m[1] ? parseInt(m[1], 10) : 1;
      b = m[2] ? parseInt(m[2], 10) : total;
    } else if (/^\d+$/.test(part)) a = b = parseInt(part, 10);
    else throw new Error(`Invalid range "${part}"`);
    if (a < 1 || b > total || a > b) throw new Error(`Range "${part}" is outside 1-${total}`);
    const g: number[] = [];
    for (let i = a; i <= b; i++) g.push(i - 1);
    groups.push(g);
  }
  if (!groups.length) throw new Error('No pages specified');
  return groups;
}

export function chunkEvery(total: number, n: number): number[][] {
  const groups: number[][] = [];
  for (let i = 0; i < total; i += n) groups.push(Array.from({ length: Math.min(n, total - i) }, (_, k) => i + k));
  return groups;
}

export async function splitPdf(bytes: Uint8Array, groups: number[][]): Promise<Uint8Array[]> {
  return Promise.all(groups.map((g) => extractPages(bytes, g)));
}

/** Applies a move of `from` to position `to` in an order array (non-mutating). */
export function movePage(order: number[], from: number, to: number): number[] {
  const next = order.slice();
  const [x] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, x);
  return next;
}
