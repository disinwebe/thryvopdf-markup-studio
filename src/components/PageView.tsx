import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Doc, Style, Tool, makeMarkup } from '../app/model';
import { applyHandle, boxOf, dist, handlesOf, hitMarkup, pickTop, simplify, translate, HandleKey } from '../core/geometry';
import { countNumbers, DEFAULT_CAL } from '../core/measurement';
import { Markup, MarkupType, Pt } from '../core/types';
import { pageSize, renderToCanvas } from '../pdf/pdfjs';
import { MarkupShape } from './MarkupShape';
import { numberMarkups } from '../core/numbering';
import { CALLOUT_MAX, CALLOUT_MIN_H, CALLOUT_MIN_W, calloutLayout, hitCallout, moveCallout } from '../core/callout';
import { ownsComment, ownsMarkup, type Actor } from '../core/comments';
import { resizePageObject, type PageContentTool, type PageObject } from '../core/pageContent';
import { orderedPageLayers, topPageLayerAt } from '../core/layerOrder';
import { normalizedRect, selectInWindow } from '../core/selection';
import { SnapIndex, SnapTarget, snapPoint } from '../core/snapping';
import { pageSnapIndex } from '../pdf/snapping';
import { expandGroupedSelection } from '../core/grouping';

const TWO_POINT: Tool[] = ['highlight', 'text', 'callout', 'rect', 'ellipse', 'line', 'arrow', 'm-length', 'calibrate'];
const CLICK: Tool[] = ['stamp', 'note', 'm-count', 'image'];
const MULTI: Tool[] = ['cloud', 'polyline', 'm-polylength', 'm-area', 'm-perimeter', 'm-angle'];
const SNAP_TOOLS: Tool[] = ['calibrate', 'm-length', 'm-polylength', 'm-area', 'm-perimeter', 'm-angle'];

type Drag =
  | { kind: 'pan'; sx: number; sy: number; sl: number; st: number }
  | { kind: 'move'; start: Pt; orig: Markup; began: boolean }
  | { kind: 'callout'; start: Pt; orig: Markup; from: Pt; began: boolean }
  | { kind: 'callout-resize'; start: Pt; orig: Markup; width: number; height: number; began: boolean }
  | { kind: 'handle'; key: HandleKey; orig: Markup; began: boolean }
  | { kind: 'page-object-move'; start: Pt; orig: PageObject }
  | { kind: 'page-object-resize'; start: Pt; orig: PageObject }
  | { kind: 'selection-move'; start: Pt; markups: Markup[]; callouts: Markup[]; pageObjects: PageObject[]; began: boolean }
  | { kind: 'selection-window'; start: Pt; additive: boolean }
  | { kind: 'two'; moved: boolean }
  | { kind: 'pen' };

export interface PageViewProps {
  doc: Doc;
  tool: Tool;
  style: Style;
  author: string;
  user: Actor;
  selectedMarkupIds: string[];
  selectedCalloutIds: string[];
  selectedPageObjectIds: string[];
  fit: { mode: 'width' | 'page'; n: number };
  onCreate(m: Markup): void;
  onBeginEdit(): void;
  onLive(markups: Markup[]): void;
  onZoom(z: number): void;
  onCalibrate(a: Pt, b: Pt): void;
  onContextMenu(event: React.MouseEvent<HTMLDivElement>, markupId: string | null, pageObjectId: string | null, point: Pt, calloutOnly?: boolean): void;
  onMessage(msg: string): void;
  contentTool: PageContentTool | null;
  onCreatePageObject(page: number, point: Pt): void;
  onSelectionChange(markupIds: string[], pageObjectIds: string[], calloutIds?: string[]): void;
  onPageObjectsChange(objects: PageObject[]): void;
  onEditPageObject(id: string): void;
  onAddImage(page: number, point: Pt): void;
  onEditComments(markupId: string): void;
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
  const [snapIndex, setSnapIndex] = useState<SnapIndex | null>(null);
  const [snapTarget, setSnapTarget] = useState<SnapTarget | null>(null);
  const [selectionWindow, setSelectionWindow] = useState<ReturnType<typeof normalizedRect> | null>(null);
  const drag = useRef<Drag | null>(null);
  const spaceDown = useRef(false);
  const anchor = useRef<{ pt: Pt; ox: number; oy: number } | null>(null);
  const messageRef = useRef(p.onMessage);
  messageRef.current = p.onMessage;

