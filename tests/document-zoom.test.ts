import { describe, expect, it } from 'vitest';
import {
  documentZoomKey,
  initialDocumentCalibrations,
  initialDocumentZoom,
  loadDocumentCalibrations,
  loadDocumentZoom,
  saveDocumentCalibrations,
  saveDocumentZoom,
} from '../src/app/model';

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

  it('starts externally opened PDFs at fit-page even when a zoom was remembered', () => {
    const storage = memoryStorage();
    const key = documentZoomKey({ name: 'Plan.pdf', path: 'C:\\drawings\\Plan.pdf' });
    saveDocumentZoom(key, 0.38, storage);
    expect(initialDocumentZoom(key, true)).toBe(0);
    expect(initialDocumentZoom(key, false, storage)).toBe(0.38);
  });
});

describe('document calibration preferences', () => {
  it('persists calibration per document identity outside the PDF', () => {
    const storage = memoryStorage();
    const key = documentZoomKey({ name: 'Plan.pdf', path: 'C:\\drawings\\Plan.pdf' });
    const calibration = { unit: 'ft' as const, unitsPerPoint: 0.25, calibrated: true };

    expect(saveDocumentCalibrations(key, { 0: calibration }, storage)).toBe(true);
    expect(loadDocumentCalibrations(key, storage)).toEqual({ 0: calibration });
    expect(loadDocumentCalibrations(documentZoomKey({ name: 'Plan.pdf', path: 'C:\\other\\Plan.pdf' }), storage)).toEqual({});
    expect(initialDocumentCalibrations(key, { 0: { unit: 'mm', unitsPerPoint: 2, calibrated: true } }, storage))
      .toEqual({ 0: calibration });
  });

  it('moves legacy embedded calibration into per-document settings on first open', () => {
    const storage = memoryStorage();
    const key = documentZoomKey({ name: 'Plan.pdf', path: 'C:\\drawings\\Plan.pdf' });
    const legacy = { 0: { unit: 'mm' as const, unitsPerPoint: 2, calibrated: true } };

    expect(initialDocumentCalibrations(key, legacy, storage)).toEqual(legacy);
    expect(loadDocumentCalibrations(key, storage)).toEqual(legacy);
  });

  it('ignores malformed stored calibrations', () => {
    const storage = memoryStorage();
    const key = documentZoomKey({ name: 'Plan.pdf', path: 'C:\\drawings\\Plan.pdf' });
    storage.setItem(`thryvopdf-document-calibration-v1:${key}`, JSON.stringify({
      0: { unit: 'ft', unitsPerPoint: -1, calibrated: true },
      1: { unit: 'mm', unitsPerPoint: 2, calibrated: true },
    }));

    expect(loadDocumentCalibrations(key, storage)).toEqual({
      1: { unit: 'mm', unitsPerPoint: 2, calibrated: true },
    });
  });
});
