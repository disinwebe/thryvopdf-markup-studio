import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { requireAccess, sharedOperationRequiresLicense } = require('../electron/access.cjs');
const { menuTemplate } = require('../electron/menu.cjs');

describe('unlicensed viewer access', () => {
  const signedIn = { current: () => ({ email: 'reader@example.test' }) };
  const unlicensed = { status: () => ({ ok: false, error: 'License required' }) };

  it('allows authenticated viewing but rejects writes and unauthenticated access', () => {
    expect(() => requireAccess(signedIn, unlicensed)).not.toThrow();
    expect(() => requireAccess(signedIn, unlicensed, true)).toThrow('License required');
    expect(() => requireAccess({ current: () => null }, unlicensed)).toThrow('Not signed in');
    expect(() => requireAccess(signedIn, { status: () => ({ ok: true }) }, true)).not.toThrow();
  });

  it('allows only shared read and presence operations without a license', () => {
    for (const op of ['list', 'open', 'poll', 'leave']) expect(sharedOperationRequiresLicense(op)).toBe(false);
    for (const op of ['ops', 'upload', 'delete', 'meta', 'unknown']) expect(sharedOperationRequiresLicense(op)).toBe(true);
  });

  it('keeps opening, shared browsing and panel navigation available while disabling editing menus', () => {
    const menu = menuTemplate({ signedIn: true, licensed: false, documentOpen: true, viewerActive: true, serverMode: true, canUndo: true, selected: true }, vi.fn());
    const find = (label: string) => menu.flatMap((m: { submenu: { label?: string; enabled?: boolean }[] }) => m.submenu).find((item: { label?: string }) => item.label === label);
    for (const label of ['&Open PDF...', 'Open S&hared...', 'Toggle &left panel', 'Toggle &right panel']) expect(find(label)?.enabled).toBe(true);
    for (const label of ['&Save', 'Save &As...', '&Undo markup (Ctrl+Z)', '&Delete selected markup', 'Or&ganize pages...']) expect(find(label)?.enabled).toBe(false);
    const measurements = menu[3].submenu.find((item: { label?: string }) => item.label === '&Measurements');
    expect(measurements.enabled).toBe(false);
    expect(measurements.submenu.find((item: { label?: string }) => item.label === '&Area').enabled).toBe(false);
  });
});
