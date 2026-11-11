import type { Markup, Pt } from './types';

export interface SnapSegment {
  a: Pt;
  b: Pt;
}

export interface SnapGeometry {
  segments: SnapSegment[];
  endpoints: Pt[];
  centers?: Pt[];
}

export interface SnapIndex extends SnapGeometry {
  endpointCells: Map<string, number[]>;
  segmentCells: Map<string, number[]>;
  midpointCells: Map<string, number[]>;
  centerCells: Map<string, number[]>;
  midpoints: Pt[];
  cellSize: number;
}

export interface SnapTarget {
  point: Pt;
  kind: 'endpoint' | 'midpoint' | 'center' | 'intersection';
}

const cellKey = (x: number, y: number) => `${x},${y}`;
const cellRange = (min: number, max: number, size: number) => [
  Math.floor(min / size),
  Math.floor(max / size),
];

export function createSnapIndex(geometry: SnapGeometry, cellSize = 48): SnapIndex {
  const endpointCells = new Map<string, number[]>();
  const segmentCells = new Map<string, number[]>();
  const midpointCells = new Map<string, number[]>();
  const centerCells = new Map<string, number[]>();
  const add = (cells: Map<string, number[]>, key: string, index: number) => {
    const items = cells.get(key);
    if (items) items.push(index);
    else cells.set(key, [index]);
  };
  const addPoints = (points: Pt[], cells: Map<string, number[]>) => {
    points.forEach((point, index) => {
      add(cells, cellKey(Math.floor(point.x / cellSize), Math.floor(point.y / cellSize)), index);
    });
  };

  const midpoints = geometry.segments.map(({ a, b }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }));
  addPoints(geometry.endpoints, endpointCells);
  addPoints(midpoints, midpointCells);
  addPoints(geometry.centers ?? [], centerCells);
  geometry.segments.forEach((segment, index) => {
    const [minX, maxX] = cellRange(Math.min(segment.a.x, segment.b.x), Math.max(segment.a.x, segment.b.x), cellSize);
    const [minY, maxY] = cellRange(Math.min(segment.a.y, segment.b.y), Math.max(segment.a.y, segment.b.y), cellSize);
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) add(segmentCells, cellKey(x, y), index);
    }
  });
  return { ...geometry, midpoints, endpointCells, segmentCells, midpointCells, centerCells, cellSize };
}

function intersection(a: SnapSegment, b: SnapSegment): Pt | null {
  const rx = a.b.x - a.a.x;
  const ry = a.b.y - a.a.y;
  const sx = b.b.x - b.a.x;
  const sy = b.b.y - b.a.y;
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < 1e-8) return null;
  const qpx = b.a.x - a.a.x;
  const qpy = b.a.y - a.a.y;
  const t = (qpx * sy - qpy * sx) / denominator;
  const u = (qpx * ry - qpy * rx) / denominator;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a.a.x + t * rx, y: a.a.y + t * ry };
}

export function snapPoint(point: Pt, index: SnapIndex, tolerance: number): SnapTarget | null {
  const cellSize = index.cellSize;
  const [minX, maxX] = cellRange(point.x - tolerance, point.x + tolerance, cellSize);
  const [minY, maxY] = cellRange(point.y - tolerance, point.y + tolerance, cellSize);
  let best: SnapTarget | null = null;
  let bestDistance = tolerance;

  const endpointIds = new Set<number>();
  const midpointIds = new Set<number>();
  const centerIds = new Set<number>();
  const segmentIds = new Set<number>();
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      for (const id of index.endpointCells.get(cellKey(x, y)) ?? []) endpointIds.add(id);
      for (const id of index.midpointCells.get(cellKey(x, y)) ?? []) midpointIds.add(id);
      for (const id of index.centerCells.get(cellKey(x, y)) ?? []) centerIds.add(id);
      for (const id of index.segmentCells.get(cellKey(x, y)) ?? []) segmentIds.add(id);
    }
  }

  const considerPoints = (ids: Set<number>, points: Pt[], kind: SnapTarget['kind']) => {
    for (const id of ids) {
      const candidate = points[id];
      const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
      if (distance <= bestDistance) {
        best = { point: candidate, kind };
        bestDistance = distance;
      }
    }
  };
  considerPoints(endpointIds, index.endpoints, 'endpoint');
  considerPoints(midpointIds, index.midpoints, 'midpoint');
  considerPoints(centerIds, index.centers ?? [], 'center');

  const nearbySegments = [...segmentIds].filter((id) => {
    const segment = index.segments[id];
    return Math.max(segment.a.x, segment.b.x) >= point.x - tolerance &&
      Math.min(segment.a.x, segment.b.x) <= point.x + tolerance &&
      Math.max(segment.a.y, segment.b.y) >= point.y - tolerance &&
      Math.min(segment.a.y, segment.b.y) <= point.y + tolerance;
  });
  for (let i = 0; i < nearbySegments.length; i++) {
    for (let j = i + 1; j < nearbySegments.length; j++) {
      const candidate = intersection(index.segments[nearbySegments[i]], index.segments[nearbySegments[j]]);
      if (!candidate) continue;
      const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
      if (distance <= bestDistance) {
        best = { point: candidate, kind: 'intersection' };
        bestDistance = distance;
      }
    }
  }
  return best;
}

export function measurementArrowheads(markup: Pick<Markup, 'type' | 'points' | 'measurementArrowheads' | 'measurementArrowSize'>) {
  if (markup.type !== 'm-length' || markup.points.length < 2) return [];
  const style = markup.measurementArrowheads ?? 'none';
  if (style === 'none') return [];
  const [start, end] = markup.points;
  const size = Math.max(2, Math.min(40, markup.measurementArrowSize ?? 8));
  const head = (from: Pt, to: Pt) => {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const side = 0.45;
    return [
      to,
      { x: to.x + size * Math.cos(angle + Math.PI - side), y: to.y + size * Math.sin(angle + Math.PI - side) },
      { x: to.x + size * Math.cos(angle + Math.PI + side), y: to.y + size * Math.sin(angle + Math.PI + side) },
    ];
  };
  const heads: Pt[][] = [];
  if (style === 'start' || style === 'both') heads.push(head(end, start));
  if (style === 'end' || style === 'both') heads.push(head(start, end));
  return heads;
}
