import { afterEach, describe, expect, it, vi } from 'vitest';

const page = { getViewport: () => ({ width: 100, height: 200 }), render: vi.fn(() => ({ promise: Promise.resolve() })) };
const pdf = { numPages: 2, getPage: vi.fn(async () => page), destroy: vi.fn(async () => {}) };
vi.mock('../src/pdf/pdfjs', () => ({ loadPdf: vi.fn(async () => pdf) }));
import { importStamp } from '../src/app/stampImport';

const png = 'data:image/png;base64,aGVsbG8=';
const canvas = () => ({
  width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toDataURL: () => png,
});
const file = (name: string) => ({ name, path: '', data: new Uint8Array([1, 2, 3]) });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('stamp import conversion', () => {
  it('converts an image via the browser bitmap decoder to bounded PNG', async () => {
    const close = vi.fn();
    vi.stubGlobal('document', { createElement: () => canvas() });
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1600, height: 800, close })));
    const out = await importStamp(file('test.jpg'), () => 1);
    expect(out).toEqual({ data: png, width: 800, height: 400 });
    expect(close).toHaveBeenCalled();
  });
  it('renders the selected PDF page and closes the source', async () => {
    vi.stubGlobal('document', { createElement: () => canvas() });
    const out = await importStamp(file('plans.pdf'), () => 2);
    expect(pdf.getPage).toHaveBeenCalledWith(2);
    expect(page.render).toHaveBeenCalled();
    expect(pdf.destroy).toHaveBeenCalled();
    expect(out).toEqual({ data: png, width: 100, height: 200 });
  });
  it('rejects invalid page choices and closes the PDF', async () => {
    vi.stubGlobal('document', { createElement: () => canvas() });
    await expect(importStamp(file('plans.pdf'), () => 3)).rejects.toThrow('Choose a page');
    expect(pdf.destroy).toHaveBeenCalled();
  });
});
