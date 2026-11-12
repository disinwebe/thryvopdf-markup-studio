import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { markupCsv, formatMarkupDate } from '../src/core/markupCsv';
import { loadCollapsedGroups, saveCollapsedGroups } from '../src/app/groupCollapse';
import { formatTakeoffDate, takeoffCsv } from '../src/core/measurement';
import type { Markup } from '../src/core/types';

const require = createRequire(import.meta.url);
const { menuTemplate } = require('../electron/menu.cjs');

describe('markup CSV', () => {
  it('uses the visible number, real filename, local 12-hour date, and quotes data', () => {
    const date = new Date(2026, 10, 6, 13, 34).toISOString();
    const m = { id: 'm', type: 'rect', page: 0, date, status: 'None', author: 'Anne', comments: [{ author: 'Anne', text: 'a, b' }] } as Markup;
    const line = { ...m, id: 'line', type: 'line' } as Markup;
    const measurement = { ...m, id: 'measure', type: 'm-length', subject: 'Wall' } as Markup;
    const csv = markupCsv([m, line, measurement], 'C:\\drawings\\test.pdf');
    expect(csv).toContain('Comment ID,Page,Type,Filename,Author,Date,Comments,Status\r\n');
    expect(csv).toContain('1,1,Rectangle,test.pdf,Anne,2026-11-06 1:34 PM,"a, b",None');
    expect(csv).toContain(',1,Line,test.pdf');
    expect(csv).not.toContain('Length');
    expect(csv).not.toContain('measure');
    expect(csv.split('\r\n')[0]).not.toMatch(/Text|Subject/);
    expect(formatMarkupDate(new Date(2026, 0, 1, 0, 5).toISOString())).toBe('2026-01-01 12:05 AM');
    expect(formatMarkupDate('invalid')).toBe('invalid');
    expect(markupCsv([{ ...m, calloutHidden: true }], 'test.pdf')).toContain('"a, b",None');
  });

  it('formats takeoff CSV dates as local M/D/YYYY HH:mm', () => {
    const date = new Date(2026, 10, 9, 20, 38).toISOString();
    expect(formatTakeoffDate(date)).toBe('11/9/2026 20:38');
    const measurement = {
      id: 'length', type: 'm-length', page: 0, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
      color: '#000000', width: 2, opacity: 1, status: 'None', author: 'Anne', date, comments: [],
    } as Markup;
    expect(takeoffCsv([measurement], () => ({ unit: 'ft', unitsPerPoint: 1, calibrated: true }))).toContain(`Anne,${formatTakeoffDate(date)}`);
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
  it('supplies semantic icons without changing menu actions or shortcuts', () => {
    const send = vi.fn();
    const icons = vi.fn((name: string) => `icon:${name}`);
    const menu = menuTemplate({ signedIn: true, documentOpen: true }, send, 'win32', icons);
    const file = menu[0].submenu;
    expect(file.find((m: { label: string }) => m.label === '&Open PDF...').icon).toBe('icon:open');
    expect(file.find((m: { label: string }) => m.label === '&Save').icon).toBe('icon:save');
    expect(file.find((m: { label: string }) => m.label === 'Save &As...').icon).toBe('icon:saveAs');
    file.find((m: { label: string }) => m.label === '&Save').click();
    expect(send).toHaveBeenCalledWith('save');
    expect(file.find((m: { label: string }) => m.label === '&Logout').icon).toBe('icon:key');
    expect(file.find((m: { label: string }) => m.label === '&Quit').icon).toBe('icon:exit');
    expect(file.find((m: { label: string }) => m.label === 'Open S&hared...').icon).toBe('icon:open');
    expect(icons).toHaveBeenCalledWith('license');
  });
  it('disables document and server actions when unavailable and sends selected actions', () => {
    const send = vi.fn();
    const menu = menuTemplate({ signedIn: true, documentOpen: true, viewerActive: true, selected: true, canGroupSelected: true, canUngroupSelected: true, canFlattenSelected: true, canUndo: true, serverMode: true, admin: true, passwordAvailable: true }, send, 'win32', (name: string) => `icon:${name}`);
    expect(menu.map((m: { label: string }) => m.label)).toEqual(['&File', '&Edit', '&Option', '&View', '&Help']);
    const file = menu[0].submenu;
    expect(file.find((m: { label: string }) => m.label === '&Save').enabled).toBe(true);
    file.find((m: { label: string }) => m.label === '&Export markup CSV...').click();
    expect(send).toHaveBeenCalledWith('csv');
    file.find((m: { label: string }) => m.label === '&Logout').click();
    expect(send).toHaveBeenCalledWith('logout');
    const edit = menu[1].submenu;
    const group = edit.find((entry: { label: string }) => entry.label === '&Group selected');
    const ungroup = edit.find((entry: { label: string }) => entry.label === 'Ungroup se&lected');
    expect(group.enabled).toBe(true);
    expect(group.icon).toBe('icon:group');
    expect(ungroup.enabled).toBe(true);
    expect(ungroup.icon).toBe('icon:ungroup');
    group.click();
    ungroup.click();
    expect(send).toHaveBeenCalledWith('group');
    expect(send).toHaveBeenCalledWith('ungroup');
    const flatten = edit.find((entry: { label: string }) => entry.label === '&Flatten').submenu;
    const flattenSelected = flatten.find((entry: { label: string }) => entry.label === 'Flatten &selected markup');
    expect(flattenSelected.enabled).toBe(true);
    flattenSelected.click();
    expect(send).toHaveBeenCalledWith('flatten');
    expect(flatten.find((entry: { label: string }) => entry.label === 'Flatten &All').enabled).toBe(false);
    const allMenu = menuTemplate({ signedIn: true, documentOpen: true, canFlattenAll: true }, send, 'win32');
    const flattenAll = allMenu[1].submenu.find((entry: { label: string }) => entry.label === '&Flatten').submenu
      .find((entry: { label: string }) => entry.label === 'Flatten &All');
    expect(flattenAll.enabled).toBe(true);
    flattenAll.click();
    expect(send).toHaveBeenCalledWith('flattenAll');
    const option = menu[2].submenu;
    for (const [label, action] of [['&Users...', 'users'], ['&Password...', 'password'], ['&Theme: toggle light / dark', 'theme']]) {
      const entry = option.find((m: { label: string }) => m.label === label);
      expect(entry.enabled).toBe(true);
      entry.click();
      expect(send).toHaveBeenCalledWith(action);
    }
    const view = menu[3].submenu;
    const toolbars = view.find((entry: { label?: string }) => entry.label === '&Toolbars').submenu;
    const fileToolbar = toolbars.find((entry: { label?: string }) => entry.label === '&File management');
    const contentToolbar = toolbars.find((entry: { label?: string }) => entry.label === '&Content tools');
    expect(fileToolbar.type).toBe('checkbox');
    expect(fileToolbar.checked).toBe(true);
    expect(contentToolbar.checked).toBe(true);
    const hiddenMarkupToolbar = menuTemplate({ signedIn: true, viewerActive: true, toolbars: { markup: false } }, send, 'win32')[3].submenu
      .find((entry: { label?: string }) => entry.label === '&Toolbars').submenu
      .find((entry: { label?: string }) => entry.label === '&Markup tools');
    expect(hiddenMarkupToolbar.checked).toBe(false);
    expect(hiddenMarkupToolbar.visible).toBe(true);
    fileToolbar.click();
    expect(send).toHaveBeenCalledWith('toolbar:file:hide');
    expect(toolbars.find((entry: { label?: string }) => entry.label === '&Markup tools').visible).toBe(true);
    expect(toolbars.find((entry: { label?: string }) => entry.label === 'Measurem&ent tools').visible).toBe(true);
    const measurements = view.find((entry: { label?: string }) => entry.label === '&Measurements').submenu;
    expect(measurements.find((entry: { label?: string }) => entry.label === '&Open measurements panel...').enabled).toBe(true);
    measurements.find((entry: { label?: string }) => entry.label === '&Area').click();
    expect(send).toHaveBeenCalledWith('measureArea');
    measurements.find((entry: { label?: string }) => entry.label === '&Spline').click();
    expect(send).toHaveBeenCalledWith('measureSpline');
    measurements.find((entry: { label?: string }) => entry.label === 'Rad&ius').click();
    expect(send).toHaveBeenCalledWith('measureRadius');
    measurements.find((entry: { label?: string }) => entry.label === 'Dia&meter').click();
    expect(send).toHaveBeenCalledWith('measureDiameter');
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
    expect(loggedOut[0].submenu.find((m: { label: string }) => m.label === 'Open S&hared...').enabled).toBe(true);
    expect(loggedOut[0].submenu.find((m: { label: string }) => m.label === '&Logout').enabled).toBe(false);
    expect(loggedOut[2].submenu[0].visible).toBe(false);
    const compare = menuTemplate({ signedIn: true, documentOpen: true, viewerActive: false, admin: false }, send, 'win32');
    expect(compare[3].submenu[0].enabled).toBe(false);
    expect(compare[3].submenu.find((entry: { label?: string }) => entry.label === '&Measurements').enabled).toBe(false);
    const compareToolbars = compare[3].submenu.find((entry: { label?: string }) => entry.label === '&Toolbars').submenu;
    expect(compareToolbars.find((entry: { label?: string }) => entry.label === '&Markup tools').visible).toBe(false);
    expect(compareToolbars.find((entry: { label?: string }) => entry.label === 'Measurem&ent tools').visible).toBe(false);
    expect(compare[2].submenu[0].visible).toBe(false);
    const compareZoom = menuTemplate({ signedIn: true, documentOpen: true, viewerActive: false, compareActive: true }, send, 'win32');
    const zoomIn = compareZoom[3].submenu.find((entry: { label?: string }) => entry.label === 'Zoom &In');
    const zoomOut = compareZoom[3].submenu.find((entry: { label?: string }) => entry.label === 'Zoom &Out');
    expect(zoomIn.enabled).toBe(true);
    expect(zoomOut.enabled).toBe(true);
    zoomIn.click();
    zoomOut.click();
    expect(send).toHaveBeenCalledWith('zoomIn');
    expect(send).toHaveBeenCalledWith('zoomOut');
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

  it('keeps PDF viewing and license import available without activation', () => {
    const send = vi.fn();
    const menu = menuTemplate({ viewOnly: true, documentOpen: true, viewerActive: true }, send, 'win32');
    const file = menu[0].submenu;
    expect(file.find((m: { label: string }) => m.label === '&Open PDF...').enabled).toBe(true);
    expect(file.find((m: { label: string }) => m.label === '&Save').enabled).toBe(false);
    expect(file.find((m: { label: string }) => m.label === '&Logout').enabled).toBe(false);
    expect(menu[1].submenu.find((entry: { label: string }) => entry.label === '&Flatten').enabled).toBe(false);
    menu[4].submenu.find((m: { label: string }) => m.label === '&License...').click();
    expect(send).toHaveBeenCalledWith('license');
  });
  it('offers persistent English spell-check language options', () => {
    const send = vi.fn();
    const menu = menuTemplate({ spellcheckLanguage: 'en-GB' }, send, 'win32');
    const language = menu[2].submenu.find((entry: { label: string }) => entry.label === 'Spell check &language');
    expect(language.submenu.map((entry: { label: string; checked?: boolean }) => [entry.label, entry.checked])).toEqual([
      ['English (US)', false],
      ['English (UK)', true],
    ]);
    language.submenu[0].click();
    expect(send).toHaveBeenCalledWith('spellcheck-language:en-US');
  });
  it('provides a viewer spell-check command without requiring a license', () => {
    const send = vi.fn();
    const viewerMenu = menuTemplate({ documentOpen: true, viewerActive: true, licensed: false }, send, 'win32');
    const action = viewerMenu[1].submenu.find((entry: { label: string }) => entry.label === 'Check spell&ing in PDF...');
    expect(action.enabled).toBe(true);
    action.click();
    expect(send).toHaveBeenCalledWith('spellcheckPdf');
    const compareMenu = menuTemplate({ documentOpen: true, compareActive: true }, send, 'win32');
    expect(compareMenu[1].submenu.find((entry: { label: string }) => entry.label === 'Check spell&ing in PDF...').enabled).toBe(false);
  });
});