  const snapAt = (point: Pt): Pt => {
    if (!SNAP_TOOLS.includes(tool) || !snapIndex) {
      setSnapTarget(null);
      return point;
    }
    const target = snapPoint(point, snapIndex, 10 / zoom);
    setSnapTarget(target);
    return target?.point ?? point;
  };

  useEffect(() => {
    let live = true;
    setSnapIndex(null);
    setSnapTarget(null);
    pageSnapIndex(doc.pdf, doc.page).then((index) => {
      if (live) setSnapIndex(index);
    }).catch((error: unknown) => {
      if (live) messageRef.current(`Could not load measurement snap geometry: ${error instanceof Error ? error.message : String(error)}`);
    });
    return () => {
      live = false;
    };
  }, [doc.pdf, doc.page]);

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
    if (tool === 'cloud') ok = points.length >= 3;
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

  const selected = p.selectedMarkupIds.length === 1
    ? doc.markups.find((m) => m.id === p.selectedMarkupIds[0] && m.page === doc.page && (!doc.shared || ownsMarkup(m, p.user))) ?? null
    : null;
  const canMoveCallout = (m: Markup) => !doc.shared || (ownsMarkup(m, p.user) && m.comments.every((comment) => ownsComment(comment, p.user)));
  const additiveSelection = (e: React.PointerEvent) => e.ctrlKey || e.metaKey || e.shiftKey;
  const selectMarkup = (id: string, additive: boolean) => {
    const markup = doc.markups.find((item) => item.id === id);
    const group = markup?.groupId;
    const groupMarkupIds = group ? doc.markups.filter((item) => item.page === doc.page && item.groupId === group).map((item) => item.id) : [id];
    const groupObjectIds = group ? doc.pageObjects.filter((item) => item.page === doc.page && item.groupId === group).map((item) => item.id) : [];
    if (!additive) {
      const expanded = expandGroupedSelection(doc.markups, doc.pageObjects, doc.page, [id], []);
      p.onSelectionChange(expanded.markupIds, expanded.pageObjectIds, []);
      return;
    }
    const selected = groupMarkupIds.some((item) => p.selectedMarkupIds.includes(item)) || groupObjectIds.some((item) => p.selectedPageObjectIds.includes(item));
    const markupIds = new Set(p.selectedMarkupIds);
    const objectIds = new Set(p.selectedPageObjectIds);
    for (const item of groupMarkupIds) selected ? markupIds.delete(item) : markupIds.add(item);
    for (const item of groupObjectIds) selected ? objectIds.delete(item) : objectIds.add(item);
    p.onSelectionChange([...markupIds], [...objectIds], p.selectedCalloutIds);
  };
  const selectPageObject = (id: string, additive: boolean) => {
    const object = doc.pageObjects.find((item) => item.id === id);
    const group = object?.groupId;
    const groupMarkupIds = group ? doc.markups.filter((item) => item.page === doc.page && item.groupId === group).map((item) => item.id) : [];
    const groupObjectIds = group ? doc.pageObjects.filter((item) => item.page === doc.page && item.groupId === group).map((item) => item.id) : [id];
    if (!additive) {
      const expanded = expandGroupedSelection(doc.markups, doc.pageObjects, doc.page, [], [id]);
      p.onSelectionChange(expanded.markupIds, expanded.pageObjectIds, []);
      return;
    }
    const selected = groupMarkupIds.some((item) => p.selectedMarkupIds.includes(item)) || groupObjectIds.some((item) => p.selectedPageObjectIds.includes(item));
    const markupIds = new Set(p.selectedMarkupIds);
    const objectIds = new Set(p.selectedPageObjectIds);
    for (const item of groupMarkupIds) selected ? markupIds.delete(item) : markupIds.add(item);
    for (const item of groupObjectIds) selected ? objectIds.delete(item) : objectIds.add(item);
    p.onSelectionChange([...markupIds], [...objectIds], p.selectedCalloutIds);
  };
  const selectCallout = (id: string, additive: boolean) => {
    const markup = doc.markups.find((item) => item.id === id);
    if (markup?.groupId) {
      const expanded = expandGroupedSelection(doc.markups, doc.pageObjects, doc.page, [id], []);
      if (!additive) {
        p.onSelectionChange(expanded.markupIds, expanded.pageObjectIds, [id]);
        return;
      }
      const selected = p.selectedCalloutIds.includes(id);
      const markupIds = new Set(p.selectedMarkupIds);
      const objectIds = new Set(p.selectedPageObjectIds);
      const calloutIds = new Set(p.selectedCalloutIds);
      for (const item of expanded.markupIds) selected ? markupIds.delete(item) : markupIds.add(item);
      for (const item of expanded.pageObjectIds) selected ? objectIds.delete(item) : objectIds.add(item);
      selected ? calloutIds.delete(id) : calloutIds.add(id);
      p.onSelectionChange([...markupIds], [...objectIds], [...calloutIds]);
      return;
    }
    if (!additive) {
      p.onSelectionChange([], [], [id]);
      return;
    }
    const ids = new Set(p.selectedCalloutIds);
    ids.has(id) ? ids.delete(id) : ids.add(id);
    p.onSelectionChange(p.selectedMarkupIds, p.selectedPageObjectIds, [...ids]);
  };
  const isSelectedMarkup = (id: string) => p.selectedMarkupIds.includes(id);
  const isSelectedPageObject = (id: string) => p.selectedPageObjectIds.includes(id);

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const sc = scroller.current!;
    if (e.button === 1 || tool === 'hand' || spaceDown.current) {
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, sl: sc.scrollLeft, st: sc.scrollTop };
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    const pt = snapAt(toPt(e));
    e.currentTarget.setPointerCapture(e.pointerId);

