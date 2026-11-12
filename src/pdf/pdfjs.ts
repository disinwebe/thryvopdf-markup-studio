import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Raster } from '../core/compare';
import { pdfBytesForDisplay } from '../core/annotations';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy, PDFPageProxy };

export async function loadPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  let displayBytes = bytes;
  try {
    displayBytes = await pdfBytesForDisplay(bytes);
  } catch (error) {
    console.warn('Could not prepare PDF annotation display; using the original PDF.', error);
  }
  return pdfjs.getDocument({ data: displayBytes.slice() }).promise;
}

/** Loads saved markup appearances without stripping app annotations, for raster-only views such as Compare. */
export async function loadPdfForCompare(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  return pdfjs.getDocument({ data: bytes.slice() }).promise;
}

export interface PdfComment {
  id: string;
  subtype: string;
  author: string;
  text: string;
}

/** Returns standard PDF comments, excluding duplicate popup entries. */
export async function pagePdfComments(pdf: PDFDocumentProxy, index: number): Promise<PdfComment[]> {
  const page = await pdf.getPage(index + 1);
  const annotations = await page.getAnnotations({ intent: 'display' });
  const popupIds = new Set(annotations.map((a) => a.popupRef).filter(Boolean));
  return annotations
    .filter((a) => !(a.annotationFlags & 34) && !(a.subtype === 'Popup' && popupIds.has(a.id)))
    .map((a) => ({
      id: a.id,
      subtype: a.subtype || 'Annotation',
      author: a.titleObj?.str || '',
      text: a.contentsObj?.str || '',
    }))
    .filter((a) => a.text.trim().length > 0);
}

export async function pageSize(pdf: PDFDocumentProxy, index: number) {
  const page = await pdf.getPage(index + 1);
  const v = page.getViewport({ scale: 1 });
  return { w: v.width, h: v.height };
}

export async function renderToCanvas(
  pdf: PDFDocumentProxy,
  index: number,
  scale: number,
  canvas: HTMLCanvasElement,
): Promise<RenderTask> {
  const page = await pdf.getPage(index + 1);
  const viewport = page.getViewport({ scale });
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return page.render({
    canvasContext: ctx,
    viewport,
    annotationMode: pdfjs.AnnotationMode.ENABLE,
  });
}

/** Renders a page scaled to fit inside w x h (letterboxed on white) and returns raw pixels. */
export async function renderRaster(
  pdf: PDFDocumentProxy,
  index: number,
  w: number,
  h: number,
): Promise<{ raster: Raster; canvas: HTMLCanvasElement }> {
  const page = await pdf.getPage(index + 1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(w / base.width, h / base.height);
  const viewport = page.getViewport({ scale, offsetX: (w - base.width * scale) / 2, offsetY: (h - base.height * scale) / 2 });
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  await page.render({ canvasContext: ctx, viewport, annotationMode: pdfjs.AnnotationMode.ENABLE }).promise;
  const img = ctx.getImageData(0, 0, w, h);
  return { raster: { data: img.data, width: w, height: h }, canvas };
}

export async function pageText(pdf: PDFDocumentProxy, index: number): Promise<string> {
  const page = await pdf.getPage(index + 1);
  const tc = await page.getTextContent();
  return tc.items.map((i) => ('str' in i ? i.str : '')).join(' ');
}

export interface SearchHit {
  page: number;
  snippet: string;
}

export function nextSearchHitIndex(current: number, total: number, direction: -1 | 1 = 1): number {
  if (total <= 0) return -1;
  return ((current + direction) % total + total) % total;
}

export interface PdfTextMatch {
  page: number;
  points: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
}

export interface PdfSpellingMatch extends PdfTextMatch {
  word: string;
}

export interface PdfSpellingIssue {
  word: string;
  suggestions: string[];
  pages: number[];
  occurrences: number;
  matches: PdfSpellingMatch[];
}

export interface PdfSpellingScanResult {
  issues: PdfSpellingIssue[];
  pagesWithText: number;
  wordsChecked: number;
}

type SpellTextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
  dir?: string;
  hasEOL?: boolean;
};
type SpellTextStyle = { ascent?: number; descent?: number; fontFamily?: string };
type SpellTextPiece = { item: SpellTextItem; start: number; end: number };
type SpellToken = { word: string; pieces: SpellTextPiece[] };

