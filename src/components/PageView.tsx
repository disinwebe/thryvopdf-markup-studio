import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Doc, Style, Tool, makeMarkup } from '../app/model';
import { applyHandle, boxOf, dist, handlesOf, pickTop, simplify, translate, HandleKey } from '../core/geometry';
import { countNumbers, DEFAULT_CAL } from '../core/measurement';
import { Markup, MarkupType, Pt } from '../core/types';
import { pageSize, renderToCanvas } from '../pdf/pdfjs';
import { MarkupShape } from './MarkupShape';
import { numberMarkups } from '../core/numbering';
import { CALLOUT_MAX, CALLOUT_MIN_H, CALLOUT_MIN_W, calloutLayout, hitCallout, moveCallout } from '../core/callout';
import { ownsComment, ownsMarkup, type Actor } from '../core/comments';

const TWO_POINT: Tool[] = ['highlight', 'text', 'callout', 'cloud', 'rect', 'ellipse', 'line', 'arrow', 'm-length', 'calibrate'];
const CLICK: Tool[] = ['stamp', 'note', 'm-count'];
const MULTI: Tool[] = ['polyline', 'm-polylength', 'm-area', 'm-perimeter', 'm-angle'];

type Drag =
  | { kind: 'pan'; sx: number; sy: number; sl: number; st: number }
  | { kind: 'move'; start: Pt; orig: Markup; began: boolean }
  | { kind: 'callout'; start: Pt; orig: Markup; from: Pt; began: boolean }
  | { kind: 'callout-resize'; start: Pt; orig: Markup; width: number; height: number; began: boolean }
  | { kind: 'handle'; key: HandleKey; orig: Markup; began: boolean }
  | { kind: 'two'; moved: boolean }
  | { kind: 'pen' };

export interface PageViewProps {
  doc: Doc;
  tool: Tool;
  style: Style;
  author: string;
  user: Actor;
  selectedId: string | null;
  fit: { mode: 'width' | 'page'; n: number };
  onSelect(id: string | null): void;
  onCreate(m: Markup): void;
  onBeginEdit(): void;
  onLive(markups: Markup[]): void;
  onZoom(z: number): void;
  onCalibrate(a: Pt, b: Pt): void;
  onContextMenu(event: React.MouseEvent<HTMLDivElement>, markupId: string | null, point: Pt): void;
  onMessage(msg: string): void;
}