    if (p.contentTool) {
      p.onCreatePageObject(doc.page, pt);
      return;
    }

    if (tool === 'select') {
      const selectedPageObject = p.selectedPageObjectIds.length === 1
        ? doc.pageObjects.find((object) => object.id === p.selectedPageObjectIds[0] && object.page === doc.page)
        : undefined;
      if (selectedPageObject && pt.x >= selectedPageObject.x + selectedPageObject.width - 10 / zoom &&
          pt.y >= selectedPageObject.y + selectedPageObject.height - 10 / zoom &&
          pt.x <= selectedPageObject.x + selectedPageObject.width + 6 / zoom &&
          pt.y <= selectedPageObject.y + selectedPageObject.height + 6 / zoom) {
        drag.current = { kind: 'page-object-resize', start: pt, orig: selectedPageObject };
        e.preventDefault();
        return;
      }
      if (!additiveSelection(e) && selected) {
        const box = calloutLayout(selected);
        if (canMoveCallout(selected) && box && dist({ x: box.x + box.w, y: box.y + box.h }, pt) * zoom <= 10) {
          drag.current = { kind: 'callout-resize', start: pt, orig: selected, width: box.w, height: box.h, began: false };
          return;
        }
        const handle = handlesOf(selected).find((item) => dist(item.p, pt) * zoom <= 9);
        if (handle) {
          drag.current = { kind: 'handle', key: handle.key, orig: selected, began: false };
          return;
        }
      }
      const calloutHit = [...doc.markups].reverse().find((m) => m.page === doc.page && hitCallout(m, pt));
      if (calloutHit && (!doc.shared || ownsMarkup(calloutHit, p.user))) {
        const additive = additiveSelection(e);
        const alreadySelected = p.selectedCalloutIds.includes(calloutHit.id);
        if (additive) {
          selectCallout(calloutHit.id, true);
          return;
        }
        if (!alreadySelected) selectCallout(calloutHit.id, false);
        if (calloutHit.groupId) {
          const expanded = expandGroupedSelection(doc.markups, doc.pageObjects, doc.page, [calloutHit.id], []);
          drag.current = {
            kind: 'selection-move',
            start: pt,
            markups: doc.markups.filter((markup) => expanded.markupIds.includes(markup.id)),
            callouts: [],
            pageObjects: doc.pageObjects.filter((object) => expanded.pageObjectIds.includes(object.id)),
            began: false,
          };
          return;
        }
        const groupIds = alreadySelected ? p.selectedMarkupIds : [];
        const groupCalloutIds = (alreadySelected ? p.selectedCalloutIds : [calloutHit.id])
          .filter((id) => {
            const markup = doc.markups.find((item) => item.id === id);
            return !!markup && canMoveCallout(markup);
          });
        const groupObjectIds = alreadySelected ? p.selectedPageObjectIds : [];
        if (groupIds.length + groupCalloutIds.length + groupObjectIds.length > 1) {
          drag.current = {
            kind: 'selection-move', start: pt,
            markups: doc.markups.filter((markup) => groupIds.includes(markup.id)),
            callouts: doc.markups.filter((markup) => groupCalloutIds.includes(markup.id)),
            pageObjects: doc.pageObjects.filter((object) => groupObjectIds.includes(object.id)),
            began: false,
          };
        } else if (canMoveCallout(calloutHit)) {
          const layout = calloutLayout(calloutHit)!;
          drag.current = { kind: 'callout', start: pt, orig: calloutHit, from: { x: layout.x, y: layout.y }, began: false };
        }
        return;
      }
      const pageMarkups = doc.markups.filter((markup) => markup.page === doc.page && (!doc.shared || ownsMarkup(markup, p.user)));
      const pageObjects = doc.pageObjects.filter((object) => object.page === doc.page);
      const annotationHit = pickTop(pageMarkups.filter((markup) => markup.type !== 'stamp'), doc.page, pt, 6 / zoom);
      const topLayer = topPageLayerAt(pageMarkups.filter((markup) => markup.type === 'stamp'), pageObjects, pt, (markup) => hitMarkup(markup, pt, 6 / zoom));
      const foundMarkup = annotationHit ?? (topLayer?.kind === 'markup' ? topLayer.value : null);
      const hitObject = annotationHit ? null : topLayer?.kind === 'page-object' ? topLayer.value : null;
      if (foundMarkup || hitObject) {
        const additive = additiveSelection(e);
        const alreadySelected = foundMarkup ? isSelectedMarkup(foundMarkup.id) : isSelectedPageObject(hitObject!.id);
        if (additive) {
          if (foundMarkup) selectMarkup(foundMarkup.id, true);
          else selectPageObject(hitObject!.id, true);
          return;
        }
        if (!alreadySelected) {
          if (foundMarkup) selectMarkup(foundMarkup.id, false);
          else selectPageObject(hitObject!.id, false);
        }
        const selectedMarkupIds = alreadySelected ? p.selectedMarkupIds : foundMarkup ? [foundMarkup.id] : [];
        const selectedObjectIds = alreadySelected ? p.selectedPageObjectIds : hitObject ? [hitObject.id] : [];
        const expanded = expandGroupedSelection(doc.markups, doc.pageObjects, doc.page, selectedMarkupIds, selectedObjectIds);
        const groupMarkupIds = expanded.markupIds;
        const groupCalloutIds = alreadySelected ? p.selectedCalloutIds : [];
        const groupObjectIds = expanded.pageObjectIds;
        const markups = doc.markups.filter((markup) => groupMarkupIds.includes(markup.id));
        const callouts = doc.markups.filter((markup) => groupCalloutIds.includes(markup.id));
        const objects = doc.pageObjects.filter((object) => groupObjectIds.includes(object.id));
        if (markups.length + callouts.length + objects.length > 1) {
          drag.current = { kind: 'selection-move', start: pt, markups, callouts, pageObjects: objects, began: false };
        } else if (foundMarkup) {
          drag.current = { kind: 'move', start: pt, orig: foundMarkup, began: false };
        } else {
          drag.current = { kind: 'page-object-move', start: pt, orig: hitObject! };
        }
        return;
      }
      drag.current = { kind: 'selection-window', start: pt, additive: additiveSelection(e) };
      setSelectionWindow(normalizedRect(pt, pt));
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
      if (tool === 'image') {
        p.onAddImage(doc.page, pt);
        return;
      }
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
    const pt = snapAt(toPt(e));
    if (draftRef.current) setCur(pt);
    if (!dg) return;
    if (dg.kind === 'selection-window') {
      setSelectionWindow(normalizedRect(dg.start, pt));
      return;
    }
    if (dg.kind === 'move') {
      const dx = pt.x - dg.start.x,
        dy = pt.y - dg.start.y;
      if (!dg.began) {
        if (Math.hypot(dx, dy) * zoom < 3) return;
        dg.began = true;
        p.onBeginEdit();
      }
      p.onLive(doc.markups.map((m) => (m.id === dg.orig.id ? translate(dg.orig, dx, dy) : m)));
    } else if (dg.kind === 'page-object-move') {
      const dx = pt.x - dg.start.x;
      const dy = pt.y - dg.start.y;
      p.onPageObjectsChange(doc.pageObjects.map((object) => object.id === dg.orig.id
        ? { ...dg.orig, x: dg.orig.x + dx, y: dg.orig.y + dy }
        : object));
    } else if (dg.kind === 'page-object-resize') {
      p.onPageObjectsChange(doc.pageObjects.map((object) => object.id === dg.orig.id
        ? resizePageObject(dg.orig, pt.x - dg.start.x, pt.y - dg.start.y)
        : object));
    } else if (dg.kind === 'selection-move') {
      const dx = pt.x - dg.start.x;
      const dy = pt.y - dg.start.y;
      if (!dg.began) {
        if (Math.hypot(dx, dy) * zoom < 3) return;
        dg.began = true;
        if (dg.markups.length || dg.callouts.length) p.onBeginEdit();
      }
      const markupOffsets = new Map(dg.markups.map((markup) => [markup.id, markup]));
      const calloutOffsets = new Map(dg.callouts.map((markup) => [markup.id, markup]));
      const objectOffsets = new Map(dg.pageObjects.map((object) => [object.id, object]));
      if (markupOffsets.size || calloutOffsets.size) p.onLive(doc.markups.map((markup) => {
        const original = markupOffsets.get(markup.id);
        if (original) return translate(original, dx, dy);
        const callout = calloutOffsets.get(markup.id);
        const layout = callout && calloutLayout(callout);
        return layout ? moveCallout(markup, { x: layout.x + dx, y: layout.y + dy }) : markup;
      }));
      if (objectOffsets.size) p.onPageObjectsChange(doc.pageObjects.map((object) => {
        const original = objectOffsets.get(object.id);
        return original ? { ...original, x: original.x + dx, y: original.y + dy } : object;
      }));
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
    if (dg?.kind === 'selection-window') {
      const end = toPt(e);
      setSelectionWindow(null);
      if (dist(dg.start, end) * zoom < 3) {
        if (!dg.additive) p.onSelectionChange([], [], []);
        return;
      }
      const pageMarkups = doc.markups.filter((markup) => markup.page === doc.page && (!doc.shared || ownsMarkup(markup, p.user)));
      const pageObjects = doc.pageObjects.filter((object) => object.page === doc.page);
      const found = selectInWindow(pageMarkups, pageObjects, normalizedRect(dg.start, end));
      const markupIds = dg.additive ? new Set([...p.selectedMarkupIds, ...found.markupIds]) : new Set(found.markupIds);
      const pageObjectIds = dg.additive ? new Set([...p.selectedPageObjectIds, ...found.pageObjectIds]) : new Set(found.pageObjectIds);
      const calloutIds = dg.additive ? new Set([...p.selectedCalloutIds, ...found.calloutIds]) : new Set(found.calloutIds);
      const expanded = expandGroupedSelection(doc.markups, doc.pageObjects, doc.page, [...markupIds], [...pageObjectIds]);
      p.onSelectionChange(expanded.markupIds, expanded.pageObjectIds, [...calloutIds]);
      return;
    }
    if (!dg) return;
    if (dg.kind === 'two' && dg.moved && draftRef.current) finishTwo(draftRef.current[0], snapAt(toPt(e)));
    else if (dg.kind === 'pen' && draftRef.current) {
      const pts = simplify(draftRef.current, 0.8);
      setDraft(null);
      if (pts.length >= 2) p.onCreate(makeMarkup('pen', doc.page, pts, style, p.author));
    }
  };

  const onDouble = (event: React.MouseEvent<HTMLDivElement>) => {
    if (tool === 'select') {
      const point = toPt(event);
      const markup = [...doc.markups].reverse().find((item) => item.page === doc.page && hitCallout(item, point));
      if (markup) {
        p.onEditComments(markup.id);
        return;
      }
    }
    if (p.selectedPageObjectIds.length === 1) {
      const object = doc.pageObjects.find((item) => item.id === p.selectedPageObjectIds[0] && item.page === doc.page);
      if (object?.kind === 'text') p.onEditPageObject(object.id);
      return;
    }
    const d = draftRef.current;
    if (d && MULTI.includes(tool) && d.length >= 2) finish(d.slice(0, -1));
  };

  const countNos = useMemo(() => countNumbers(doc.markups), [doc.markups]);

  const tags = useMemo(() => numberMarkups(doc.markups), [doc.markups]);
  const cal = doc.calibrations[doc.page] ?? DEFAULT_CAL;
  const pageMarkups = doc.markups.filter((m) => m.page === doc.page);
  const pageObjects = doc.pageObjects.filter((object) => object.page === doc.page);
  const layers = orderedPageLayers(pageMarkups.filter((markup) => markup.type === 'stamp'), pageObjects);
  const selectedPageObject = p.selectedPageObjectIds.length === 1
    ? pageObjects.find((object) => object.id === p.selectedPageObjectIds[0])
    : undefined;
  const symbolGlyph = (symbol?: PageObject['symbol']) => ({
    check: '✓', x: '×', star: '★', circle: '●', 'open-circle': '○', plus: '+', minus: '−', question: '?', exclamation: '!',
  }[symbol ?? 'check']);

  let preview: Markup | null = null;
  if (draft && cur) {
    const type = (tool === 'calibrate' ? 'line' : tool) as MarkupType;
    const pts = TWO_POINT.includes(tool) ? [draft[0], cur] : MULTI.includes(tool) ? [...draft, cur] : draft;
    if (pts.length >= (tool === 'cloud' ? 3 : 2) && type !== ('select' as string))
      preview = makeMarkup(tool === 'calibrate' ? 'line' : type, doc.page, pts, tool === 'calibrate' ? { ...style, color: '#ff6d00', width: 2 } : style, p.author);
    if (preview && tool === 'callout') preview.points = [...pts, { x: pts[0].x - 40, y: pts[1].y + 40 }];
  } else if (draft && tool === 'pen' && draft.length >= 2) {
    preview = makeMarkup('pen', doc.page, draft, style, p.author);
  }

  const cursor =
    p.contentTool ? 'crosshair' : tool === 'hand' ? 'grab' : tool === 'select' ? 'default' : 'crosshair';
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
            {layers.map((layer) => layer.kind === 'markup'
              ? <MarkupShape key={layer.value.id} m={layer.value} cal={cal} countNo={countNos.get(layer.value.id)} tag={tags.get(layer.value.id)} />
              : layer.value.kind === 'signature' && layer.value.signature
                ? <image key={layer.value.id} href={layer.value.signature.data} x={layer.value.x} y={layer.value.y} width={layer.value.width} height={layer.value.height} preserveAspectRatio="none" />
                : layer.value.kind === 'symbol'
                  ? <text key={layer.value.id} x={layer.value.x + layer.value.width / 2} y={layer.value.y + layer.value.height * .82} textAnchor="middle" fontSize={layer.value.height} fill={layer.value.color}>{symbolGlyph(layer.value.symbol)}</text>
                  : <text key={layer.value.id} x={layer.value.x} y={layer.value.y + layer.value.fontSize} fontSize={layer.value.fontSize} fill={layer.value.color} fontFamily="Helvetica, Arial, sans-serif">
                    {(layer.value.text ?? '').split(/\r?\n/).map((line, index) => <tspan key={index} x={layer.value.x} dy={index === 0 ? 0 : layer.value.fontSize * 1.2}>{line}</tspan>)}
                  </text>
            )}
            {pageMarkups.filter((markup) => markup.type !== 'stamp').map((markup) => (
              <MarkupShape key={markup.id} m={markup} cal={cal} countNo={countNos.get(markup.id)} tag={tags.get(markup.id)} />
            ))}
            {preview && (
              <g opacity={0.85}>
                <MarkupShape m={preview} cal={cal} />
              </g>
            )}
            {snapTarget && SNAP_TOOLS.includes(tool) && (
              <g aria-hidden="true" pointerEvents="none" stroke="#1565c0" strokeWidth={1.5 / zoom}>
                {snapTarget.kind === 'intersection' ? (
                  <>
                    <path d={`M${snapTarget.point.x - 6 / zoom} ${snapTarget.point.y} L${snapTarget.point.x + 6 / zoom} ${snapTarget.point.y} M${snapTarget.point.x} ${snapTarget.point.y - 6 / zoom} L${snapTarget.point.x} ${snapTarget.point.y + 6 / zoom}`} />
                    <circle cx={snapTarget.point.x} cy={snapTarget.point.y} r={3 / zoom} fill="#fff" />
                  </>
                ) : <circle cx={snapTarget.point.x} cy={snapTarget.point.y} r={4 / zoom} fill="#fff" />}
              </g>
            )}
            {pageMarkups.filter((markup) => p.selectedMarkupIds.includes(markup.id)).map((markup) => {
              return <g key={`selection-${markup.id}`}>
                <SelectionBox m={markup} zoom={zoom} />
              </g>;
            })}
            {pageMarkups.filter((markup) => p.selectedCalloutIds.includes(markup.id)).map((markup) => {
              const callout = calloutLayout(markup);
              return callout && <rect key={`callout-selection-${markup.id}`} x={callout.x - hsz} y={callout.y - hsz}
                width={callout.w + hsz * 2} height={callout.h + hsz * 2} fill="none" stroke="#1976d2"
                strokeWidth={1.5 / zoom} strokeDasharray={`${4 / zoom} ${3 / zoom}`} />;
            })}
            {pageObjects.filter((object) => p.selectedPageObjectIds.includes(object.id)).map((object) => (
              <g key={`selection-${object.id}`}>
                <rect x={object.x} y={object.y} width={object.width} height={object.height}
                  fill="none" stroke="#1976d2" strokeWidth={1.5 / zoom} strokeDasharray={`${4 / zoom} ${3 / zoom}`} />
                {selectedPageObject?.id === object.id && <rect x={object.x + object.width - hsz} y={object.y + object.height - hsz}
                  width={hsz * 2} height={hsz * 2} fill="#fff" stroke="#1976d2" strokeWidth={1.5 / zoom} />}
              </g>
            ))}
            {selectionWindow && <rect x={selectionWindow.x} y={selectionWindow.y} width={selectionWindow.w} height={selectionWindow.h}
              fill="#2563eb22" stroke="#2563eb" strokeWidth={1 / zoom} strokeDasharray={`${4 / zoom} ${3 / zoom}`} />}
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
              if (d && MULTI.includes(tool)) {
                finish(d);
                return;
              }
              const calloutHit = [...doc.markups].reverse().find((m) => m.page === doc.page && hitCallout(m, point));
              const candidates = doc.shared ? doc.markups.filter((m) => ownsMarkup(m, p.user)) : doc.markups;
              const pageMarkups = candidates.filter((markup) => markup.page === doc.page);
              const pageObjects = doc.pageObjects.filter((object) => object.page === doc.page);
              const annotationHit = pickTop(pageMarkups.filter((markup) => markup.type !== 'stamp'), doc.page, point, 6 / zoom);
              const topLayer = calloutHit || annotationHit ? null : topPageLayerAt(pageMarkups.filter((markup) => markup.type === 'stamp'), pageObjects, point, (markup) => hitMarkup(markup, point, 6 / zoom));
              const selectable = annotationHit ?? (topLayer?.kind === 'markup' ? topLayer.value : null);
              const selectedObject = topLayer?.kind === 'page-object' ? topLayer.value : null;
              if (calloutHit && !p.selectedCalloutIds.includes(calloutHit.id)) p.onSelectionChange([], [], [calloutHit.id]);
              else if (selectable && !p.selectedMarkupIds.includes(selectable.id)) p.onSelectionChange([selectable.id], [], []);
              else if (selectedObject && !p.selectedPageObjectIds.includes(selectedObject.id)) p.onSelectionChange([], [selectedObject.id], []);
              p.onContextMenu(e, calloutHit?.id ?? selectable?.id ?? null, selectedObject?.id ?? null, point, !!calloutHit);
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
