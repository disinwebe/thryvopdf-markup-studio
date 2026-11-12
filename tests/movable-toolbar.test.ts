import { describe, expect, it } from 'vitest';
import { snapDockPosition, snapToToolbar, toolbarDockReservations } from '../src/components/MovableToolbar';

describe('movable toolbar docking', () => {
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
