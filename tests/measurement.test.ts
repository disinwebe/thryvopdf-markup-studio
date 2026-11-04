import { describe, expect, it } from 'vitest';
import {
  angleDeg,
  calibrateFromDistance,
  calibrateFromScale,
  convertArea,
  convertLength,
  csvEscape,
  formatFeetInches,
  measure,
  pathLength,
  polygonArea,
  takeoffCsv,
  takeoffSummary,
} from '../src/core/measurement';
import { Markup } from '../src/core/types';

const mk = (type: Markup['type'], points: [number, number][], extra: Partial<Markup> = {}): Markup => ({
  id: Math.random().toString(),
  page: 0,
  type,
  points: points.map(([x, y]) => ({ x, y })),
  color: '#ff0000',
  width: 2,
  opacity: 1,
  status: 'None',
  author: 'T',
  date: '2024-01-01T00:00:00Z',
  comments: [],
  ...extra,
});

describe('measurement math', () => {
  it('computes path length and closed perimeter', () => {
    const sq = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(pathLength(sq)).toBeCloseTo(30);
    expect(pathLength(sq, true)).toBeCloseTo(40);
  });

  it('computes polygon area with shoelace regardless of winding', () => {
    const tri = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 0, y: 3 },
    ];
    expect(polygonArea(tri)).toBeCloseTo(6);
    expect(polygonArea([...tri].reverse())).toBeCloseTo(6);
  });

  it('computes angles', () => {
    expect(angleDeg({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(90);
    expect(angleDeg({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: -1, y: 0 })).toBeCloseTo(180);
    expect(angleDeg({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeCloseTo(45);
  });

  it('converts units', () => {
    expect(convertLength(1, 'ft', 'in')).toBeCloseTo(12);
    expect(convertLength(1000, 'mm', 'm')).toBeCloseTo(1);
    expect(convertArea(1, 'm', 'mm')).toBeCloseTo(1e6);
  });

  it('calibrates from a known distance', () => {
    const cal = calibrateFromDistance({ x: 0, y: 0 }, { x: 100, y: 0 }, 20, 'ft');
    expect(cal.unitsPerPoint).toBeCloseTo(0.2);
    const len = measure(mk('m-length', [[0, 0], [50, 0]]), cal)!;
    expect(len.value).toBeCloseTo(10);
    expect(len.unit).toBe('ft');
    const area = measure(mk('m-area', [[0, 0], [100, 0], [100, 100], [0, 100]]), cal)!;
    expect(area.value).toBeCloseTo(400);
    expect(area.unit).toBe('ft²');
    expect(area.perimeter).toBeCloseTo(80);
  });

  it('calibrates from a drawing scale', () => {
    // 1 paper inch = 10 ft; 72 pt = 1 in
    const cal = calibrateFromScale(1, 10, 'ft');
    expect(72 * cal.unitsPerPoint).toBeCloseTo(10);
  });

  it('rejects invalid calibration', () => {
    expect(() => calibrateFromDistance({ x: 0, y: 0 }, { x: 0, y: 0 }, 5, 'm')).toThrow();
  });

  it('formats feet-inches', () => {
    expect(formatFeetInches(10.5)).toBe(`10' 6"`);
  });
});

describe('takeoff', () => {
  const cal = calibrateFromDistance({ x: 0, y: 0 }, { x: 100, y: 0 }, 100, 'ft'); // 1 pt = 1 ft
  const items = [
    mk('m-length', [[0, 0], [10, 0]], { subject: 'Wall' }),
    mk('m-length', [[0, 0], [0, 5]], { subject: 'Wall' }),
    mk('m-area', [[0, 0], [10, 0], [10, 10], [0, 10]], { subject: 'Slab' }),
    mk('m-count', [[1, 1]], { subject: 'Door' }),
    mk('m-count', [[2, 2]], { subject: 'Door' }),
    mk('rect', [[0, 0], [5, 5]]),
  ];

  it('groups by subject and sums', () => {
    const rows = takeoffSummary(items, () => cal, 'ft');
    const wall = rows.find((r) => r.subject === 'Wall')!;
    expect(wall.count).toBe(2);
    expect(wall.total).toBeCloseTo(15);
    expect(rows.find((r) => r.subject === 'Slab')!.total).toBeCloseTo(100);
    expect(rows.find((r) => r.subject === 'Door')!.count).toBe(2);
    expect(rows.some((r) => r.subject === 'rect')).toBe(false);
  });

  it('converts to the output unit', () => {
    const rows = takeoffSummary(items, () => cal, 'in');
    expect(rows.find((r) => r.subject === 'Wall')!.total).toBeCloseTo(180);
  });

  it('exports CSV with escaping', () => {
    expect(csvEscape('a,"b"')).toBe('"a,""b"""');
    const csv = takeoffCsv(items, () => cal);
    expect(csv).toContain('Subject,Type,Items,Total,Unit');
    expect(csv).toContain('Wall,length,2,15,ft');
  });
});
