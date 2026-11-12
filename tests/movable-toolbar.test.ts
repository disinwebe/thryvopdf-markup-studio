import { describe, expect, it } from 'vitest';
import { directlyAttachedToolbarIds, loadToolbarState, repositionDockPreview, saveToolbarState, snapDockPosition, snapToToolbar, toolbarDockPreview, toolbarDockReservations, toolbarOrientation, toolbarOrientationForTarget, toolbarSavedDimensions, toolbarUsesIconMode } from '../src/components/MovableToolbar';

describe('movable toolbar docking', () => {
  it('restores visibility, lock, size, position, and dock attachments from persistent storage', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const state = {
      visible: false,
      locked: true,
      position: { x: 120, y: 64 },
      width: 420,
      height: 96,
      edge: null,
      corner: null,
      attachedTo: { id: 'file', side: 'right' as const },
    };

    saveToolbarState('content', state, storage);
    expect(loadToolbarState('content', storage)).toEqual(state);
    expect(loadToolbarState('markup', storage)).toMatchObject({
      visible: true,
      locked: false,
      position: null,
      width: null,
      height: null,
      edge: null,
      corner: null,
      attachedTo: null,
    });
  });

  it('uses natural dimensions when docked but preserves the saved floating size', () => {
    const savedSize = { width: 92, height: 240 };
    expect(toolbarSavedDimensions(savedSize, true)).toEqual({ width: null, height: null });
    expect(toolbarSavedDimensions(savedSize, false)).toEqual(savedSize);
  });

  it('snaps to each side while preserving the position along that side', () => {
    expect(snapDockPosition({ x: 8, y: 120 }, 800, 600)).toEqual({ x: 0, y: 120 });
    expect(snapDockPosition({ x: 792, y: 120 }, 800, 600)).toEqual({ x: 800, y: 120 });
    expect(snapDockPosition({ x: 120, y: 9 }, 800, 600)).toEqual({ x: 120, y: 0 });
    expect(snapDockPosition({ x: 120, y: 592 }, 800, 600)).toEqual({ x: 120, y: 600 });
  });

  it('prefers a nearby corner and leaves positions away from edges unchanged', () => {
    expect(snapDockPosition({ x: 4, y: 7 }, 800, 600)).toEqual({ x: 0, y: 0 });
    expect(snapDockPosition({ x: 400, y: 300 }, 800, 600)).toBeNull();
  });

  it('previews the same edge, corner, and toolbar targets used when dropping', () => {
    const target = {
      id: 'markup', edge: null, corner: null, attachedTo: null, position: { x: 0, y: 12 },
      width: 300, height: 40, visible: true, moved: false,
    };
    expect(toolbarDockPreview({ x: 4, y: 7 }, 200, 40, [], 'file', 800, 600)).toEqual({
      position: { x: 0, y: 0 }, attachedTo: null, corner: 'top-left', edge: null,
    });
    expect(toolbarDockPreview({ x: 8, y: 120 }, 200, 40, [], 'file', 800, 600)).toEqual({
      position: { x: 0, y: 120 }, attachedTo: null, corner: null, edge: 'left',
    });
    expect(toolbarDockPreview({ x: 792, y: 120 }, 200, 40, [], 'file', 800, 600)).toEqual({
      position: { x: 800, y: 120 }, attachedTo: null, corner: null, edge: 'right',
    });
    expect(toolbarDockPreview({ x: 303, y: 12 }, 260, 40, [target], 'measure', 800, 600)).toEqual({
      position: { x: 300, y: 12 }, attachedTo: { id: 'markup', side: 'right' }, corner: null, edge: null,
    });
    expect(toolbarDockPreview({ x: 400, y: 300 }, 200, 40, [], 'file', 800, 600)).toBeNull();
  });

  it('inherits dock orientation from the connected toolbar group', () => {
    expect(toolbarOrientationForTarget({ edge: 'left', corner: null, attachedTo: null })).toBe('icons');
    expect(toolbarOrientationForTarget({ edge: 'right', corner: null, attachedTo: null })).toBe('icons');
    expect(toolbarOrientationForTarget({ edge: 'top', corner: null, attachedTo: null })).toBe('horizontal');
    expect(toolbarOrientationForTarget({ edge: 'bottom', corner: null, attachedTo: null })).toBe('horizontal');
    expect(toolbarOrientationForTarget({ edge: null, corner: 'top-left', attachedTo: null })).toBe('horizontal');
    expect(toolbarOrientationForTarget({ edge: null, corner: 'bottom-left', attachedTo: null })).toBe('horizontal');
    expect(toolbarOrientationForTarget({ edge: null, corner: 'top-right', attachedTo: null })).toBe('icons');
    expect(toolbarOrientationForTarget({ edge: null, corner: 'bottom-right', attachedTo: null })).toBe('icons');
    expect(toolbarOrientationForTarget({ edge: null, corner: null, attachedTo: { id: 'target', side: 'top' } })).toBe('horizontal');
    expect(toolbarOrientationForTarget({ edge: null, corner: null, attachedTo: { id: 'target', side: 'bottom' } })).toBe('horizontal');
    expect(toolbarOrientationForTarget({ edge: null, corner: null, attachedTo: { id: 'target', side: 'left' } })).toBe('icons');

    const sideDockedTarget = {
      id: 'markup', edge: 'left' as const, corner: null, attachedTo: null,
      position: { x: 0, y: 120 }, width: 90, height: 300, visible: true, moved: true,
    };
    const topDockedTarget = {
      id: 'file', edge: 'top' as const, corner: null, attachedTo: null,
      position: { x: 0, y: 0 }, width: 700, height: 60, visible: true, moved: true,
    };
    expect(toolbarOrientationForTarget({
      edge: null, corner: null,
      attachedTo: { id: 'markup', side: 'bottom' },
    }, [sideDockedTarget])).toBe('icons');
    expect(toolbarOrientationForTarget({
      edge: null, corner: null,
      attachedTo: { id: 'file', side: 'right' },
    }, [topDockedTarget])).toBe('horizontal');
    const defaultTopToolbar = {
      id: 'default-file', edge: null, corner: null, attachedTo: null,
      position: { x: 0, y: 0 }, width: 940, height: 68, visible: true, moved: false,
    };
    const attachedToDefaultTop = {
      id: 'content', edge: null, corner: null, attachedTo: { id: 'default-file', side: 'right' as const },
      position: { x: 940, y: 0 }, width: 88, height: 240, visible: true, moved: true,
    };
    expect(toolbarOrientationForTarget(attachedToDefaultTop, [defaultTopToolbar, attachedToDefaultTop])).toBe('horizontal');

    const rightCornerTarget = {
      id: 'right-corner', edge: null, corner: 'top-right' as const, attachedTo: null,
      position: { x: 900, y: 0 }, width: 100, height: 60, visible: true, moved: true,
    };
    const attachedToRightCorner = {
      id: 'attached-right', edge: null, corner: null, attachedTo: { id: 'right-corner', side: 'bottom' as const },
      position: { x: 900, y: 60 }, width: 100, height: 80, visible: true, moved: true,
    };
    expect(toolbarOrientationForTarget(attachedToRightCorner, [rightCornerTarget, attachedToRightCorner])).toBe('icons');

    const rightEdgeTarget = {
      id: 'right-edge', edge: 'right' as const, corner: null, attachedTo: null,
      position: { x: 900, y: 60 }, width: 100, height: 80, visible: true, moved: true,
    };
    const attachedToRightEdge = {
      id: 'attached-edge', edge: null, corner: null, attachedTo: { id: 'right-edge', side: 'bottom' as const },
      position: { x: 900, y: 140 }, width: 100, height: 80, visible: true, moved: true,
    };
    expect(toolbarOrientationForTarget(attachedToRightEdge, [rightEdgeTarget, attachedToRightEdge])).toBe('icons');
  });

  it('uses horizontal buttons at top and bottom edges and corners', () => {
    const tallState = { edge: null, corner: null, attachedTo: null, height: 140 };
    const topPreview = { position: { x: 100, y: 0 }, edge: 'top' as const, corner: null, attachedTo: null };
    expect(toolbarUsesIconMode(topPreview, tallState, true)).toBe(false);
    const bottomPreview = { position: { x: 100, y: 500 }, edge: 'bottom' as const, corner: null, attachedTo: null };
    expect(toolbarUsesIconMode(bottomPreview, tallState, true)).toBe(false);
    expect(toolbarUsesIconMode({ position: { x: 0, y: 0 }, edge: null, corner: 'top-left', attachedTo: null }, tallState, true)).toBe(false);
    expect(toolbarUsesIconMode({ position: { x: 0, y: 0 }, edge: null, corner: 'bottom-left', attachedTo: null }, tallState, true)).toBe(false);
    expect(toolbarUsesIconMode({ position: { x: 100, y: 0 }, edge: null, corner: 'top-right', attachedTo: null }, tallState, true)).toBe(true);
    expect(toolbarUsesIconMode(null, { ...tallState, edge: 'top' }, false)).toBe(false);
    expect(toolbarOrientation(null, { ...tallState, edge: 'top' }, false)).toBe('horizontal');
  });

  it('only detaches immediate toolbar children when a toolbar is moved', () => {
    const layouts = [
      { id: 'parent', edge: null, corner: null, attachedTo: null, position: { x: 0, y: 0 }, width: 200, height: 40, visible: true, moved: true },
      { id: 'child', edge: null, corner: null, attachedTo: { id: 'parent', side: 'bottom' as const }, position: { x: 0, y: 40 }, width: 200, height: 40, visible: true, moved: true },
      { id: 'grandchild', edge: null, corner: null, attachedTo: { id: 'child', side: 'bottom' as const }, position: { x: 0, y: 80 }, width: 200, height: 40, visible: true, moved: true },
      { id: 'unrelated', edge: null, corner: null, attachedTo: null, position: { x: 300, y: 0 }, width: 200, height: 40, visible: true, moved: true },
    ];
    expect(directlyAttachedToolbarIds(layouts, 'parent')).toEqual(['child']);
  });

  it('reserves the largest visible corner toolbar on each app edge', () => {
    expect(toolbarDockReservations([
      { id: 'a', edge: null, corner: 'top-left', attachedTo: null, position: { x: 0, y: 0 }, width: 360, height: 44, visible: true, moved: true },
      { id: 'b', edge: null, corner: 'top-right', attachedTo: null, position: { x: 580, y: 0 }, width: 420, height: 52, visible: true, moved: true },
      { id: 'c', edge: null, corner: 'bottom-left', attachedTo: null, position: { x: 0, y: 752 }, width: 300, height: 48, visible: true, moved: true },
      { id: 'd', edge: null, corner: 'bottom-right', attachedTo: null, position: { x: 660, y: 744 }, width: 340, height: 56, visible: true, moved: true },
      { id: 'e', edge: null, corner: 'top-left', attachedTo: null, position: { x: 0, y: 0 }, width: 600, height: 70, visible: false, moved: true },
      { id: 'f', edge: null, corner: null, attachedTo: null, position: { x: 100, y: 100 }, width: 700, height: 80, visible: true, moved: true },
    ], 1000, 800, 8)).toEqual({ top: 44, bottom: 56, left: 0, right: 0 });
  });

  it('snaps a toolbar beside another toolbar and keeps attached groups in the reserved layout', () => {
    const target = {
      id: 'markup', edge: null, corner: null, attachedTo: null, position: { x: 0, y: 12 },
      width: 300, height: 40, visible: true, moved: false,
    };
    expect(snapToToolbar({ x: 303, y: 12 }, 260, 40, [target], 'measure')).toEqual({
      position: { x: 300, y: 12 },
      attachedTo: { id: 'markup', side: 'right' },
    });
    expect(toolbarDockReservations([
      target,
      {
        id: 'measure', edge: null, corner: null, attachedTo: { id: 'markup', side: 'right' },
        position: { x: 300, y: 12 }, width: 260, height: 40, visible: true, moved: true,
      },
    ], 1000, 800, 60)).toEqual({ top: 0, bottom: 0, left: 560, right: 0 });
    expect(toolbarDockReservations([
      { ...target, position: { x: 0, y: 760 }, corner: 'bottom-left' },
      {
        id: 'measure', edge: null, corner: null, attachedTo: { id: 'markup', side: 'right' },
        position: { x: 300, y: 760 }, width: 260, height: 40, visible: true, moved: true,
      },
    ], 1000, 800, 60)).toEqual({ top: 0, bottom: 40, left: 0, right: 0 });
  });

  it('moves an overlapping toolbar to its nearest clear side', () => {
    const target = {
      id: 'target', edge: null, corner: null, attachedTo: null, position: { x: 300, y: 200 },
      width: 100, height: 80, visible: true, moved: true,
    };
    expect(snapToToolbar({ x: 320, y: 220 }, 80, 60, [target], 'moving', 800, 600)).toEqual({
      position: { x: 310, y: 280 },
      attachedTo: { id: 'target', side: 'bottom' },
    });
    const blockedBottom = {
      id: 'blocker', edge: null, corner: null, attachedTo: null, position: { x: 250, y: 280 },
      width: 200, height: 60, visible: true, moved: true,
    };
    expect(snapToToolbar({ x: 320, y: 220 }, 80, 60, [target, blockedBottom], 'moving', 800, 600)?.attachedTo.side)
      .toBe('right');
  });

  it('keeps the selected edge stable while resizing a dock preview', () => {
    const rightPreview = { position: { x: 700, y: 300 }, edge: 'right' as const, corner: null, attachedTo: null };
    const resized = repositionDockPreview(rightPreview, { x: 800, y: 700 }, 92, 180, [], 908, 620);
    expect(resized).toEqual({ ...rightPreview, position: { x: 908, y: 620 } });
    expect(toolbarOrientationForTarget(resized)).toBe('icons');

    const topPreview = { position: { x: 300, y: 0 }, edge: 'top' as const, corner: null, attachedTo: null };
    const resizedTop = repositionDockPreview(topPreview, { x: 0, y: 0 }, 92, 180, [], 908, 620);
    expect(resizedTop).toEqual({ ...topPreview, position: { x: 0, y: 0 } });
    expect(toolbarOrientationForTarget(resizedTop)).toBe('horizontal');
  });

  it('reserves horizontal viewer space for side-docked toolbars', () => {
    const toolbar = {
      edge: 'left' as const, corner: null, attachedTo: null, position: { x: 0, y: 120 },
      width: 300, height: 50, visible: true, moved: true,
    };
    expect(toolbarDockReservations([{ ...toolbar, id: 'left' }], 1000, 800, 60))
      .toEqual({ top: 0, bottom: 0, left: 300, right: 0 });
    expect(toolbarDockReservations([
      { ...toolbar, id: 'right', edge: 'right' as const, position: { x: 700, y: 120 } },
    ], 1000, 800, 60)).toEqual({ top: 0, bottom: 0, left: 0, right: 300 });
  });

  it('reserves top and side space independently for an attached vertical toolbar', () => {
    expect(toolbarDockReservations([
    {
      id: 'file', edge: 'top', corner: null, attachedTo: null, position: { x: 0, y: 0 },
      width: 900, height: 60, visible: true, moved: true,
    },
    {
      id: 'markup', edge: null, corner: null, attachedTo: { id: 'file', side: 'bottom' },
      position: { x: 0, y: 60 }, width: 90, height: 300, visible: true, moved: true,
    },
    ], 1920, 1080, 60)).toEqual({ top: 0, bottom: 0, left: 90, right: 0 });
  });
});
