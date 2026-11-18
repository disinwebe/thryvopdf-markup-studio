export type PageRangeMode = 'all' | 'current' | 'custom';
export type PageSubset = 'all' | 'odd' | 'even';

export function parsePageRange(value: string, pageCount: number): number[] {
  const pages = new Set<number>();
  const terms = value.split(',').map((term) => term.trim());
  if (!terms.length || terms.some((term) => !term)) throw new Error('Enter pages like 1-3, 5.');

  for (const term of terms) {
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(term);
    if (!match) throw new Error(`Invalid page range: ${term}.`);
    const first = Number(match[1]);
    const last = Number(match[2] ?? match[1]);
    if (first < 1 || last < first || last > pageCount) {
      throw new Error(`Page numbers must be between 1 and ${pageCount}.`);
    }
    for (let page = first; page <= last; page += 1) pages.add(page - 1);
  }
  return [...pages];
}

export function selectPrintPages(options: {
  pageCount: number;
  mode: PageRangeMode;
  currentPage: number;
  range: string;
  subset: PageSubset;
  reverse: boolean;
}): number[] {
  const { pageCount, mode, currentPage, range, subset, reverse } = options;
  if (!Number.isInteger(pageCount) || pageCount < 1) throw new Error('The document has no printable pages.');
  let pages = mode === 'current'
    ? [currentPage]
    : mode === 'custom'
      ? parsePageRange(range, pageCount)
      : Array.from({ length: pageCount }, (_, index) => index);
  if (pages.some((page) => !Number.isInteger(page) || page < 0 || page >= pageCount)) {
    throw new Error(`Page numbers must be between 1 and ${pageCount}.`);
  }
  pages = pages.filter((page) => subset === 'all' || (subset === 'odd' ? page % 2 === 0 : page % 2 === 1));
  if (reverse) pages.reverse();
  if (!pages.length) throw new Error('No pages match the selected print options.');
  return pages;
}