export function PageView(p: PageViewProps) {
  const { doc, tool, style } = p;
  const zoom = doc.zoom || 1;
  const scroller = useRef<HTMLDivElement>(null);
  const pageEl = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const taskRef = useRef<{ cancel(): void; promise: Promise<unknown> } | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [draft, setDraftState] = useState<Pt[] | null>(null);
  const draftRef = useRef<Pt[] | null>(null);
  const setDraft = (d: Pt[] | null) => {
    draftRef.current = d;
    setDraftState(d);
  };
  const [cur, setCur] = useState<Pt | null>(null);
  const drag = useRef<Drag | null>(null);
  const spaceDown = useRef(false);
  const anchor = useRef<{ pt: Pt; ox: number; oy: number } | null>(null);

  useEffect(() => {
    let live = true;
    setSize(null);
    pageSize(doc.pdf, doc.page).then((s) => live && setSize(s));
    return () => {
      live = false;
    };
  }, [doc.pdf, doc.page]);

  // fit page on first display or when requested
  const fitDone = useRef({ n: p.fit.n, id: '', viewport: 0 });
  const [viewportRevision, setViewportRevision] = useState(0);
  const fittedZoom = useRef<number | null>(null);
  useEffect(() => {
    if (!scroller.current) return;
    const observer = new ResizeObserver(() => setViewportRevision((revision) => revision + 1));
    observer.observe(scroller.current);
    return () => observer.disconnect();
  }, [size]);
  useEffect(() => {
    if (!size || !scroller.current) return;
    const first = doc.zoom === 0;
    const explicit = p.fit.n !== fitDone.current.n;
    const resized = viewportRevision > fitDone.current.viewport && fitDone.current.id === doc.id;
    const autoFit = fittedZoom.current !== null && Math.abs(doc.zoom - fittedZoom.current) < 0.0001;
    if (!first && !explicit && !(resized && autoFit)) return;
    fitDone.current = { n: p.fit.n, id: doc.id, viewport: viewportRevision };
    const cw = scroller.current.clientWidth - 56,
      ch = scroller.current.clientHeight - 56;
    const z = p.fit.mode === 'width' ? cw / size.w : Math.min(cw / size.w, ch / size.h);
    fittedZoom.current = Math.max(0.05, Math.min(8, z));
    p.onZoom(fittedZoom.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, p.fit.n, doc.id, viewportRevision]);

  useEffect(() => {
    if (!size || !canvas.current) return;
    let cancelled = false;
    const el = canvas.current;
    (async () => {
      if (taskRef.current) {
        taskRef.current.cancel();
        try {
          await taskRef.current.promise;
        } catch {
          /* cancelled */
        }
      }
      if (cancelled) return;
      const dpr = window.devicePixelRatio || 1;
      const scale = Math.min(zoom * dpr, 8192 / Math.max(size.w, size.h));
      const task = await renderToCanvas(doc.pdf, doc.page, scale, el);
      taskRef.current = task;
      try {
        await task.promise;
      } catch {
        /* cancelled */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc.pdf, doc.page, zoom, size]);

  useLayoutEffect(() => {
    const a = anchor.current;
    if (a && scroller.current && pageEl.current) {
      scroller.current.scrollLeft = pageEl.current.offsetLeft + a.pt.x * zoom - a.ox;
      scroller.current.scrollTop = pageEl.current.offsetTop + a.pt.y * zoom - a.oy;
      anchor.current = null;
    }
  }, [zoom]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey || !pageEl.current) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const pr = pageEl.current.getBoundingClientRect();
      const nz = Math.max(0.05, Math.min(8, zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      anchor.current = {
        pt: { x: (e.clientX - pr.left) / zoom, y: (e.clientY - pr.top) / zoom },
        ox: e.clientX - r.left,
        oy: e.clientY - r.top,
      };
      p.onZoom(nz);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  });

  const finish = (points: Pt[]) => {
    const type = tool as MarkupType;
    let ok = true;
    if (tool === 'polyline' || tool === 'm-polylength') ok = points.length >= 2;
    if (tool === 'm-area' || tool === 'm-perimeter') ok = points.length >= 3;
    if (tool === 'm-angle') ok = points.length === 3;
    if (!ok) {
      p.onMessage('Not enough points - tool cancelled');
    } else p.onCreate(makeMarkup(type, doc.page, points, style, p.author));
    setDraft(null);
    setCur(null);
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
      if (e.code === 'Space' && !typing) {
        spaceDown.current = e.type === 'keydown';
        if (e.type === 'keydown') e.preventDefault();
      }
      if (e.type !== 'keydown' || typing) return;
      const d = draftRef.current;
      if (!d) return;
      if (e.key === 'Escape') {
        setDraft(null);
        setCur(null);
      } else if (e.key === 'Enter' && MULTI.includes(tool)) finish(d);
      else if (e.key === 'Backspace' && MULTI.includes(tool)) {
        e.preventDefault();
        const nd = d.slice(0, -1);
        setDraft(nd.length ? nd : null);
      }
    };
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', key);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', key);
    };
  });

  useEffect(() => {
    setDraft(null);
    setCur(null);
  }, [tool, doc.page, doc.id]);

  const toPt = (e: React.PointerEvent | React.MouseEvent): Pt => {
    const r = pageEl.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  };

  const selected = doc.markups.find((m) => m.id === p.selectedId && m.page === doc.page && (!doc.shared || ownsMarkup(m, p.user))) ?? null;
  const canMoveCallout = (m: Markup) => !doc.shared || (ownsMarkup(m, p.user) && m.comments.every((comment) => ownsComment(comment, p.user)));

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const sc = scroller.current!;
    if (e.button === 1 || tool === 'hand' || spaceDown.current) {
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, sl: sc.scrollLeft, st: sc.scrollTop };
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    const pt = toPt(e);
    e.currentTarget.setPointerCapture(e.pointerId);

    if (tool === 'select') {
      const calloutHit = [...doc.markups].reverse().find((m) => m.page === doc.page && hitCallout(m, pt));
      if (doc.shared && calloutHit && !ownsMarkup(calloutHit, p.user)) {
        p.onSelect(null);
        return;
      }
      if (selected) {
        const box = calloutLayout(selected);
        if (canMoveCallout(selected) && box && dist({ x: box.x + box.w, y: box.y + box.h }, pt) * zoom <= 10) {
          drag.current = { kind: 'callout-resize', start: pt, orig: selected, width: box.w, height: box.h, began: false };
          return;
        }
        const h = handlesOf(selected).find((h) => dist(h.p, pt) * zoom <= 9);
        if (h) {
          drag.current = { kind: 'handle', key: h.key, orig: selected, began: false };
          return;
        }
      }
      if (calloutHit && (!doc.shared || ownsMarkup(calloutHit, p.user))) {
        p.onSelect(calloutHit.id);
        if (canMoveCallout(calloutHit)) {
          const l = calloutLayout(calloutHit)!;
          drag.current = { kind: 'callout', start: pt, orig: calloutHit, from: { x: l.x, y: l.y }, began: false };
        }
        return;
      }
      const candidates = doc.shared ? doc.markups.filter((m) => ownsMarkup(m, p.user)) : doc.markups;
      const hit = pickTop(candidates, doc.page, pt, 6 / zoom);
      if (hit) {
        p.onSelect(hit.id);
        drag.current = { kind: 'move', start: pt, orig: hit, began: false };
      } else p.onSelect(null);
      return;
    }
    if (TWO_POINT.includes(tool)) {
      const d = draftRef.current;
      if (d && d.length === 1) {
        finishTwo(d[0], pt);
        return;
      }
      setDraft([pt]);
      setCur(pt);
      drag.current = { kind: 'two', moved: false };
      return;
    }
    if (CLICK.includes(tool)) {
      let points = [pt];
      if (tool === 'stamp') {
        const ratio = style.stampImage ? style.stampImage.width / style.stampImage.height : 3.5;
        const w = Math.min(140, 80 * ratio);
        const h = Math.min(80, 140 / ratio);
        points = [{ x: pt.x - w / 2, y: pt.y - h / 2 }, { x: pt.x + w / 2, y: pt.y + h / 2 }];
      }
      p.onCreate(makeMarkup(tool as MarkupType, doc.page, points, style, p.author));
      return;
    }
    if (MULTI.includes(tool)) {
      const pts = [...(draftRef.current ?? []), pt];
      setDraft(pts);
      setCur(pt);
      if (tool === 'm-angle' && pts.length === 3) finish(pts);
      return;
    }
    if (tool === 'pen') {
      setDraft([pt]);
      drag.current = { kind: 'pen' };
    }
  };

  const finishTwo = (a: Pt, b: Pt) => {
    setDraft(null);
    setCur(null);
    if (tool === 'calibrate') {
      if (dist(a, b) > 1) p.onCalibrate(a, b);
      return;
    }
    if (dist(a, b) * zoom < 4) return;
    let points = [a, b];
    if (tool === 'callout') {
      const r = boxOf({ points });
      points = [a, b, { x: r.x - 40, y: r.y + r.h + 40 }];
    }
    p.onCreate(makeMarkup(tool as MarkupType, doc.page, points, style, p.author));
  };

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const dg = drag.current;
    if (dg?.kind === 'pan') {
      const sc = scroller.current!;
      sc.scrollLeft = dg.sl - (e.clientX - dg.sx);
      sc.scrollTop = dg.st - (e.clientY - dg.sy);
      return;
    }
    const pt = toPt(e);
    if (draftRef.current) setCur(pt);
    if (!dg) return;
    if (dg.kind === 'move') {
      const dx = pt.x - dg.start.x,
        dy = pt.y - dg.start.y;
      if (!dg.began) {
        if (Math.hypot(dx, dy) * zoom < 3) return;
        dg.began = true;
        p.onBeginEdit();
      }
      p.onLive(doc.markups.map((m) => (m.id === dg.orig.id ? translate(dg.orig, dx, dy) : m)));
    } else if (dg.kind === 'callout') {
      const dx = pt.x - dg.start.x,
        dy = pt.y - dg.start.y;
      if (!dg.began) {
        if (Math.hypot(dx, dy) * zoom < 3) return;
        dg.began = true;
        p.onBeginEdit();
      }
      p.onLive(doc.markups.map((m) => (m.id === dg.orig.id ? moveCallout(dg.orig, { x: dg.from.x + dx, y: dg.from.y + dy }) : m)));
    } else if (dg.kind === 'callout-resize') {
      if (!dg.began) {
        if (dist(dg.start, pt) * zoom < 3) return;
        dg.began = true;
        p.onBeginEdit();
      }
      const width = Math.max(CALLOUT_MIN_W, Math.min(CALLOUT_MAX, dg.width + pt.x - dg.start.x));
      const height = Math.max(CALLOUT_MIN_H, Math.min(CALLOUT_MAX, dg.height + pt.y - dg.start.y));
      p.onLive(doc.markups.map((m) => m.id === dg.orig.id ? { ...dg.orig, calloutSize: { width, height } } : m));
    } else if (dg.kind === 'handle') {
      if (!dg.began) {
        dg.began = true;
        p.onBeginEdit();
      }
      p.onLive(doc.markups.map((m) => (m.id === dg.orig.id ? applyHandle(dg.orig, dg.key, pt) : m)));
    } else if (dg.kind === 'two') {
      const d = draftRef.current;
      if (d && dist(d[0], pt) * zoom > 4) dg.moved = true;
    } else if (dg.kind === 'pen') {
      const d = draftRef.current;
      if (d && dist(d[d.length - 1], pt) * zoom >= 2) setDraft([...d, pt]);
    }
  };

  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const dg = drag.current;
    drag.current = null;
    if (!dg) return;
    if (dg.kind === 'two' && dg.moved && draftRef.current) finishTwo(draftRef.current[0], toPt(e));
    else if (dg.kind === 'pen' && draftRef.current) {
      const pts = simplify(draftRef.current, 0.8);
      setDraft(null);
      if (pts.length >= 2) p.onCreate(makeMarkup('pen', doc.page, pts, style, p.author));
    }
  };

  const onDouble = () => {
    const d = draftRef.current;
    if (d && MULTI.includes(tool) && d.length >= 2) finish(d.slice(0, -1));
  };

  const countNos = useMemo(() => countNumbers(doc.markups), [doc.markups]);

  const tags = useMemo(() => numberMarkups(doc.markups), [doc.markups]);
  const cal = doc.calibrations[doc.page] ?? DEFAULT_CAL;
  const pageMarkups = doc.markups.filter((m) => m.page === doc.page);

  let preview: Markup | null = null;
  if (draft && cur) {
    const type = (tool === 'calibrate' ? 'line' : tool) as MarkupType;
    const pts = TWO_POINT.includes(tool) ? [draft[0], cur] : MULTI.includes(tool) ? [...draft, cur] : draft;
    if (pts.length >= 2 && type !== ('select' as string))
      preview = makeMarkup(tool === 'calibrate' ? 'line' : type, doc.page, pts, tool === 'calibrate' ? { ...style, color: '#ff6d00', width: 2 } : style, p.author);
    if (preview && tool === 'callout') preview.points = [...pts, { x: pts[0].x - 40, y: pts[1].y + 40 }];
  } else if (draft && tool === 'pen' && draft.length >= 2) {
    preview = makeMarkup('pen', doc.page, draft, style, p.author);
  }

  const cursor =
    tool === 'hand' ? 'grab' : tool === 'select' ? 'default' : 'crosshair';
  const hs = selected && tool === 'select' ? handlesOf(selected) : [];
  const hsz = 5 / zoom;
  const selectedCallout = selected && tool === 'select' && canMoveCallout(selected) ? calloutLayout(selected) : null;

  return (
    <div className="scroller" ref={scroller}>
      {size && (
        <div
          className="page"
          ref={pageEl}
          style={{ width: size.w * zoom, height: size.h * zoom }}
        >
          <canvas ref={canvas} style={{ width: size.w * zoom, height: size.h * zoom }} />
          <svg
            width={size.w * zoom}
            height={size.h * zoom}
            viewBox={`0 0 ${size.w} ${size.h}`}
            style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}
          >
            {pageMarkups.map((m) => (
              <MarkupShape key={m.id} m={m} cal={cal} countNo={countNos.get(m.id)} tag={tags.get(m.id)} />
            ))}
            {preview && (
              <g opacity={0.85}>
                <MarkupShape m={preview} cal={cal} />
              </g>
            )}
            {selected && (
              <SelectionBox m={selected} zoom={zoom} />
            )}
            {hs.map((h) => (
              <rect
                key={String(h.key)}
                x={h.p.x - hsz}
                y={h.p.y - hsz}
                width={hsz * 2}
                height={hsz * 2}
                fill={h.key === 'tip' ? '#ff6d00' : '#fff'}
                stroke="#1976d2"
                strokeWidth={1.5 / zoom}
              />
            ))}
            {selectedCallout && (
              <rect x={selectedCallout.x + selectedCallout.w - hsz} y={selectedCallout.y + selectedCallout.h - hsz}
                width={hsz * 2} height={hsz * 2} fill="#fff" stroke="#1976d2" strokeWidth={1.5 / zoom} />
            )}
          </svg>
          <div
            className="capture"
            style={{ cursor }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onDoubleClick={onDouble}
            onContextMenu={(e) => {
              e.preventDefault();
              const point = toPt(e);
              const d = draftRef.current;
              if (d && MULTI.includes(tool)) finish(d);
              const calloutHit = [...doc.markups].reverse().find((m) => m.page === doc.page && hitCallout(m, point));
              const candidates = doc.shared ? doc.markups.filter((m) => ownsMarkup(m, p.user)) : doc.markups;
              const hit = calloutHit ?? pickTop(candidates, doc.page, point, 6 / zoom);
              const selectable = hit && (!doc.shared || ownsMarkup(hit, p.user)) ? hit : null;
              if (selectable) p.onSelect(selectable.id);
              p.onContextMenu(e, selectable?.id ?? null, point);
            }}
          />
        </div>
      )}
    </div>
  );
}

function SelectionBox({ m, zoom }: { m: Markup; zoom: number }) {
  const xs = m.points.map((q) => q.x),
    ys = m.points.map((q) => q.y);
  let x0 = Math.min(...xs),
    y0 = Math.min(...ys),
    x1 = Math.max(...xs),
    y1 = Math.max(...ys);
  if (m.type === 'note' || m.type === 'm-count') {
    x0 -= 12;
    y0 -= 12;
    x1 += 12;
    y1 += 12;
  }
  const pad = 4 / zoom;
  return (
    <rect
      x={x0 - pad}
      y={y0 - pad}
      width={x1 - x0 + pad * 2}
      height={y1 - y0 + pad * 2}
      fill="none"
      stroke="#1976d2"
      strokeWidth={1.2 / zoom}
      strokeDasharray={`${4 / zoom} ${3 / zoom}`}
    />
  );
}
