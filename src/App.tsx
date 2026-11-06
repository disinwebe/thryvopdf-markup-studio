import { canDeleteMarkup } from './core/comments';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { saveWithState } from './core/annotations';
import { Calibration, Markup, MarkupType, Pt, SheetMeta, STAMPS, isMeasure } from './core/types';
import { PagePlan, buildFromPlan, mergePdfs, parseRanges, splitPdf } from './core/organize';
import { PDFDocument } from 'pdf-lib';
import { readState } from './core/annotations';
import { Doc, Style, TOOL_LABEL, Tool, createDoc, defaultStyle, downloadName, pickFiles, saveBytes, stateOf } from './app/model';
import { PageView } from './components/PageView';
import { BookmarksPanel, Thumbnails } from './components/Thumbnails';
import { MarkupsPanel } from './components/MarkupsPanel';
import { MeasurePanel } from './components/MeasurePanel';
import { OrganizePanel } from './components/OrganizePanel';
import { SearchPanel, SheetsPanel } from './components/SheetsPanel';
import { ComparePanel } from './components/ComparePanel';
import { ProjectPanel } from './components/ProjectPanel';
import { SharedLibrary, SharedListing } from './components/SharedLibrary';
import { useSharedSync } from './app/useSharedSync';
import { syncedOf } from './app/shared';
import { useTheme } from './app/theme';
import { toolForKey } from './app/shortcuts';
import { getCommentSize, setCommentSize } from './core/commentSize';
import { markupCsv } from './core/markupCsv';

const MARKUP_TOOLS: Tool[] = ['line', 'highlight', 'text', 'cloud', 'rect', 'ellipse', 'arrow', 'polyline', 'pen', 'stamp', 'note'];
const TOOL_HINT: Partial<Record<Tool, string>> = {
  select: 'Select (V)',
  hand: 'Pan (H to toggle, or hold Space while using another tool)',
  line: 'Drawing-only line (not a comment)',
};
const MEASURE_TOOLS: Tool[] = ['m-length', 'm-polylength', 'm-area', 'm-perimeter', 'm-angle', 'm-count', 'calibrate'];
const HISTORY_LIMIT = 100;

type RightTab = 'markups' | 'measure' | 'organize' | 'sheets' | 'search';
type LeftTab = 'pages' | 'bookmarks' | 'project';

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

