import { describe, expect, it } from 'vitest';
import { documentZoomKey, loadDocumentZoom, saveDocumentZoom } from '../src/app/model';

function memoryStorage() {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
  };
}

describe('document zoom preferences', () => {
  it('persists and restores zoom by stable document identity', () => {
    const storage = memoryStorage();
    const key = documentZoomKey({ name: 'Plan.pdf', path: 'C:\\drawings\\Plan.pdf' });
    saveDocumentZoom(key, 0.38, storage);
    expect(loadDocumentZoom(key, storage)).toBe(0.38);
    expect(documentZoomKey({ name: 'Plan.pdf', path: 'C:\\other\\Plan.pdf' })).not.toBe(key);
    expect(documentZoomKey({ name: 'Plan.pdf', shared: { id: 'server-doc-1' } })).toBe('shared:server-doc-1');
  });

  it('uses fit-page for missing, invalid, or out-of-range stored zoom', () => {
    const storage = memoryStorage();
    const key = documentZoomKey({ name: 'Plan.pdf' });
    expect(loadDocumentZoom(key, storage)).toBe(0);
    saveDocumentZoom(key, 0, storage);
    expect(loadDocumentZoom(key, storage)).toBe(0);
    saveDocumentZoom(key, 0.38, storage);
    saveDocumentZoom(key, 9, storage);
    expect(loadDocumentZoom(key, storage)).toBe(0.38);
    storage.setItem(`thryvopdf-document-zoom-v1:${key}`, 'not-a-number');
    expect(loadDocumentZoom(key, storage)).toBe(0);
  });
});
