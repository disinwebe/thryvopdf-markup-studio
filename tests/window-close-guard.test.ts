import { describe, expect, it, vi } from 'vitest';

const { createWindowCloseGuard } = require('../electron/windowCloseGuard.cjs');

describe('window close guard', () => {
  it('waits for the renderer decision and allows cancellation or approved close', () => {
    const win = {
      isDestroyed: () => false,
      webContents: { send: vi.fn() },
      close: vi.fn(),
    };
    const guard = createWindowCloseGuard(win);
    const closeEvent = () => ({ preventDefault: vi.fn() });

    const beforeReady = closeEvent();
    guard.onClose(beforeReady);
    expect(beforeReady.preventDefault).not.toHaveBeenCalled();

    guard.markReady();
    const firstRequest = closeEvent();
    guard.onClose(firstRequest);
    guard.onClose(closeEvent());
    expect(firstRequest.preventDefault).toHaveBeenCalledOnce();
    expect(win.webContents.send).toHaveBeenCalledOnce();

    expect(guard.respond(false)).toBe(true);
    guard.onClose(closeEvent());
    expect(win.webContents.send).toHaveBeenCalledTimes(2);
    expect(guard.respond(true)).toBe(true);
    expect(win.close).toHaveBeenCalledOnce();

    const approvedClose = closeEvent();
    guard.onClose(approvedClose);
    expect(approvedClose.preventDefault).not.toHaveBeenCalled();
    expect(guard.respond(true)).toBe(false);
  });
});
