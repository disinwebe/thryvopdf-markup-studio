import { AnnotationMode, OPS, Util } from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { createSnapIndex } from '../core/snapping';
import type { SnapGeometry, SnapIndex, SnapSegment } from '../core/snapping';
import type { Pt } from '../core/types';

type Matrix = [number, number, number, number, number, number];
interface OperatorList {
  fnArray: number[];
  argsArray: unknown[];
}

function mapPoint(point: Pt, matrix: number[]): Pt {
  const [x, y] = Util.applyTransform([point.x, point.y], matrix);
  return { x, y };
}

export function snapGeometryFromOperatorList(operatorList: OperatorList, viewportTransform: number[]): SnapGeometry {
  const segments: SnapSegment[] = [];
  const endpoints: Pt[] = [];
  let transform: Matrix = [1, 0, 0, 1, 0, 0];
  const transforms: Matrix[] = [];
  const ops = OPS as typeof OPS & Record<string, number>;

  const parsePath = (pathOps: number[], coordinates: number[]) => {
    let offset = 0;
    let current: Pt | null = null;
    let start: Pt | null = null;
    const toPage = (x: number, y: number) => mapPoint({ x, y }, Util.transform(viewportTransform, transform));
    const addLine = (next: Pt, isEndpoint = true) => {
      if (current) segments.push({ a: current, b: next });
      if (isEndpoint) endpoints.push(next);
      current = next;
    };

    for (const op of pathOps) {
      if (op === OPS.moveTo) {
        current = toPage(coordinates[offset++], coordinates[offset++]);
        start = current;
        endpoints.push(current);
      } else if (op === OPS.lineTo) {
        addLine(toPage(coordinates[offset++], coordinates[offset++]));
      } else if (op === OPS.curveTo || op === OPS.curveTo2 || op === OPS.curveTo3) {
        if (!current) {
          offset += op === OPS.curveTo ? 6 : 4;
          continue;
        }
        const from = current;
        let c1: Pt, c2: Pt, to: Pt;
        if (op === OPS.curveTo) {
          c1 = toPage(coordinates[offset++], coordinates[offset++]);
          c2 = toPage(coordinates[offset++], coordinates[offset++]);
          to = toPage(coordinates[offset++], coordinates[offset++]);
        } else if (op === OPS.curveTo2) {
          c1 = from;
          c2 = toPage(coordinates[offset++], coordinates[offset++]);
          to = toPage(coordinates[offset++], coordinates[offset++]);
        } else {
          c1 = toPage(coordinates[offset++], coordinates[offset++]);
          to = toPage(coordinates[offset++], coordinates[offset++]);
          c2 = to;
        }
        for (let step = 1; step <= 8; step++) {
          const t = step / 8;
          const mt = 1 - t;
          const point = {
            x: mt ** 3 * from.x + 3 * mt ** 2 * t * c1.x + 3 * mt * t ** 2 * c2.x + t ** 3 * to.x,
            y: mt ** 3 * from.y + 3 * mt ** 2 * t * c1.y + 3 * mt * t ** 2 * c2.y + t ** 3 * to.y,
          };
          addLine(point, step === 8);
        }
      } else if (op === OPS.rectangle) {
        const x = coordinates[offset++], y = coordinates[offset++];
        const w = coordinates[offset++], h = coordinates[offset++];
        const corners = [
          toPage(x, y), toPage(x + w, y), toPage(x + w, y + h), toPage(x, y + h),
        ];
        current = null;
        start = null;
        for (let i = 0; i < corners.length; i++) {
          const next = corners[i];
          if (current) segments.push({ a: current, b: next });
          endpoints.push(next);
          current = next;
        }
        if (current && start) segments.push({ a: current, b: start });
        current = corners[0];
        start = corners[0];
      } else if (op === OPS.closePath) {
        if (current && start) segments.push({ a: current, b: start });
        if (start) endpoints.push(start);
        current = start;
      }
    }
  };

  for (let i = 0; i < operatorList.fnArray.length; i++) {
    const fn = operatorList.fnArray[i];
    const args = operatorList.argsArray[i] as unknown[] | null;
    if (fn === OPS.save) transforms.push([...transform] as Matrix);
    else if (fn === OPS.restore) transform = transforms.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform && args && args.length === 6 &&
      (Array.isArray(args) || ArrayBuffer.isView(args))) {
      transform = Util.transform(transform, Array.from(args as ArrayLike<number>) as Matrix) as Matrix;
    } else if (fn === OPS.constructPath && args && args.length >= 2 &&
      (Array.isArray(args[0]) || ArrayBuffer.isView(args[0])) &&
      (Array.isArray(args[1]) || ArrayBuffer.isView(args[1]))) {
      parsePath(Array.from(args[0] as ArrayLike<number>), Array.from(args[1] as ArrayLike<number>));
    }
  }
  return { segments, endpoints };
}

const cache = new WeakMap<PDFDocumentProxy, Map<number, Promise<SnapIndex>>>();

export function pageSnapIndex(pdf: PDFDocumentProxy, pageIndex: number): Promise<SnapIndex> {
  let pages = cache.get(pdf);
  if (!pages) {
    pages = new Map();
    cache.set(pdf, pages);
  }
  const existing = pages.get(pageIndex);
  if (existing) return existing;
  const loading = pdf.getPage(pageIndex + 1).then(async (page) => {
    const viewport = page.getViewport({ scale: 1 });
    const operators = await page.getOperatorList({ intent: 'display', annotationMode: AnnotationMode.DISABLE });
    return createSnapIndex(snapGeometryFromOperatorList(operators, viewport.transform));
  });
  pages.set(pageIndex, loading);
  loading.catch(() => pages?.delete(pageIndex));
  return loading;
}
