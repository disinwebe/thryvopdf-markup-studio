import type { Style } from './model';

export const MARKUP_STYLE_DEFAULTS_KEY = 'pms.markupStyleDefaults';
export const MEASUREMENT_STYLE_DEFAULTS_KEY = 'pms.measurementStyleDefaults';
export type MarkupStyleDefaults = Partial<Pick<Style, 'color' | 'width' | 'opacity'>>;
export type MeasurementStyleDefaults = MarkupStyleDefaults & Partial<Pick<Style, 'measurementArrowheads' | 'measurementArrowSize'>>;
type Store = Pick<Storage, 'getItem' | 'setItem'>;
const store = (): Store | null => {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
};

function clean(value: unknown): MarkupStyleDefaults {
  if (!value || typeof value !== 'object') return {};
  const raw = value as Record<string, unknown>;
  const result: MarkupStyleDefaults = {};
  if (typeof raw.color === 'string' && /^#[\da-f]{6}$/i.test(raw.color)) result.color = raw.color;
  if (typeof raw.width === 'number' && Number.isFinite(raw.width)) result.width = Math.min(12, Math.max(1, raw.width));
  if (typeof raw.opacity === 'number' && Number.isFinite(raw.opacity)) result.opacity = Math.min(1, Math.max(0.1, raw.opacity));
  return result;
}

function cleanMeasurement(value: unknown): MeasurementStyleDefaults {
  if (!value || typeof value !== 'object') return {};
  const raw = value as Record<string, unknown>;
  const result: MeasurementStyleDefaults = clean(raw);
  if (raw.measurementArrowheads === 'none' || raw.measurementArrowheads === 'start' ||
      raw.measurementArrowheads === 'end' || raw.measurementArrowheads === 'both') {
    result.measurementArrowheads = raw.measurementArrowheads;
  }
  if (typeof raw.measurementArrowSize === 'number' && Number.isFinite(raw.measurementArrowSize)) {
    result.measurementArrowSize = Math.min(24, Math.max(3, raw.measurementArrowSize));
  }
  return result;
}

export function loadMarkupStyleDefaults(s: Store | null = store()): MarkupStyleDefaults {
  try {
    const saved = s?.getItem(MARKUP_STYLE_DEFAULTS_KEY);
    return saved ? clean(JSON.parse(saved)) : {};
  } catch { return {}; }
}

export function loadMeasurementStyleDefaults(s: Store | null = store()): MeasurementStyleDefaults {
  try {
    const saved = s?.getItem(MEASUREMENT_STYLE_DEFAULTS_KEY);
    return saved ? cleanMeasurement(JSON.parse(saved)) : {};
  } catch { return {}; }
}

export function saveMarkupStyleDefaults(patch: MarkupStyleDefaults, s: Store | null = store()): MarkupStyleDefaults {
  const next = clean({ ...loadMarkupStyleDefaults(s), ...patch });
  try { s?.setItem(MARKUP_STYLE_DEFAULTS_KEY, JSON.stringify(next)); } catch { /* preference remains available for this session */ }
  return next;
}

export function saveMeasurementStyleDefaults(patch: MeasurementStyleDefaults, s: Store | null = store()): MeasurementStyleDefaults {
  const next = cleanMeasurement({ ...loadMeasurementStyleDefaults(s), ...patch });
  try { s?.setItem(MEASUREMENT_STYLE_DEFAULTS_KEY, JSON.stringify(next)); } catch { /* preference remains available for this session */ }
  return next;
}