export default function App({ user, actions }: { user: AuthUser; actions: { serverMode?: boolean; uiBlocked?: boolean; logout: () => void; changePassword: () => void; manageUsers?: () => void } }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [activeId, setActiveId] = useState('');
  const [view, setView] = useState<'viewer' | 'compare'>('viewer');
  const [tool, setTool] = useState<Tool>('select');
  const [styles, setStyles] = useState<Record<string, Style>>({});
  const [subject, setSubject] = useState('');
  const author = user.name;
  const [theme, setTheme] = useTheme();
  const [commentSize, setCommentSizeState] = useState(getCommentSize);
  const changeCommentSize = (n: number) => {
    setCommentSize(n);
    setCommentSizeState(getCommentSize());
  };
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<RightTab>('markups');
  const [leftTab, setLeftTab] = useState<LeftTab>('pages');
  const [fit, setFit] = useState<{ mode: 'width' | 'page'; n: number }>({ mode: 'page', n: 0 });
  const [msg, setMsg] = useState('Ready. Open a PDF to begin.');
  const [pending, setPending] = useState<{ a: Pt; b: Pt } | null>(null);
  const [library, setLibrary] = useState(false);
  useEffect(() => {
    if (!actions.serverMode || !window.api) return;
    let cancelled = false;
    void window.api.sharedDocs({ op: 'list' }).then((result) => {
      if (cancelled) return;
      if (result.ok) setLibrary(true);
      else setMsg(`Shared documents unavailable: ${result.error || 'Could not connect to the server.'}`);
    }).catch((error: unknown) => {
      if (!cancelled) setMsg(`Shared documents unavailable: ${String(error)}`);
    });
    return () => { cancelled = true; };
  }, [actions.serverMode]);
  const lastEdit = useRef<{ key: string; t: number } | null>(null);
  const docsRef = useRef(docs);
  docsRef.current = docs;

  const active = docs.find((d) => d.id === activeId) ?? null;
  const logout = async () => {
    if (docs.some((d) => d.dirty && !d.shared) && !window.confirm('There are unsaved changes. Log out anyway?')) return;
    await leaveAll();
    actions.logout();
  };
  const say = useCallback((m: string) => setMsg(m), []);


  const updateDoc = useCallback((id: string, fn: (d: Doc) => Partial<Doc>) => {
    setDocs((all) => all.map((d) => (d.id === id ? { ...d, ...fn(d) } : d)));
  }, []);

  const { cid, leaveAll } = useSharedSync(docs, docsRef, updateDoc);

  const addDocs = useCallback(async (files: PickedFile[], activate = true) => {
    for (const f of files) {
      try {
        const d = await createDoc(f.name, f.data, f.path);
        setDocs((all) => [...all, d]);
        if (activate) setActiveId(d.id);
        setMsg(`Opened ${f.name} (${d.numPages} pages, ${d.markups.length} markups)`);
      } catch (e) {
        setMsg(`Could not open ${f.name}: ${(e as Error).message}`);
      }
    }
  }, []);

  const open = async () => addDocs(await pickFiles());

  useEffect(() => {
    window.api?.startupFiles().then((f) => { if (f.length) void addDocs(f); });
  }, [addDocs]);

  // ---- markup history -----
  const commit = (id: string, markups: Markup[], key?: string) =>
    updateDoc(id, (d) => {
      const now = Date.now();
      const coalesce = key && lastEdit.current?.key === key + id && now - lastEdit.current.t < 1500;
      lastEdit.current = key ? { key: key + id, t: now } : null;
      return {
        markups,
        undo: coalesce ? d.undo : [...d.undo.slice(-HISTORY_LIMIT + 1), d.markups],
        redo: [],
        dirty: true,
      };
    });

  const beginEdit = () =>
    active &&
    updateDoc(active.id, (d) => ({ undo: [...d.undo.slice(-HISTORY_LIMIT + 1), d.markups], redo: [] }));
  const live = (markups: Markup[]) => active && updateDoc(active.id, () => ({ markups, dirty: true }));

  const undo = () =>
    active &&
    updateDoc(active.id, (d) =>
      d.undo.length ? { markups: d.undo[d.undo.length - 1], undo: d.undo.slice(0, -1), redo: [...d.redo, d.markups], dirty: true } : {},
    );
  const redo = () =>
    active &&
    updateDoc(active.id, (d) =>
      d.redo.length ? { markups: d.redo[d.redo.length - 1], redo: d.redo.slice(0, -1), undo: [...d.undo, d.markups], dirty: true } : {},
    );

  const createMarkup = (m: Markup) => {
    if (!active) return;
    commit(active.id, [...active.markups, { ...m, authorEmail: user.email }]);
    setSelectedId(m.id);
    if (m.type === 'text' || m.type === 'callout' || m.type === 'note') {
      setTool('select');
      setRightTab('markups');
    }
    if (isMeasure(m.type)) setRightTab('measure');
  };

  const updateMarkup = (id: string, patch: Partial<Markup>, key?: string) =>
    active && commit(active.id, active.markups.map((m) => (m.id === id ? { ...m, ...patch } : m)), key);

  const deleteMarkup = (id: string) => {
    if (!active) return;
    const target = active.markups.find((m) => m.id === id);
    if (target && !canDeleteMarkup(target, user)) {
      window.alert('Only the author of a markup can delete it.');
      return;
    }
    commit(active.id, active.markups.filter((m) => m.id !== id));
    setSelectedId(null);
  };

  // ---- file ops -----
  const bake = (d: Doc) => saveWithState(d.bytes, stateOf(d));

  const save = async (as = false) => {
    if (!active) return;
    try {
      const bytes = await bake(active);
      const path = await saveBytes(active.name, bytes, 'pdf', as ? undefined : active.path);
      if (!path) return;
      updateDoc(active.id, () => ({ bytes, path, name: baseName(path), dirty: false }));
      say(`Saved ${baseName(path)} with ${active.markups.length} markup annotation(s)`);
    } catch (e) {
      say('Save failed: ' + (e as Error).message);
    }
  };

  const openShared = async (info: SharedListing) => {
    const have = docsRef.current.find((d) => d.shared?.id === info.id);
    if (have) {
      setActiveId(have.id);
      setLibrary(false);
      return;
    }
    const r = await window.api!.sharedDocs({ op: 'open', id: info.id });
    if (!r.ok) return say(r.expired ? 'Session expired. Log out and sign in again.' : 'Could not open shared document: ' + (r.error || 'unknown error'));
    try {
      const base = await createDoc(r.name || info.name, new Uint8Array(r.bytes));
      const d: Doc = {
        ...base,
        markups: r.markups,
        dirty: false,
        shared: { id: info.id, version: r.version, pr: r.pr, synced: syncedOf(r.markups), collaborators: r.presence || [], status: 'live' },
      };
      setDocs((all) => [...all, d]);
      setActiveId(d.id);
      setView('viewer');
      setLibrary(false);
      say(`Opened shared document ${d.name}: ${d.numPages} pages, ${d.markups.length} markups. Changes sync live.`);
    } catch (e) {
      say('Could not open shared document: ' + (e as Error).message);
    }
  };

  const uploadActive = async (project = '', description = ''): Promise<{ ok: boolean; message: string }> => {
    const fail = (message: string) => {
      say(message);
      return { ok: false, message };
    };
    if (!active) return fail('Open a PDF tab first.');
    if (active.shared) return fail('This tab is already a shared document.');
    try {
      const bytes = await bake(active);
      const up = await window.api!.sharedDocs({ op: 'upload', name: active.name, bytes, project, description });
      if (!up.ok) return fail('Upload failed: ' + (up.error || 'unknown error'));
      for (let i = 0; i < active.markups.length; i += 500) {
        const r = await window.api!.sharedDocs({ op: 'ops', id: up.doc.id, upserts: active.markups.slice(i, i + 500), cid });
        if (!r.ok) return fail(`Uploaded ${active.name}, but copying existing markups failed: ${r.error || 'unknown error'}`);
      }
      const message = `Uploaded ${active.name} with ${active.markups.length} markup(s). Open it from the list to collaborate; this tab stays a local copy.`;
      say(message);
      return { ok: true, message };
    } catch (e) {
      return fail('Upload failed: ' + (e as Error).message);
    }
  };
  const exportCsv = async (csv: string, name: string) => {
    const path = await saveBytes(name, csv, 'csv');
    if (path) say('Saved ' + path);
  };

  const closeDoc = (id: string) => {
    const d = docs.find((x) => x.id === id);
    if (d?.dirty && !window.confirm(`${d.name} has unsaved changes. Close anyway?`)) return;
    const rest = docs.filter((x) => x.id !== id);
    setDocs(rest);
    if (activeId === id) setActiveId(rest[rest.length - 1]?.id ?? '');
  };

  // ---- organize -----
  const replaceContent = async (d: Doc, bytes: Uint8Array, bookmarks: Doc['bookmarks'], page: number) => {
    const fresh = await createDoc(d.name, bytes, d.path, true);
    updateDoc(d.id, () => ({
      bytes,
      pdf: fresh.pdf,
      numPages: fresh.numPages,
      markups: fresh.markups,
      calibrations: fresh.calibrations,
      sheets: fresh.sheets,
      bookmarks,
      undo: [],
      redo: [],
      dirty: true,
      page: Math.max(0, Math.min(fresh.numPages - 1, page)),
      textCache: new Map(),
    }));
    setSelectedId(null);
  };

  const applyPlan = async (d: Doc, plan: PagePlan[], extras: Uint8Array[] = []) => {
    if (d.shared) return say('Page changes are not available on shared documents (they would desync collaborators). Extract the pages to a local copy first.');
    try {
      const baked = await bake(d);
      const bytes = await buildFromPlan([baked, ...extras], plan);
      const map = new Map<number, number>();
      plan.forEach((s, i) => s.src === 0 && !map.has(s.index) && map.set(s.index, i));
      const bookmarks = d.bookmarks.filter((b) => map.has(b.page)).map((b) => ({ ...b, page: map.get(b.page)! }));
      await replaceContent(d, bytes, bookmarks, map.get(d.page) ?? d.page);
      say(`Updated page layout (${plan.length} pages)`);
    } catch (e) {
      say('Organize failed: ' + (e as Error).message);
    }
  };

  const openNew = async (name: string, bytes: Uint8Array) => {
    const nd = await createDoc(name, bytes, undefined, true);
    setDocs((all) => [...all, nd]);
    setActiveId(nd.id);
    setView('viewer');
  };

  const extract = async (d: Doc, indices: number[]) => {
    const baked = await bake(d);
    const bytes = await buildFromPlan([baked], indices.map((index) => ({ src: 0, index })));
    await openNew(downloadName(d.name, '-extract'), bytes);
    say(`Extracted ${indices.length} page(s) into a new tab. Use Save As to write it to disk.`);
  };

  const split = async (d: Doc, groups: number[][]) => {
    try {
      const baked = await bake(d);
      const parts = await splitPdf(baked, groups);
      const files = parts.map((data, i) => ({ name: downloadName(d.name, `-part${i + 1}`), data }));
      const dir = window.api ? await window.api.saveMany({ files }) : null;
      say(dir ? `Wrote ${files.length} files to ${dir}` : 'Split cancelled');
    } catch (e) {
      say('Split failed: ' + (e as Error).message);
    }
  };

  const insert = async (d: Doc, sourceId: string, range: string, at: number) => {
    try {
      let srcBytes: Uint8Array | undefined;
      if (sourceId === '__file') srcBytes = (await pickFiles())[0]?.data;
      else {
        const s = docs.find((x) => x.id === sourceId);
        srcBytes = s ? await bake(s) : undefined;
      }
      if (!srcBytes) return;
      const total = (await PDFDocument.load(srcBytes, { ignoreEncryption: true })).getPageCount();
      const idx = range.trim() ? parseRanges(range, total).flat() : Array.from({ length: total }, (_, i) => i);
      const plan: PagePlan[] = [];
      for (let i = 0; i < d.numPages; i++) plan.push({ src: 0, index: i });
      plan.splice(at, 0, ...idx.map((index) => ({ src: 1, index })));
      await applyPlan(d, plan, [srcBytes]);
    } catch (e) {
      say('Insert failed: ' + (e as Error).message);
    }
  };

  const mergeAll = async () => {
    if (docs.length < 2) return say('Open at least two PDFs to merge');
    const baked = await Promise.all(docs.map(bake));
    await openNew('merged-set.pdf', await mergePdfs(baked));
    say(`Merged ${docs.length} documents into a new tab`);
  };

  // ---- calibration -----
  const setCal = (cal: Calibration, all: boolean) => {
    if (!active) return;
    updateDoc(active.id, (d) => {
      const cals = { ...d.calibrations };
      if (all) for (let i = 0; i < d.numPages; i++) cals[i] = cal;
      else cals[d.page] = cal;
      return { calibrations: cals, dirty: true };
    });
    setPending(null);
    setTool('select');
    say(`Scale set: 100 pt = ${(cal.unitsPerPoint * 100).toFixed(3)} ${cal.unit}`);
  };

  const goto = (i: number) =>
    active && updateDoc(active.id, (d) => ({ page: Math.max(0, Math.min(d.numPages - 1, i)) }));
  const setZoom = (z: number) => active && updateDoc(active.id, () => ({ zoom: z }));
  const zoomBy = (f: number) => active && setZoom(Math.max(0.05, Math.min(8, (active.zoom || 1) * f)));

  // ---- keyboard -----
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e) => {
    const t = e.target as HTMLElement;
    if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
    const mod = e.ctrlKey || e.metaKey;
    const next = active ? toolForKey(e, tool) : null;
    if (next) {
      e.preventDefault();
      setTool(next);
      setPending(null);
    } else if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
    } else if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save(e.shiftKey);
    } else if (mod && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      open();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && tool === 'select') {
      deleteMarkup(selectedId);
    } else if (e.key === 'Escape') {
      setTool('select');
      setPending(null);
    } else if (e.key === 'PageDown' && active) goto(active.page + 1);
    else if (e.key === 'PageUp' && active) goto(active.page - 1);
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const menuRef = useRef<(action: string) => void>(() => {});
  menuRef.current = (action) => {
    if (action === 'quit') {
      if (docs.some((d) => d.dirty && !d.shared) && !window.confirm('There are unsaved changes. Quit anyway?')) return;
      void leaveAll().finally(() => window.api?.quitApp());
      return;
    }
    if (library || actions.uiBlocked) return;
    switch (action) {
      case 'open': void open(); break;
      case 'save': void save(false); break;
      case 'saveAs': void save(true); break;
      case 'csv': if (active) void exportCsv(markupCsv(active.markups, active.path || active.name), downloadName(active.name, '-markups', 'csv')); break;
      case 'shared': if (actions.serverMode) setLibrary(true); break;
      case 'close': if (active) closeDoc(active.id); break;
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'select': setTool('select'); setPending(null); break;
      case 'pan': setTool('hand'); setPending(null); break;
      case 'delete': if (selectedId) deleteMarkup(selectedId); break;
      case 'theme': setTheme(theme === 'dark' ? 'light' : 'dark'); break;
      case 'shortcuts': window.alert('V: Select\nH: toggle Pan\nHold Space: temporary Pan\nCtrl+O: Open\nCtrl+S: Save\nCtrl+Shift+S: Save As\nCtrl+Z / Ctrl+Shift+Z: Undo / Redo\nDelete: delete selected markup'); break;
      case 'about': void window.api?.appVersion().then((v) => window.alert(`ThryvoPDF Markup Studio ${v}\nPDF review, markup and shared drawing collaboration.`)); break;
      case 'serverHelp': window.alert('On the server PC, run npm run server and allow its configured port through Windows Firewall. On each client, choose Change on the sign-in screen, enter the server address and test the connection. Back up the server data folder, including its users and documents. Use HTTPS on untrusted networks.'); break;
    }
  };
  useEffect(() => window.api?.onMenuAction((action) => menuRef.current(action)), []);
  useEffect(() => {
    const api = window.api;
    if (!api) return;
    api.setMenuState({
      signedIn: true, documentOpen: !!active, canUndo: !!active?.undo.length, canRedo: !!active?.redo.length,
      selected: !!active && !!selectedId && !!active.markups.find((m) => m.id === selectedId && canDeleteMarkup(m, user)),
      serverMode: !!actions.serverMode, blocked: library || !!actions.uiBlocked,
    });
  }, [active, selectedId, user, actions.serverMode, actions.uiBlocked, library]);
  useEffect(() => () => window.api?.setMenuState({
    signedIn: false, documentOpen: false, canUndo: false, canRedo: false, selected: false, serverMode: false, blocked: false,
  }), []);

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const files = [...e.dataTransfer.files].filter((f) => /\.pdf$/i.test(f.name));
    const picked = await Promise.all(
      files.map(async (f) => ({ name: f.name, path: '', data: new Uint8Array(await f.arrayBuffer()) })),
    );
    addDocs(picked);
  };

  // ---- style editing -----
  const selected = active?.markups.find((m) => m.id === selectedId) ?? null;
  const toolStyle: Style = { ...(styles[tool] ?? defaultStyle(tool)), subject };
  const editingSelected = !!selected && tool === 'select';
  const shown = editingSelected
    ? { ...toolStyle, color: selected!.color, width: selected!.width, opacity: selected!.opacity, fill: !!selected!.fill, fillColor: selected!.fill ?? '#ffffff' }
    : toolStyle;
  const changeStyle = (patch: Partial<Style>) => {
    if (editingSelected && selected) {
      const mp: Partial<Markup> = {};
      if (patch.color !== undefined) mp.color = patch.color;
      if (patch.width !== undefined) mp.width = patch.width;
      if (patch.opacity !== undefined) mp.opacity = patch.opacity;
      if (patch.fill !== undefined || patch.fillColor !== undefined) {
        const on = patch.fill ?? !!selected.fill;
        mp.fill = on ? patch.fillColor ?? selected.fill ?? '#ffffff' : undefined;
      }
      if (patch.stamp !== undefined) mp.stamp = patch.stamp;
      updateMarkup(selected.id, mp, 'style');
    } else if (tool !== 'select' && tool !== 'hand') {
      setStyles((s) => ({ ...s, [tool]: { ...(s[tool] ?? defaultStyle(tool)), ...patch } }));
    }
  };
  const canStyle = editingSelected || !['select', 'hand', 'calibrate'].includes(tool);
  const showStamp = tool === 'stamp' || selected?.type === 'stamp';

  const countOf = useMemo(() => active?.markups.length ?? 0, [active?.markups]);

  const toolBtn = (t: Tool) => (
    <button key={t} title={TOOL_HINT[t]} className={tool === t ? 'on' : ''} onClick={() => { setTool(t); setPending(null); }} disabled={!active}>
      {TOOL_LABEL[t]}
    </button>
  );

  return (
    <div className="app" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <div className="bar">
        <button onClick={open} title="Ctrl+O">Open…</button>
        <button onClick={() => save(false)} disabled={!active} title="Ctrl+S">Save</button>
        <button onClick={() => save(true)} disabled={!active}>Save as…</button>
        <span className="sep" />
        <button onClick={undo} disabled={!active?.undo.length} title="Ctrl+Z">↶ Undo</button>
        <button onClick={redo} disabled={!active?.redo.length} title="Ctrl+Y">↷ Redo</button>
        <span className="sep" />
        <button className={view === 'viewer' ? 'on' : ''} onClick={() => setView('viewer')}>Viewer</button>
        <button className={view === 'compare' ? 'on' : ''} onClick={() => setView('compare')} disabled={docs.length === 0}>Compare</button>
        {view === 'viewer' && active && (
          <>
            <span className="sep" />
            <button onClick={() => goto(active.page - 1)}>◀</button>
            <input
              className="pg"
              type="number"
              min={1}
              max={active.numPages}
              value={active.page + 1}
              onChange={(e) => goto((+e.target.value || 1) - 1)}
            />
            <span>/ {active.numPages}</span>
            <button onClick={() => goto(active.page + 1)}>▶</button>
            <span className="sep" />
            <button onClick={() => zoomBy(1 / 1.25)}>－</button>
            <span className="zoom">{Math.round((active.zoom || 1) * 100)}%</span>
            <button onClick={() => zoomBy(1.25)}>＋</button>
            <button onClick={() => setFit((f) => ({ mode: 'width', n: f.n + 1 }))}>Fit width</button>
            <button onClick={() => setFit((f) => ({ mode: 'page', n: f.n + 1 }))}>Fit page</button>
          </>
        )}
        <span className="grow" />
        <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="Switch between light and dark theme">
          {theme === 'dark' ? '☀ Light' : '🌙 Dark'}
        </button>
        <span className="who" title={user.email}>Signed in: <b>{user.name}</b>{user.discipline ? ` - ${user.discipline}` : ""}{user.role === "admin" ? " (Administrator)" : ""}</span>
        {actions.serverMode && <button onClick={() => setLibrary(true)} title="Documents stored on the server">Shared…</button>}
        {actions.manageUsers && <button onClick={actions.manageUsers}>Users</button>}
        {user.email && window.api && <button onClick={actions.changePassword}>Password</button>}
        <button onClick={logout}>Logout</button>
      </div>

      {view === 'viewer' && (
        <div className="bar tools">
          {(['select', 'hand'] as Tool[]).map(toolBtn)}
          <span className="sep" />
          <span className="lbl">Markup</span>
          {MARKUP_TOOLS.map(toolBtn)}
          <span className="sep" />
          <span className="lbl">Measure</span>
          {MEASURE_TOOLS.map(toolBtn)}
          <span className="sep" />
          {canStyle && (
            <>
              <input type="color" title="Color" value={shown.color} onChange={(e) => changeStyle({ color: e.target.value })} />
              <label title="Line width">
                W <input type="range" min={1} max={12} value={shown.width} onChange={(e) => changeStyle({ width: +e.target.value })} />
              </label>
              <label title="Opacity">
                α <input type="range" min={0.1} max={1} step={0.05} value={shown.opacity} onChange={(e) => changeStyle({ opacity: +e.target.value })} />
              </label>
              <label title="Fill">
                Fill <input type="checkbox" checked={shown.fill} onChange={(e) => changeStyle({ fill: e.target.checked })} />
              </label>
              {showStamp && (
                <select value={selected?.type === 'stamp' && editingSelected ? selected.stamp : shown.stamp} onChange={(e) => changeStyle({ stamp: e.target.value })}>
                  {STAMPS.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              )}
            </>
          )}
        </div>
      )}

      <div className="tabs">
        {docs.map((d) => (
          <div key={d.id} className={'tab' + (d.id === activeId ? ' active' : '')} onClick={() => { setActiveId(d.id); setSelectedId(null); }}>
            {d.shared && <span title="Shared document on the server">☁ </span>}
            {d.name}
            {d.dirty ? ' •' : ''}
            <button
              className="x"
              onClick={(e) => {
                e.stopPropagation();
                closeDoc(d.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {active?.shared && (
        <div className={'collab' + (active.shared.status === 'live' ? '' : ' warn')} role="status">
          <b>☁ Shared document</b> - edits sync live.
          {active.shared.status === 'live' ? (
            <span> Working now: {active.shared.collaborators.map((c) => (c.email === user.email ? 'You' : c.name) + (c.discipline ? ` (${c.discipline})` : '')).join(', ') || '-'}</span>
          ) : (
            <span> {active.shared.status === 'expired' ? 'Session expired.' : 'Offline.'} {active.shared.error}</span>
          )}
        </div>
      )}

      <div className="main">
        {!active ? (
          <div className="empty">
            <h1>ThryvoPDF Markup Studio</h1>
            <p>Markups · Measurements · Compare revisions · Organize drawing sets</p>
            <button className="primary big" onClick={open}>Open PDF…</button>
            <p className="muted">or drag PDF files onto this window</p>
          </div>
        ) : view === 'compare' ? (
          <ComparePanel docs={docs} activeId={active.id} onOpenRevision={async () => addDocs(await pickFiles(), false)} onMessage={say} />
        ) : (
          <>
            <div className="side left">
              <div className="ptabs">
                {(['project', 'pages', 'bookmarks'] as LeftTab[]).map((t) => (
                  <button key={t} className={leftTab === t ? 'on' : ''} onClick={() => setLeftTab(t)}>
                    {t === 'pages' ? 'Pages' : t === 'bookmarks' ? 'Bookmarks' : 'Project'}
                  </button>
                ))}
              </div>
              {leftTab === 'pages' && <Thumbnails doc={active} onGoto={goto} />}
              {leftTab === 'bookmarks' && (
                <BookmarksPanel doc={active} onGoto={goto} onChange={(b) => updateDoc(active.id, () => ({ bookmarks: b, dirty: true }))} />
              )}
              {leftTab === 'project' && (
                <ProjectPanel
                  docs={docs}
                  activeId={active.id}
                  onActivate={setActiveId}
                  onOpen={open}
                  onOpenShared={openShared}
                  onClose={closeDoc}
                  onRename={(id, name) => updateDoc(id, () => ({ name, dirty: true }))}
                  onMove={(i, dir) =>
                    setDocs((all) => {
                      const j = i + dir;
                      if (j < 0 || j >= all.length) return all;
                      const n = all.slice();
                      [n[i], n[j]] = [n[j], n[i]];
                      return n;
                    })
                  }
                  onMerge={mergeAll}
                />
              )}
            </div>
            <div className="center">
              <PageView
                key={active.id}
                doc={active}
                tool={tool}
                style={toolStyle}
                author={author}
                selectedId={selectedId}
                fit={fit}
                onSelect={(id) => { setSelectedId(id); if (id) setRightTab((t) => (t === 'measure' || t === 'markups' ? t : 'markups')); }}
                onCreate={createMarkup}
                onBeginEdit={beginEdit}
                onLive={live}
                onZoom={setZoom}
                onCalibrate={(a, b) => {
                  setPending({ a, b });
                  setRightTab('measure');
                  say('Enter the known distance between the two picked points');
                }}
                onMessage={say}
              />
            </div>
            <div className="side right">
              <div className="ptabs">
                {(
                  [
                    ['markups', `Markups (${countOf})`],
                    ['measure', 'Measure'],
                    ['organize', 'Organize'],
                    ['sheets', 'Sheet index'],
                    ['search', 'Search'],
                  ] as [RightTab, string][]
                ).map(([t, label]) => (
                  <button key={t} className={rightTab === t ? 'on' : ''} onClick={() => setRightTab(t)}>
                    {label}
                  </button>
                ))}
              </div>
              {rightTab === 'markups' && (
                <MarkupsPanel
                  doc={active}
                  selectedId={selectedId}
                  author={author}
                  user={user}
                  commentSize={commentSize}
                  onCommentSize={changeCommentSize}
                  onSelect={(id) => {
                    const m = active.markups.find((x) => x.id === id);
                    if (m) {
                      setSelectedId(id);
                      setTool('select');
                      goto(m.page);
                    }
                  }}
                  onUpdate={updateMarkup}
                  onDelete={deleteMarkup}
                  onExport={(csv) => exportCsv(csv, downloadName(active.name, '-markups', 'csv'))}
                />
              )}
              {rightTab === 'measure' && (
                <MeasurePanel
                  doc={active}
                  pending={pending}
                  subject={subject}
                  onSubject={setSubject}
                  onTool={(t) => { setTool(t); say('Click two points of a known length on the drawing'); }}
                  onSetCal={setCal}
                  onClearPending={() => setPending(null)}
                  onExport={(csv) => exportCsv(csv, downloadName(active.name, '-takeoff', 'csv'))}
                  onMessage={say}
                />
              )}
              {rightTab === 'organize' && (
                <OrganizePanel
                  doc={active}
                  docs={docs}
                  onPlan={(plan) => applyPlan(active, plan)}
                  onExtract={(idx) => extract(active, idx)}
                  onSplit={(g) => split(active, g)}
                  onInsert={(src, range, at) => insert(active, src, range, at)}
                  onMessage={say}
                />
              )}
              {rightTab === 'sheets' && (
                <SheetsPanel
                  doc={active}
                  docs={docs}
                  onChange={(page, patch: Partial<SheetMeta>) =>
                    updateDoc(active.id, (d) => ({
                      sheets: { ...d.sheets, [page]: { ...({ number: '', title: '', discipline: '', revision: '' } as SheetMeta), ...d.sheets[page], ...patch } },
                      dirty: true,
                    }))
                  }
                  onGoto={goto}
                  onExport={(csv) => exportCsv(csv, 'sheet-index.csv')}
                />
              )}
              {rightTab === 'search' && (
                <SearchPanel
                  docs={docs}
                  activeId={active.id}
                  onGoto={(id, page) => {
                    setActiveId(id);
                    updateDoc(id, () => ({ page }));
                  }}
                />
              )}
            </div>
          </>
        )}
      </div>
      <div className="status">{msg}</div>
      {library && <SharedLibrary me={user} activeName={active && !active.shared ? active.name : undefined} onClose={() => setLibrary(false)} onOpen={openShared} onUpload={uploadActive} />}
    </div>
  );
}

export type { MarkupType };
void readState;
