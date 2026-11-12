import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { requireAccess, requireSignIn, sharedOperationRequiresLicense } = require('../electron/access.cjs');
const { menuTemplate } = require('../electron/menu.cjs');

describe('unlicensed viewer access', () => {
  const signedIn = { current: () => ({ email: 'reader@example.test' }) };
  const unlicensed = { status: () => ({ ok: false, error: 'License required' }) };

  it('allows viewing and licensed local edits without a server account', () => {
    expect(() => requireAccess(signedIn, unlicensed)).not.toThrow();
    expect(() => requireAccess(signedIn, unlicensed, true)).toThrow('License required');
    const guest = { current: () => null };
    expect(() => requireAccess(guest, unlicensed)).not.toThrow();
    expect(() => requireAccess(guest, { status: () => ({ ok: true }) }, true)).not.toThrow();
  });

  it('requires a server account only for server-dependent APIs', () => {
    expect(() => requireSignIn(signedIn)).not.toThrow();
    expect(() => requireSignIn({ current: () => null })).toThrow('Sign in to the server');
  });

  it('allows only shared read and presence operations without a license', () => {
    for (const op of ['list', 'open', 'poll', 'leave']) expect(sharedOperationRequiresLicense(op)).toBe(false);
    for (const op of ['ops', 'upload', 'delete', 'meta', 'unknown']) expect(sharedOperationRequiresLicense(op)).toBe(true);
  });

  it('keeps opening, shared browsing and panel navigation available while disabling editing menus', () => {
    const menu = menuTemplate({ signedIn: true, licensed: false, documentOpen: true, viewerActive: true, serverMode: true, canUndo: true, selected: true }, vi.fn());
    const find = (label: string) => menu.flatMap((m: { submenu: { label?: string; enabled?: boolean }[] }) => m.submenu).find((item: { label?: string }) => item.label === label);
    for (const label of ['&Open PDF...', 'Open S&hared...', '&Search text in open PDFs...', 'Toggle &left panel', 'Toggle &right panel']) expect(find(label)?.enabled).toBe(true);
    for (const label of ['&Save', 'Save &As...', '&Undo markup (Ctrl+Z)', '&Delete selected markup', 'Or&ganize pages...']) expect(find(label)?.enabled).toBe(false);
    const measurements = menu[3].submenu.find((item: { label?: string }) => item.label === '&Measurements');
    expect(measurements.enabled).toBe(false);
    expect(measurements.submenu.find((item: { label?: string }) => item.label === '&Area').enabled).toBe(false);
  });

  it('keeps local menu actions usable before server sign-in', () => {
    const menu = menuTemplate({ signedIn: false, licensed: true, documentOpen: true, viewerActive: true, serverMode: false }, vi.fn());
    const find = (label: string) => menu.flatMap((m: { submenu: { label?: string; enabled?: boolean }[] }) => m.submenu).find((item: { label?: string }) => item.label === label);
    for (const label of ['&Open PDF...', '&Save', 'Open S&hared...', '&Search text in open PDFs...']) expect(find(label)?.enabled).toBe(true);
    expect(find('&Logout')?.enabled).toBe(false);
  });
});
