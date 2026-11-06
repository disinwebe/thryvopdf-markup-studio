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
    expect(csv).toContain('Comment ID,Page,Type,Filename,Status,Author,Date,Comments\r\n');
    expect(csv).toContain('1,1,Rectangle,test.pdf,None,Anne,2026-11-06 1:34 PM,"Anne: a, b"');
    expect(csv).toContain(',1,Line,test.pdf');
    expect(csv.split('\r\n')[0]).not.toMatch(/Text|Subject/);
    expect(formatMarkupDate(new Date(2026, 0, 1, 0, 5).toISOString())).toBe('2026-01-01 12:05 AM');
    expect(formatMarkupDate('invalid')).toBe('invalid');
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
});

describe('native menu wiring', () => {
  it('disables document and server actions when unavailable and sends selected actions', () => {
    const send = vi.fn();
    const menu = menuTemplate({ signedIn: true, documentOpen: true, selected: true, canUndo: true, serverMode: true }, send, 'win32');
    expect(menu.map((m: { label: string }) => m.label)).toEqual(['File', 'Edit', 'Help']);
    const file = menu[0].submenu;
    expect(file.find((m: { label: string }) => m.label === 'Save').enabled).toBe(true);
    file.find((m: { label: string }) => m.label === 'Export markup CSV...').click();
    expect(send).toHaveBeenCalledWith('csv');
    const inactive = menuTemplate({ signedIn: true, blocked: true, documentOpen: true }, send, 'win32');
    expect(inactive[0].submenu.find((m: { label: string }) => m.label === 'Save').enabled).toBe(false);
    const loggedOut = menuTemplate({}, send, 'win32');
    expect(loggedOut[0].submenu.find((m: { label: string }) => m.label === 'Shared Documents...').enabled).toBe(false);
  });
});
