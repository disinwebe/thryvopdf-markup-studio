import { describe, expect, it } from 'vitest';
import { exactWordRanges, nextSearchHitIndex, scanPdfSpelling, searchTextMatches, type PDFDocumentProxy } from '../src/pdf/pdfjs';

describe('PDF exact-word search', () => {
  it('matches complete words case-insensitively and skips substrings', () => {
    expect(exactWordRanges('Cat scatter cat, catalog', 'CAT')).toEqual([
      { start: 0, end: 3 },
      { start: 12, end: 15 },
    ]);
  });

  it('finds every matching word across pages and returns highlight geometry', async () => {
    const makePage = (str: string) => ({
      getTextContent: async () => ({
        items: [{ str, dir: 'ltr', transform: [1, 0, 0, 10, 10, 50], width: 120, height: 10, fontName: 'font', hasEOL: false }],
        styles: { font: { fontFamily: 'sans-serif', ascent: 0.8 } },
      }),
      getViewport: () => ({ transform: [1, 0, 0, -1, 0, 100] }),
    });
    const pdf = {
      numPages: 2,
      getPage: async (page: number) => makePage(page === 1 ? 'Door doorway' : 'door and DOOR'),
    } as unknown as PDFDocumentProxy;

    const matches = await searchTextMatches(pdf, 'door');
    expect(matches.map((match) => match.page)).toEqual([0, 1, 1]);
    expect(matches[0].points).toHaveLength(4);
    expect(matches[0].points[1].x).toBeGreaterThan(matches[0].points[0].x);
  });

  it('advances through search results and wraps in either direction', () => {
    expect(nextSearchHitIndex(0, 3)).toBe(1);
    expect(nextSearchHitIndex(2, 3)).toBe(0);
    expect(nextSearchHitIndex(0, 3, -1)).toBe(2);
    expect(nextSearchHitIndex(0, 0)).toBe(-1);
  });
});

describe('PDF text spell check', () => {
  it('checks whole words split across adjacent PDF text items', async () => {
    const makeItem = (str: string, x: number, width: number) => ({
      str,
      dir: 'ltr',
      transform: [1, 0, 0, 10, x, 50],
      width,
      height: 10,
      fontName: 'font',
      hasEOL: false,
    });
    const pdf = {
      numPages: 1,
      getPage: async () => ({
        getTextContent: async () => ({
          items: [
            makeItem('Measurem', 10, 45),
            makeItem('ents', 55, 24),
            makeItem('Mispel', 84, 35),
            makeItem('ing', 119, 18),
          ],
          styles: { font: { fontFamily: 'sans-serif', ascent: 0.8 } },
        }),
        getViewport: () => ({ transform: [1, 0, 0, -1, 0, 100] }),
      }),
    } as unknown as PDFDocumentProxy;
    const checkedWords: string[] = [];
    const result = await scanPdfSpelling(pdf, async (words) => {
      checkedWords.push(...words);
      return words
        .filter((word) => word.toLowerCase() === 'mispeling')
        .map((word) => ({ word, suggestions: ['misspelling'] }));
    });

    expect(checkedWords).toEqual(['Measurements', 'Mispeling']);
    expect(result.wordsChecked).toBe(2);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].word).toBe('Mispeling');
    expect(result.issues[0].matches).toHaveLength(1);
    expect(result.issues[0].matches[0].points[1].x).toBeGreaterThan(result.issues[0].matches[0].points[0].x);
  });

  it('groups repeated misspellings across pages and reports highlight geometry and progress', async () => {
    const textByPage = ['Mispeling door Mispeling', 'mispeling text', ''];
    const pdf = {
      numPages: textByPage.length,
      getPage: async (page: number) => ({
        getTextContent: async () => ({
          items: textByPage[page - 1]
            ? [{ str: textByPage[page - 1], transform: [1, 0, 0, 10, 10, 50], width: 120, height: 10, fontName: 'font' }]
            : [],
          styles: { font: { fontFamily: 'sans-serif', ascent: 0.8 } },
        }),
        getViewport: () => ({ transform: [1, 0, 0, -1, 0, 100] }),
      }),
    } as unknown as PDFDocumentProxy;
    const progress: number[] = [];
    const result = await scanPdfSpelling(
      pdf,
      async (words) => words
        .filter((word) => word.toLowerCase() === 'mispeling')
        .map((word) => ({ word, suggestions: ['misspelling'] })),
      (completed) => progress.push(completed),
    );

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ word: 'Mispeling', suggestions: ['misspelling'], pages: [1, 2], occurrences: 3 });
    expect(result.issues[0].matches.map((match) => match.page)).toEqual([0, 0, 1]);
    expect(result.issues[0].matches[0].points).toHaveLength(4);
    expect(result.issues[0].matches[0].points[1].x).toBeGreaterThan(result.issues[0].matches[0].points[0].x);
    expect(result.pagesWithText).toBe(2);
    expect(result.wordsChecked).toBe(5);
    expect(progress).toEqual([1, 2, 3]);
  });
});