function textRangePoints(
  item: SpellTextItem,
  viewportTransform: number[],
  style: SpellTextStyle,
  range: { start: number; end: number },
  measure: CanvasRenderingContext2D | null,
): PdfTextMatch['points'] {
  const transform = pdfjs.Util.transform(viewportTransform, item.transform);
  const [a, b, c, d, e, f] = transform;
  const angle = Math.atan2(b, a);
  const height = Math.hypot(c, d);
  const ascent = height * (style.ascent ?? (style.descent ? 1 + style.descent : 0.8));
  const left = e + ascent * Math.sin(angle);
  const top = f - ascent * Math.cos(angle);
  let totalWidth = 0;
  if (measure && height > 0) {
    measure.font = `${height}px ${style.fontFamily ?? 'sans-serif'}`;
    totalWidth = measure.measureText(item.str).width;
  }
  const widthScale = totalWidth > 0 ? Math.abs(item.width) / totalWidth : Math.abs(item.width) / item.str.length;
  const before = item.str.slice(0, range.start);
  const text = item.str.slice(range.start, range.end);
  const offset = (measure && totalWidth > 0 ? measure.measureText(before).width : before.length) * widthScale;
  const width = (measure && totalWidth > 0 ? measure.measureText(text).width : text.length) * widthScale;
  const startX = left + Math.cos(angle) * offset;
  const startY = top + Math.sin(angle) * offset;
  const endX = startX + Math.cos(angle) * width;
  const endY = startY + Math.sin(angle) * width;
  const downX = -Math.sin(angle) * height;
  const downY = Math.cos(angle) * height;
  return [
    { x: startX, y: startY },
    { x: endX, y: endY },
    { x: endX + downX, y: endY + downY },
    { x: startX + downX, y: startY + downY },
  ];
}

function canJoinSpellTextItems(previous: SpellTextItem, next: SpellTextItem): boolean {
  if (
    previous.hasEOL ||
    (previous.dir && next.dir && previous.dir !== next.dir) ||
    previous.dir === 'rtl' ||
    next.dir === 'rtl' ||
    previous.dir === 'ttb' ||
    next.dir === 'ttb' ||
    /\s$/u.test(previous.str) ||
    /^\s/u.test(next.str)
  ) return false;

  const previousCharacter = Array.from(previous.str).at(-1) ?? '';
  const nextCharacter = Array.from(next.str)[0] ?? '';
  const isLetter = (character: string) => /[\p{L}\p{M}]/u.test(character);
  const isApostrophe = (character: string) => character === "'" || character === '’';
  if (
    !(isLetter(previousCharacter) || isApostrophe(previousCharacter)) ||
    !(isLetter(nextCharacter) || isApostrophe(nextCharacter)) ||
    (isApostrophe(previousCharacter) && isApostrophe(nextCharacter))
  ) return false;

  const [a, b, c, d, x, y] = previous.transform;
  const [nextX, nextY] = [next.transform[4], next.transform[5]];
  const baselineLength = Math.hypot(a, b);
  if (!baselineLength || !Number.isFinite(previous.width) || !Number.isFinite(nextX) || !Number.isFinite(nextY)) return false;

  const ux = a / baselineLength;
  const uy = b / baselineLength;
  const dx = nextX - (x + ux * Math.abs(previous.width));
  const dy = nextY - (y + uy * Math.abs(previous.width));
  const gap = dx * ux + dy * uy;
  const lineOffset = Math.abs(dx * -uy + dy * ux);
  const lineHeight = Math.max(
    Math.abs(previous.height),
    Math.abs(next.height),
    Math.hypot(c, d),
    Math.hypot(next.transform[2], next.transform[3]),
  );
  const maxGap = Math.max(0.5, lineHeight * 0.18);
  return gap >= -lineHeight * 0.1 && gap <= maxGap && lineOffset <= lineHeight * 0.25;
}

