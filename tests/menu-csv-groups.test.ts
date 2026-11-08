import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { markupCsv, formatMarkupDate } from '../src/core/markupCsv';
import { loadCollapsedGroups, saveCollapsedGroups } from '../src/app/groupCollapse';
import type { Markup } from '../src/core/types';

const require = createRequire(import.meta.url);
const { menuTemplate } = require('../electron/menu.cjs');

describe('markup CSV', () => {
  it('uses the visible number, real filename, local 12-hour date, and quotes data', () => {
    const date = new Date(2026, 10, 6, 13, 34).toISOString();
    const m = { id: 'm', type: 'rect', page: 0, date, status: 'None', author: 'Anne', comments: [{ author: 'Anne', text: 'a, b' }] } as Markup;
    const line = { ...m, id: 'line', type: 'line' } as Markup;
    const csv = markupCsv([m, line], 'C:\\drawings\\test.pdf');
    expect(csv).toContain('Comment ID,Page,Type,Filename,Author,Date,Comments,Status\r\n');
    expect(csv).toContain('1,1,Rectangle,test.pdf,Anne,2026-11-06 1:34 PM,"a, b",None');
    expect(csv).toContain(',1,Line,test.pdf');
    expect(csv.split('\r\n')[0]).not.toMatch(/Text|Subject/);
    expect(formatMarkupDate(new Date(2026, 0, 1, 0, 5).toISOString())).toBe('2026-01-01 12:05 AM');
    expect(formatMarkupDate('invalid')).toBe('invalid');
    expect(markupCsv([{ ...m, calloutHidden: true }], 'test.pdf')).toContain('"a, b",None');
  });
});

describe('collapsed groups', () => {
  it('persists independent group names and handles corrupt storage', () => {
    let value = '';
    const store = { getItem: () => value, setItem: (_key: string, v: string) => { value = v; } };
    saveCollapsedGroups(store, ['Tower A', '']);
    expect(loadCollapsedGroups(store)).toEqual(['Tower A', '']);
    value = 'bad';
    expect(loadCollapsedGroups(store)).toEqual([]);
  });
  it('keeps shared-library collapse state separate from the Project tab', () => {
    const data = new Map<string, string>();
    const store = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) };
    saveCollapsedGroups(store, ['Project']);
    saveCollapsedGroups(store, ['Library'], 'pms.sharedLibrary.collapsedGroups');
    expect(loadCollapsedGroups(store)).toEqual(['Project']);
    expect(loadCollapsedGroups(store, 'pms.sharedLibrary.collapsedGroups')).toEqual(['Library']);
  });
});

describe('native menu wiring', () => {
  it('disables document and server actions when unavailable and sends selected actions', () => {
    const send = vi.fn();
    const menu = menuTemplate({ signedIn: true, documentOpen: true, viewerActive: true, selected: true, canUndo: true, serverMode: true, admin: true, passwordAvailable: true }, send, 'win32');
    expect(menu.map((m: { label: string }) => m.label)).toEqual(['&File', '&Edit', '&Option', '&View', '&Help']);
    const file = menu[0].submenu;
    expect(file.find((m: { label: string }) => m.label === '&Save').enabled).toBe(true);
    file.find((m: { label: string }) => m.label === '&Export markup CSV...').click();
    expect(send).toHaveBeenCalledWith('csv');
    file.find((m: { label: string }) => m.label === '&Logout').click();
    expect(send).toHaveBeenCalledWith('logout');
    const option = menu[2].submenu;
    for (const [label, action] of [['&Users...', 'users'], ['&Password...', 'password'], ['&Theme: toggle light / dark', 'theme']]) {
      const entry = option.find((m: { label: string }) => m.label === label);
      expect(entry.enabled).toBe(true);
      entry.click();
      expect(send).toHaveBeenCalledWith(action);
    }
    const view = menu[3].submenu;
    expect(view.some((entry: { label?: string }) => /measurement|sheet index|search documents/i.test((entry.label || '').replace(/&/g, '')))).toBe(false);
    for (const action of ['toggleLeftPanel', 'toggleRightPanel']) {
      view.find((entry: { click?: () => void; label?: string }) => entry.label?.toLowerCase().includes(action === 'toggleLeftPanel' ? 'left panel' : 'right panel')).click();
      expect(send).toHaveBeenCalledWith(action);
    }
    for (const [label, action, accelerator] of [['Zoom &In', 'zoomIn', 'CmdOrCtrl+='], ['Zoom &Out', 'zoomOut', 'CmdOrCtrl+-'], ['Fit &Width', 'fitWidth', undefined], ['Fit &Page', 'fitPage', undefined]]) {
      const entry = view.find((m: { label: string }) => m.label === label);
      expect(entry.enabled).toBe(true);
      expect(entry.accelerator).toBe(accelerator);
      entry.click();
      expect(send).toHaveBeenCalledWith(action);
    }
    const help = menu[4].submenu;
    expect(help.some((entry: { label: string }) => entry.label.includes('Server'))).toBe(false);
    help.find((entry: { label: string }) => entry.label === '&License...').click();
    expect(send).toHaveBeenCalledWith('license');
    const inactive = menuTemplate({ signedIn: true, blocked: true, documentOpen: true }, send, 'win32');
    expect(inactive[0].submenu.find((m: { label: string }) => m.label === '&Save').enabled).toBe(false);
    expect(inactive[3].submenu[0].enabled).toBe(false);
    const loggedOut = menuTemplate({}, send, 'win32');
    expect(loggedOut[0].submenu.find((m: { label: string }) => m.label === 'S&hared Documents...').enabled).toBe(false);
    expect(loggedOut[2].submenu[0].visible).toBe(false);
    const compare = menuTemplate({ signedIn: true, documentOpen: true, viewerActive: false, admin: false }, send, 'win32');
    expect(compare[3].submenu[0].enabled).toBe(false);
    expect(compare[2].submenu[0].visible).toBe(false);
  });

  it('assigns unique Windows menu and item access keys', () => {
    const menu = menuTemplate({ signedIn: true, documentOpen: true, viewerActive: true, admin: true }, vi.fn(), 'win32');
    const key = (label: string) => /&([^&])/.exec(label)?.[1].toLowerCase();
    const topKeys = menu.map((m: { label: string }) => key(m.label));
    expect(topKeys).toEqual(['f', 'e', 'o', 'v', 'h']);
    for (const section of menu) {
      const keys = section.submenu.filter((m: { label?: string }) => m.label).map((m: { label: string }) => key(m.label));
      expect(keys).not.toContain(undefined);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});
