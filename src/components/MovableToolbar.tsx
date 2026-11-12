import { useEffect, useRef, useState } from 'react';
import type { PointerEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';

type Position = { x: number; y: number };
export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
type Edge = 'top' | 'right' | 'bottom' | 'left';
export type SavedToolbarState = { visible: boolean; locked: boolean; position: Position | null; width: number | null; height: number | null; edge: Edge | null; corner: Corner | null };
type BoundsRef = { current: HTMLDivElement | null };
export type ToolbarOrientation = 'horizontal' | 'icons';
export type ToolbarLayout = { id: string; edge: Edge | null; corner: Corner | null; position: Position; width: number; height: number; visible: boolean; moved: boolean };
export type ToolbarReservations = { top: number; bottom: number; left: number; right: number };
export type ToolbarDockPreview = { position: Position; corner: Corner | null; edge: Edge | null };

const storageKey = (id: string) => `thryvopdf-toolbar-group-${id}-v1`;
const toolbarSnapGap = 4;

export function toolbarSavedDimensions(
  state: Pick<SavedToolbarState, 'width' | 'height'>,
  docked: boolean,
): Pick<SavedToolbarState, 'width' | 'height'> {
  return docked ? { width: null, height: null } : state;
}

export function toolbarOrientationForTarget(
  target: Pick<ToolbarDockPreview, 'edge' | 'corner'> | null,
): ToolbarOrientation {
  if (target?.edge === 'left' || target?.edge === 'right') return 'icons';
  if (target?.edge === 'top' || target?.edge === 'bottom') return 'horizontal';
  if (target?.corner) return target.corner.endsWith('right') ? 'icons' : 'horizontal';
  return 'horizontal';
}

export function toolbarOrientation(
  preview: ToolbarDockPreview | null,
  state: { edge: Edge | null; corner: Corner | null; height: number | null },
  dragging: boolean,
): ToolbarOrientation {
  if (preview) return toolbarOrientationForTarget(preview);
  const savedOrientation = toolbarOrientationForTarget(state);
  if (savedOrientation !== 'horizontal') return savedOrientation;
  return !dragging && !state.edge && !state.corner && state.height !== null && state.height > 72
    ? 'icons'
    : 'horizontal';
}

export function toolbarUsesIconMode(
  preview: ToolbarDockPreview | null,
  state: { edge: Edge | null; corner: Corner | null; height: number | null },
  dragging: boolean,
): boolean {
  return toolbarOrientation(preview, state, dragging) === 'icons';
}

export function loadToolbarState(id: string, storage: Pick<Storage, 'getItem'> = localStorage): SavedToolbarState {
  try {
    const raw: unknown = JSON.parse(storage.getItem(storageKey(id)) || 'null');
    if (raw && typeof raw === 'object' && 'visible' in raw && typeof raw.visible === 'boolean') {
      const position = 'position' in raw && raw.position && typeof raw.position === 'object' &&
        'x' in raw.position && 'y' in raw.position &&
        typeof raw.position.x === 'number' && typeof raw.position.y === 'number' &&
        Number.isFinite(raw.position.x) && Number.isFinite(raw.position.y) &&
        raw.position.x >= 0 && raw.position.y >= 0
        ? { x: raw.position.x, y: raw.position.y }
        : null;
      const width = 'width' in raw && typeof raw.width === 'number' && Number.isFinite(raw.width) && raw.width >= 60
        ? raw.width
        : null;
      const height = 'height' in raw && typeof raw.height === 'number' && Number.isFinite(raw.height) && raw.height >= 32
        ? raw.height
        : null;
      const corners: Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
      const corner = 'corner' in raw && typeof raw.corner === 'string' && corners.includes(raw.corner as Corner)
        ? raw.corner as Corner
        : null;
      const edges: Edge[] = ['top', 'right', 'bottom', 'left'];
      const edge = 'edge' in raw && typeof raw.edge === 'string' && edges.includes(raw.edge as Edge)
        ? raw.edge as Edge
        : null;
      return { visible: raw.visible, locked: 'locked' in raw && raw.locked === true, position, width, height, edge, corner };
    }
  } catch { /* use the default toolbar layout */ }
  return { visible: true, locked: false, position: null, width: null, height: null, edge: null, corner: null };
}

export function saveToolbarState(id: string, state: SavedToolbarState, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try { storage.setItem(storageKey(id), JSON.stringify(state)); } catch { /* preference is session-only when storage is unavailable */ }
}

export function toolbarDockReservations(layouts: ToolbarLayout[], appWidth: number, appHeight: number, topBaseHeight: number): ToolbarReservations {
  const reservations: ToolbarReservations = { top: 0, bottom: 0, left: 0, right: 0 };
  for (const layout of layouts.filter((item) => item.visible && (item.moved || item.edge || item.corner))) {
    const right = layout.position.x + layout.width;
    const bottom = layout.position.y + layout.height;
    let edge = layout.edge ?? (layout.corner
      ? layout.corner.startsWith('top') ? 'top' : 'bottom'
      : null);
    if (!edge) {
      const nearest = [
        { side: 'left' as const, distance: layout.position.x },
        { side: 'right' as const, distance: appWidth - right },
        { side: 'top' as const, distance: layout.position.y },
        { side: 'bottom' as const, distance: appHeight - bottom },
      ].sort((a, b) => a.distance - b.distance)[0];
      if (nearest.distance > 32) continue;
      edge = nearest.side;
    }

    if (edge === 'left') reservations.left = Math.max(reservations.left, layout.width);
    else if (edge === 'right') reservations.right = Math.max(reservations.right, layout.width);
    else if (edge === 'top') reservations.top = Math.max(reservations.top, Math.max(0, bottom - topBaseHeight));
    else reservations.bottom = Math.max(reservations.bottom, layout.height);
  }
  return reservations;
}

function toolbarPositionBeside(target: ToolbarLayout, side: Edge, width: number, height: number): Position {
  if (side === 'left') return { x: target.position.x - width - toolbarSnapGap, y: target.position.y + (target.height - height) / 2 };
  if (side === 'right') return { x: target.position.x + target.width + toolbarSnapGap, y: target.position.y + (target.height - height) / 2 };
  if (side === 'top') return { x: target.position.x + (target.width - width) / 2, y: target.position.y - height - toolbarSnapGap };
  return { x: target.position.x + (target.width - width) / 2, y: target.position.y + target.height + toolbarSnapGap };
}

function dockAreaForSnap(target: ToolbarLayout, side: Edge): Edge | null {
  if (target.edge) {
    const sideIsHorizontal = side === 'left' || side === 'right';
    const edgeIsHorizontal = target.edge === 'top' || target.edge === 'bottom';
    return sideIsHorizontal === edgeIsHorizontal ? target.edge : null;
  }
  if (!target.corner) return null;
  if (side === 'left' || side === 'right') return target.corner.startsWith('top') ? 'top' : 'bottom';
  return target.corner.endsWith('right') ? 'right' : 'left';
}

function overlapsToolbar(position: Position, width: number, height: number, target: ToolbarLayout): boolean {
  return position.x < target.position.x + target.width &&
    position.x + width > target.position.x &&
    position.y < target.position.y + target.height &&
    position.y + height > target.position.y;
}

export function snapToToolbar(position: Position, width: number, height: number, layouts: ToolbarLayout[], selfId: string, maxX = Infinity, maxY = Infinity): { position: Position; edge: Edge | null } | null {
  const targets = layouts.filter((target) => target.visible && target.id !== selfId);
  const overlappingTargets = targets.filter((target) => overlapsToolbar(position, width, height, target));
  const consideredTargets = overlappingTargets.length ? overlappingTargets : targets;
  const candidates: { distance: number; position: Position; edge: Edge | null }[] = [];
  for (const target of consideredTargets) {
    for (const side of ['left', 'right', 'top', 'bottom'] as const) {
      const candidate = toolbarPositionBeside(target, side, width, height);
      const edge = dockAreaForSnap(target, side);
      if (edge === 'left') candidate.x = 0;
      else if (edge === 'right') candidate.x = maxX;
      else if (edge === 'top') candidate.y = 0;
      else if (edge === 'bottom') candidate.y = maxY;
      if (candidate.x < 0 || candidate.y < 0 || candidate.x > maxX || candidate.y > maxY) continue;
      if (targets.some((other) => other.id !== target.id && overlapsToolbar(candidate, width, height, other))) continue;
      if (overlapsToolbar(candidate, width, height, target)) continue;
      const dx = candidate.x - position.x;
      const dy = candidate.y - position.y;
      const distance = Math.hypot(dx, dy);
      if (overlappingTargets.length || distance <= 30) {
        candidates.push({ distance, position: candidate, edge });
      }
    }
  }
  const nearest = candidates.sort((a, b) => a.distance - b.distance)[0];
  return nearest ? { position: nearest.position, edge: nearest.edge } : null;
}

function cornerForPosition(position: Position, maxX: number, maxY: number): Corner | null {
  if (position.x === 0 && position.y === 0) return 'top-left';
  if (position.x === maxX && position.y === 0) return 'top-right';
  if (position.x === 0 && position.y === maxY) return 'bottom-left';
  if (position.x === maxX && position.y === maxY) return 'bottom-right';
  return null;
}

function edgeForPosition(position: Position, maxX: number, maxY: number): Edge | null {
  const edges: { edge: Edge; distance: number }[] = [
    { edge: 'left', distance: position.x },
    { edge: 'right', distance: maxX - position.x },
    { edge: 'top', distance: position.y },
    { edge: 'bottom', distance: maxY - position.y },
  ];
  const nearest = edges.sort((a, b) => a.distance - b.distance)[0];
  return nearest.distance <= 28 ? nearest.edge : null;
}

export function snapDockPosition(position: Position, maxX: number, maxY: number): Position | null {
  const cornerTargets = [
    { x: 0, y: 0 }, { x: maxX, y: 0 },
    { x: 0, y: maxY }, { x: maxX, y: maxY },
  ];
  const nearestCorner = cornerTargets.reduce((best, target) =>
    Math.hypot(target.x - position.x, target.y - position.y) < Math.hypot(best.x - position.x, best.y - position.y)
      ? target
      : best,
  );
  if (Math.hypot(nearestCorner.x - position.x, nearestCorner.y - position.y) <= 32) return nearestCorner;

  const edgeTargets = [
    { position: { x: 0, y: position.y }, distance: position.x },
    { position: { x: maxX, y: position.y }, distance: maxX - position.x },
    { position: { x: position.x, y: 0 }, distance: position.y },
    { position: { x: position.x, y: maxY }, distance: maxY - position.y },
  ];
  const nearestEdge = edgeTargets.reduce((best, target) => target.distance < best.distance ? target : best);
  return nearestEdge.distance <= 28 ? nearestEdge.position : null;
}

export function toolbarDockPreview(position: Position, width: number, height: number, layouts: ToolbarLayout[], selfId: string, maxX: number, maxY: number): ToolbarDockPreview | null {
  const clamp = (target: Position): Position => ({
    x: Math.max(0, Math.min(maxX, target.x)),
    y: Math.max(0, Math.min(maxY, target.y)),
  });
  const toolbarSnap = snapToToolbar(position, width, height, layouts, selfId, maxX, maxY);
  if (toolbarSnap) return { position: clamp(toolbarSnap.position), corner: null, edge: toolbarSnap.edge };
  const edgeSnap = snapDockPosition(position, maxX, maxY);
  if (!edgeSnap) return null;
  const target = clamp(edgeSnap);
  const corner = cornerForPosition(target, maxX, maxY);
  return { position: target, corner, edge: corner ? null : edgeForPosition(target, maxX, maxY) };
}

export function repositionDockPreview(preview: ToolbarDockPreview, pointerPosition: Position, maxX: number, maxY: number): ToolbarDockPreview | null {
  const clamp = (position: Position): Position => ({
    x: Math.max(0, Math.min(maxX, position.x)),
    y: Math.max(0, Math.min(maxY, position.y)),
  });
  let position = clamp(pointerPosition);
  if (preview.edge === 'left') position.x = 0;
  else if (preview.edge === 'right') position.x = maxX;
  else if (preview.edge === 'top') position.y = 0;
  else if (preview.edge === 'bottom') position.y = maxY;
  else if (preview.corner) {
    position = {
      x: preview.corner.endsWith('right') ? maxX : 0,
      y: preview.corner.startsWith('bottom') ? maxY : 0,
    };
  }
  return { ...preview, position };
}

export function MovableToolbar({ id, label, children, boundsRef, layouts, onLayoutChange }: {
  id: string;
  label: string;
  children: ReactNode;
  boundsRef: BoundsRef;
  layouts: ToolbarLayout[];
  onLayoutChange(id: string, layout: ToolbarLayout | null): void;
}) {
  const [saved, setSaved] = useState(() => loadToolbarState(id));
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [dockPreview, setDockPreview] = useState<ToolbarDockPreview | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const measuredWidth = useRef<number | null>(null);
  const measuredHeight = useRef<number | null>(null);
  const drag = useRef<{ pointerId: number; offsetX: number; offsetY: number; pointerX: number; pointerY: number; position: Position } | null>(null);
  const orientation = toolbarOrientation(dockPreview, saved, drag.current !== null);
  const sideDocked = orientation === 'icons';
  const docked = saved.edge !== null || saved.corner !== null;
  const displayDimensions = toolbarSavedDimensions(saved, docked);
  const autoOrientationRef = useRef(orientation !== 'horizontal');
  autoOrientationRef.current = orientation !== 'horizontal';
  const iconOnly = toolbarUsesIconMode(dockPreview, saved, drag.current !== null);

  useEffect(() => {
    onLayoutChange(id, {
      id,
      edge: saved.edge,
      corner: saved.corner,
      position: toolbarRef.current && boundsRef.current
        ? {
          x: Math.round(toolbarRef.current.getBoundingClientRect().left - boundsRef.current.getBoundingClientRect().left),
          y: Math.round(toolbarRef.current.getBoundingClientRect().top - boundsRef.current.getBoundingClientRect().top),
        }
        : saved.position ?? { x: 0, y: 0 },
      width: size.width,
      height: size.height,
      visible: saved.visible,
      moved: saved.position !== null,
    });
  }, [id, onLayoutChange, saved.corner, saved.edge, saved.position, saved.visible, size.height, size.width]);

  useEffect(() => () => onLayoutChange(id, null), [id, onLayoutChange]);

  useEffect(() => {
    saveToolbarState(id, saved);
  }, [id, saved]);

  useEffect(() => {
    const toolbar = toolbarRef.current;
    const bounds = boundsRef.current;
    if (!toolbar || !bounds) return;
    const updateSize = () => {
      const width = toolbar.offsetWidth;
      const height = toolbar.offsetHeight;
      const previousWidth = measuredWidth.current;
      const previousHeight = measuredHeight.current;
      measuredWidth.current = width;
      measuredHeight.current = height;
      setSize({ width, height });
      setSaved((current) => {
        const maxX = Math.max(0, bounds.clientWidth - width);
        const maxY = Math.max(0, bounds.clientHeight - height);
        const inferredCorner = current.corner ?? (!current.edge && current.position
          ? cornerForPosition(snapDockPosition(current.position, maxX, maxY) ?? current.position, maxX, maxY)
          : null);
        const nextPosition = current.position && inferredCorner
          ? {
            x: inferredCorner.endsWith('right') ? maxX : 0,
            y: inferredCorner.startsWith('bottom') ? maxY : 0,
          }
          : current.position && current.edge
            ? {
              x: current.edge === 'left' ? 0 : current.edge === 'right' ? maxX : Math.max(0, Math.min(maxX, current.position.x)),
              y: current.edge === 'top' ? 0 : current.edge === 'bottom' ? maxY : Math.max(0, Math.min(maxY, current.position.y)),
            }
          : current.position && {
            x: current.position.x + (previousWidth ?? current.width ?? width) >= bounds.clientWidth - 1
              ? maxX
              : Math.max(0, Math.min(maxX, current.position.x)),
            y: current.position.y + (previousHeight ?? current.height ?? height) >= bounds.clientHeight - 1
              ? maxY
              : Math.max(0, Math.min(maxY, current.position.y)),
          };
        const nextWidth = !autoOrientationRef.current && previousWidth !== null && previousWidth !== width
          ? width
          : current.width;
        const nextHeight = !autoOrientationRef.current && previousHeight !== null && previousHeight !== height
          ? height
          : current.height;
        if ((!nextPosition || (nextPosition.x === current.position?.x && nextPosition.y === current.position?.y)) &&
          nextWidth === current.width && nextHeight === current.height && inferredCorner === current.corner) return current;
        return { ...current, position: nextPosition ?? current.position, width: nextWidth, height: nextHeight, corner: inferredCorner };
      });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(toolbar);
    observer.observe(bounds);
    return () => observer.disconnect();
  }, [boundsRef, saved.visible]);

  useEffect(() => {
    const active = drag.current;
    const bounds = boundsRef.current;
    if (!active || !bounds || !dockPreview) return;
    const rect = bounds.getBoundingClientRect();
    const maxX = Math.max(0, bounds.clientWidth - size.width);
    const maxY = Math.max(0, bounds.clientHeight - size.height);
    const pointerPosition = clampPosition({
      x: active.pointerX - rect.left - active.offsetX,
      y: active.pointerY - rect.top - active.offsetY,
    });
    const adjustedPreview = repositionDockPreview(dockPreview, pointerPosition, maxX, maxY);
    if (!adjustedPreview) {
      setDockPreview(null);
      return;
    }
    const position = adjustedPreview.position;
    active.position = position;
    setSaved((current) => current.position?.x === position.x && current.position?.y === position.y
      ? current
      : { ...current, position });
    setDockPreview((current) => current?.position.x === adjustedPreview.position.x &&
      current?.position.y === adjustedPreview.position.y &&
      current?.edge === adjustedPreview.edge &&
      current?.corner === adjustedPreview.corner
      ? current
      : adjustedPreview);
  }, [boundsRef, dockPreview?.corner, dockPreview?.edge, size.height, size.width]);

  const clampPosition = (position: Position): Position => {
    const bounds = boundsRef.current;
    if (!bounds) return position;
    return {
      x: Math.max(0, Math.min(Math.max(0, bounds.clientWidth - size.width), position.x)),
      y: Math.max(0, Math.min(Math.max(0, bounds.clientHeight - size.height), position.y)),
    };
  };

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('.toolbar-group-close') ||
      saved.locked || !toolbarRef.current || !boundsRef.current) return;
    event.preventDefault();
    const rect = toolbarRef.current.getBoundingClientRect();
    const boundsRect = boundsRef.current.getBoundingClientRect();
    const position = { x: rect.left - boundsRect.left, y: rect.top - boundsRect.top };
    drag.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      pointerX: event.clientX,
      pointerY: event.clientY,
      position,
    };
    setDockPreview(null);
    setSaved((current) => ({
      ...current,
      position: current.position ?? position,
    }));
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    const bounds = boundsRef.current;
    if (saved.locked || !active || active.pointerId !== event.pointerId || !bounds) return;
    const rect = bounds.getBoundingClientRect();
    const position = clampPosition({
      x: event.clientX - rect.left - active.offsetX,
      y: event.clientY - rect.top - active.offsetY,
    });
    active.pointerX = event.clientX;
    active.pointerY = event.clientY;
    active.position = position;
    setDockPreview(toolbarDockPreview(
      position,
      size.width,
      size.height,
      layouts,
      id,
      Math.max(0, bounds.clientWidth - size.width),
      Math.max(0, bounds.clientHeight - size.height),
    ));
    setSaved((current) => ({ ...current, position, edge: null, corner: null }));
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (active?.pointerId !== event.pointerId) return;
    const position = active.position;
    drag.current = null;
    setDockPreview(null);
    if (saved.locked) return;
    const bounds = boundsRef.current;
    if (!bounds) return;
    const maxX = Math.max(0, bounds.clientWidth - size.width);
    const maxY = Math.max(0, bounds.clientHeight - size.height);
    const preview = toolbarDockPreview(position, size.width, size.height, layouts, id, maxX, maxY);
    if (preview) {
      setSaved((current) => ({
        ...current,
        position: preview.position,
        edge: preview.edge,
        corner: preview.corner,
      }));
    }
  };

  const resetDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === event.pointerId) {
      drag.current = null;
      setDockPreview(null);
    }
  };
  return (
    saved.visible ? (
      <>
      <div
        ref={toolbarRef}
        className={`toolbar-group${saved.position ? ' moved' : ''}${docked ? ' toolbar-group-docked' : ''}${iconOnly ? ' toolbar-group-icon-only' : ''}${sideDocked ? ' toolbar-group-side-docked' : ''}`}
        style={{
          ...(saved.position ? { left: saved.position.x, top: saved.position.y } : {}),
          ...(displayDimensions.width ? { width: displayDimensions.width } : {}),
          ...(displayDimensions.height ? { height: displayDimensions.height } : {}),
        }}
      >
        <div
          className={`toolbar-group-header${saved.locked ? ' locked' : ''}`}
          title={saved.locked ? 'Locked. Right-click header to unlock' : 'Hold and drag anywhere in the header to move; right-click to lock'}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={resetDrag}
          onContextMenu={(event) => {
            if ((event.target as HTMLElement).closest('.toolbar-group-close')) return;
            event.preventDefault();
            drag.current = null;
            setSaved((current) => ({ ...current, locked: !current.locked }));
          }}
        >
          <button
            className={`toolbar-group-drag${saved.locked ? ' locked' : ''}`}
            aria-label={`Move ${label} toolbar`}
            aria-disabled={saved.locked}
            title={saved.locked ? 'Locked. Right-click header to unlock' : 'Hold and drag anywhere in the header to move'}
          >{saved.locked ? '🔒' : '⠿'}</button>
          <span className="toolbar-group-title">{label}</span>
          <button
            className="toolbar-group-close"
            aria-label={`Close ${label} toolbar`}
            title={`Hide ${label} toolbar`}
            onClick={() => setSaved((current) => ({ ...current, visible: false }))}
          >×</button>
        </div>
        {children}
      </div>
      {dockPreview && boundsRef.current ? createPortal(
        <div
          className="toolbar-dock-preview"
          data-label={dockPreview.edge || dockPreview.corner ? 'Drop to dock' : 'Drop to snap'}
          data-label-position={dockPreview.position.y < 12 ? 'below' : 'above'}
          style={{
            left: dockPreview.position.x,
            top: dockPreview.position.y,
            width: size.width,
            height: size.height,
          }}
          aria-hidden="true"
        />,
        boundsRef.current,
      ) : null}
      </>
    ) : null
  );
}