function spellTokens(items: SpellTextItem[]): SpellToken[] {
  let text = '';
  const segments: Array<{ start: number; end: number; item: SpellTextItem }> = [];
  let previous: SpellTextItem | undefined;

  for (const item of items) {
    if (!item.str) continue;
    if (previous && !canJoinSpellTextItems(previous, item)) text += ' ';
    const start = text.length;
    text += item.str;
    segments.push({ start, end: text.length, item });
    previous = item;
  }

  const tokens: SpellToken[] = [];
  let segmentIndex = 0;
  for (const match of text.matchAll(/[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    while (segmentIndex < segments.length && segments[segmentIndex].end <= start) segmentIndex++;
    const pieces: SpellTextPiece[] = [];
    for (let index = segmentIndex; index < segments.length && segments[index].start < end; index++) {
      const segment = segments[index];
      const pieceStart = Math.max(start, segment.start);
      const pieceEnd = Math.min(end, segment.end);
      if (pieceStart < pieceEnd) {
        pieces.push({ item: segment.item, start: pieceStart - segment.start, end: pieceEnd - segment.start });
      }
    }
    tokens.push({ word: match[0], pieces });
  }
  return tokens;
}

function spellTokenPoints(
  pieces: SpellTextPiece[],
  viewportTransform: number[],
  styles: Record<string, SpellTextStyle>,
  measure: CanvasRenderingContext2D | null,
): PdfTextMatch['points'] {
  const boxes = pieces.map(({ item, start, end }) =>
    textRangePoints(item, viewportTransform, styles[item.fontName], { start, end }, measure),
  );
  if (boxes.length === 1) return boxes[0];
  const first = boxes[0];
  const last = boxes[boxes.length - 1];
  return [first[0], last[1], last[2], first[3]];
}

export async function scanPdfSpelling(
  pdf: PDFDocumentProxy,
  checkWords: (words: string[]) => Promise<Array<{ word: string; suggestions: string[] }>>,
  onProgress?: (completedPages: number, totalPages: number) => void,
): Promise<PdfSpellingScanResult> {
  const grouped = new Map<string, { word: string; suggestions: string[]; pages: Set<number>; occurrences: number; matches: PdfSpellingMatch[] }>();
  const measure = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  let pagesWithText = 0;
  let wordsChecked = 0;
  for (let index = 0; index < pdf.numPages; index++) {
    const page = await pdf.getPage(index + 1);
    const [content, viewport] = await Promise.all([
      page.getTextContent(),
      Promise.resolve(page.getViewport({ scale: 1 })),
    ]);
    const textItems = content.items.flatMap((item) =>
      'str' in item && item.str ? [item as SpellTextItem] : [],
    );
    const tokens = spellTokens(textItems);
    const words = tokens.map((token) => token.word);
    if (words.length) pagesWithText++;
    wordsChecked += words.length;
    const uniqueWords = [...new Set(words)];
    const misspelled = new Map<string, { word: string; suggestions: string[] }>();
    for (let start = 0; start < uniqueWords.length; start += 500) {
      const checked = await checkWords(uniqueWords.slice(start, start + 500));
      for (const issue of checked) misspelled.set(issue.word.toLocaleLowerCase('en'), issue);
    }
    for (const token of tokens) {
      const key = token.word.toLocaleLowerCase('en');
      const issue = misspelled.get(key);
      if (!issue) continue;
      const existing = grouped.get(key) ?? { ...issue, pages: new Set<number>(), occurrences: 0, matches: [] };
      existing.pages.add(index + 1);
      existing.occurrences++;
      existing.matches.push({
        word: token.word,
        page: index,
        points: spellTokenPoints(token.pieces, viewport.transform, content.styles, measure),
      });
      grouped.set(key, existing);
    }
    onProgress?.(index + 1, pdf.numPages);
  }
  return {
    issues: [...grouped.values()]
      .map(({ pages, ...issue }) => ({ ...issue, pages: [...pages] }))
      .sort((a, b) => a.pages[0] - b.pages[0] || a.word.localeCompare(b.word)),
    pagesWithText,
    wordsChecked,
  };
}

export function exactWordRanges(text: string, query: string): Array<{ start: number; end: number }> {
  const q = query.trim();
  if (!q) return [];
  const escape = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const expression = new RegExp(escape, 'giu');
  const word = (value: string) => /[\p{L}\p{N}_]/u.test(value);
  const ranges: Array<{ start: number; end: number }> = [];
  for (const match of text.matchAll(expression)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const first = Array.from(q)[0];
    const last = Array.from(q).at(-1) ?? '';
    if ((word(first) && word(text.slice(0, start).slice(-1))) ||
        (word(last) && word(text.slice(end, end + 1)))) continue;
    ranges.push({ start, end });
  }
  return ranges;
}

export async function searchTextMatches(pdf: PDFDocumentProxy, query: string): Promise<PdfTextMatch[]> {
  const q = query.trim();
  if (!q) return [];
  const matches: PdfTextMatch[] = [];
  const measure = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  for (let index = 0; index < pdf.numPages; index++) {
    const page = await pdf.getPage(index + 1);
    const [content, viewport] = await Promise.all([
      page.getTextContent(),
      Promise.resolve(page.getViewport({ scale: 1 })),
    ]);
    for (const item of content.items) {
      if (!('str' in item) || !item.str) continue;
      const ranges = exactWordRanges(item.str, q);
      if (ranges.length === 0) continue;
      const style = content.styles[item.fontName];
      for (const range of ranges) {
        matches.push({
          page: index,
          points: textRangePoints(item, viewport.transform, style, range, measure),
        });
      }
    }
  }
  return matches;
}

export async function searchDoc(
  pdf: PDFDocumentProxy,
  query: string,
  cache?: Map<number, string>,
): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (let i = 0; i < pdf.numPages; i++) {
    let t = cache?.get(i);
    if (t === undefined) {
      t = await pageText(pdf, i);
      cache?.set(i, t);
    }
    const at = t.toLowerCase().indexOf(q);
    if (at >= 0) hits.push({ page: i, snippet: t.slice(Math.max(0, at - 30), at + q.length + 40).trim() });
  }
  return hits;
}
