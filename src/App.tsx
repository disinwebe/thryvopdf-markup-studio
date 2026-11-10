import { canDeleteMarkup } from './core/comments';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { saveWithState } from './core/annotations';
import { Calibration, Markup, MarkupType, Pt, SheetMeta, STAMPS, isMeasure, uid } from './core/types';
import { boxOf, translate } from './core/geometry';
import { loadPdf } from './pdf/pdfjs';
import { rasterizeMarkups } from './app/rasterizeMarkups';
import { PagePlan, buildFromPlan, mergePdfs, parseRanges, splitPdf } from './core/organize';
import { PDFDocument } from 'pdf-lib';
import { readState } from './core/annotations';
import { Doc, Style, TOOL_LABEL, Tool, createDoc, defaultStyle, downloadName, pickFiles, saveBytes, stateOf, toolStyle as resolveToolStyle } from './app/model';
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
import { batchChanges, syncedOf } from './app/shared';
import { useTheme } from './app/theme';
import { historyShortcut, isTypingTarget, toolForKey } from './app/shortcuts';
import { getCommentSize, setCommentSize } from './core/commentSize';
import { markupCsv } from './core/markupCsv';
import { importStamp } from './app/stampImport';
import { LicenseInfo, type LicenseInfoStatus } from './components/LicenseInfo';
import { PanelToggle } from './components/PanelToggle';
import { FloatingTools } from './components/FloatingTools';
import { FolderIcon } from './components/FolderIcon';
import { SaveIcon } from './components/SaveIcon';
import { normalizePdfFilename } from './app/filename';
import { isReviewMarkup } from './core/numbering';
import { NotificationBell, type NotificationsApi } from './components/Notifications';
import { TabNameEditor } from './components/TabNameEditor';
import { loadMarkupStyleDefaults, saveMarkupStyleDefaults } from './app/styleDefaults';
import { KeyIcon } from './components/KeyIcon';
import { CommentPopup } from './components/CommentPopup';
import { SelectIcon } from './components/SelectIcon';
import { ContextMenuIcon } from './components/ContextMenuIcon';

const MARKUP_TOOLS: Tool[] = ['line', 'highlight', 'text', 'cloud', 'rect', 'ellipse', 'arrow', 'polyline', 'pen', 'stamp', 'note'];
const MEASURE_TOOLS: Tool[] = ['m-length', 'm-polylength', 'm-area', 'm-perimeter', 'm-angle', 'm-count'];
const TOOL_ICONS: Partial<Record<Tool, string>> = {
  hand: '✋', line: '╱', highlight: '▰', text: 'T', cloud: '☁', rect: '□',
  ellipse: '○', arrow: '↗', polyline: '⌁', pen: '✎', stamp: '▣', note: '▤',
  'm-length': '↔', 'm-polylength': '⌁', 'm-area': '▱', 'm-perimeter': '□', 'm-angle': '∠', 'm-count': '#',
};
const TOOL_HINT: Partial<Record<Tool, string>> = {
  select: 'Select (V)',
  hand: 'Pan (H to toggle, or hold Space while using another tool)',
  line: 'Drawing-only line (not a comment)',
};
const HISTORY_LIMIT = 100;

type RightTab = 'markups' | 'measure' | 'organize' | 'sheets' | 'search';
type LeftTab = 'pages' | 'bookmarks' | 'project';
type ViewerContextMenu = { x: number; y: number; markupId: string | null; point: Pt };

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

export default function App({ user, actions, viewOnly = false, licenseStatus, onImportLicense }: { user: AuthUser; actions: { serverMode?: boolean; uiBlocked?: boolean; logout: () => void; changePassword: () => void; manageUsers?: () => void; notifications?: NotificationsApi | null }; viewOnly?: boolean; licenseStatus?: LicenseInfoStatus; onImportLicense?: () => void }) {
  const readOnly = viewOnly;
  const [docs, setDocs] = useState<Doc[]>([]);
  const [activeId, setActiveId] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [view, setView] = useState<'viewer' | 'compare'>('viewer');
  const [tool, setTool] = useState<Tool>('select');
  const [styles, setStyles] = useState<Record<string, Style>>({});
  const [styleDefaults, setStyleDefaults] = useState(loadMarkupStyleDefaults);
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
  const [leftTab, setLeftTab] = useState<LeftTab>('project');
  const [leftPanelVisible, setLeftPanelVisible] = useState(true);
  const [rightPanelVisible, setRightPanelVisible] = useState(true);
  const [defaultsOpen, setDefaultsOpen] = useState(false);
  const [licenseInfo, setLicenseInfo] = useState<LicenseInfoStatus | null>(null);
  const [fit, setFit] = useState<{ mode: 'width' | 'page'; n: number }>({ mode: 'page', n: 0 });
  const [msg, setMsg] = useState('Ready. Open a PDF to begin.');
  const [savedPdfPath, setSavedPdfPath] = useState<string | null>(null);
  const [pending, setPending] = useState<{ a: Pt; b: Pt } | null>(null);
  const [library, setLibrary] = useState(false);
  const [sharedRevision, setSharedRevision] = useState(0);
  const [commentTarget, setCommentTarget] = useState<{ docId: string; markupId: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<ViewerContextMenu | null>(null);
  const [clipboardMarkup, setClipboardMarkup] = useState<Markup | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const lastEdit = useRef<{ key: string; t: number } | null>(null);
  const docsRef = useRef(docs);
  docsRef.current = docs;

  const active = docs.find((d) => d.id === activeId) ?? null;
  useEffect(() => {
    if (!viewOnly && (tool === 'stamp' || active?.markups.find((markup) => markup.id === selectedId)?.type === 'stamp')) {
      setDefaultsOpen(true);
    }
  }, [tool, selectedId, activeId, viewOnly]);
  const logout = async () => {
    if (docs.some((d) => d.dirty && !d.shared) && !window.confirm('There are unsaved changes. Log out anyway?')) return;
    await leaveAll();
    actions.logout();
  };
  const say = useCallback((m: string) => { setMsg(m); setSavedPdfPath(null); }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const closeOutside = (event: PointerEvent) => {
      if (!contextMenuRef.current?.contains(event.target as Node)) setContextMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [contextMenu]);

  const updateDoc = useCallback((id: string, fn: (d: Doc) => Partial<Doc>) => {
    setDocs((all) => all.map((d) => (d.id === id ? { ...d, ...fn(d) } : d)));
  }, []);
  const promptRename = (d: Doc) => {
    if (d.shared || readOnly) return;
    setRenamingId(d.id);
  };

  const { cid, leaveAll } = useSharedSync(docs, docsRef, updateDoc, readOnly);

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
    !readOnly && updateDoc(id, (d) => {
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
    !readOnly && active &&
    updateDoc(active.id, (d) => ({ undo: [...d.undo.slice(-HISTORY_LIMIT + 1), d.markups], redo: [] }));
  const live = (markups: Markup[]) => !readOnly && active && updateDoc(active.id, () => ({ markups, dirty: true }));

  const undo = () => {
    lastEdit.current = null;
    return !readOnly && active &&
    updateDoc(active.id, (d) =>
      d.undo.length ? { markups: d.undo[d.undo.length - 1], undo: d.undo.slice(0, -1), redo: [...d.redo, d.markups], dirty: true } : {},
    );
  };
  const redo = () => {
    lastEdit.current = null;
    return !readOnly && active &&
    updateDoc(active.id, (d) =>
      d.redo.length ? { markups: d.redo[d.redo.length - 1], redo: d.redo.slice(0, -1), undo: [...d.undo, d.markups], dirty: true } : {},
    );
  };

  const createMarkup = (m: Markup) => {
    if (!active || viewOnly) return;
    commit(active.id, [...active.markups, { ...m, authorEmail: user.email }]);
    setSelectedId(m.id);
    if (isReviewMarkup(m)) {
      setCommentTarget({ docId: active.id, markupId: m.id });
      setRightTab('markups');
      setRightPanelVisible(true);
    }
    if (m.type === 'text' || m.type === 'callout' || m.type === 'note') {
      setTool('select');
      setRightTab('markups');
    }
  };

  const updateMarkup = (id: string, patch: Partial<Markup>, key?: string) =>
    !viewOnly && active && commit(active.id, active.markups.map((m) => (m.id === id ? { ...m, ...patch } : m)), key);

  const closeCommentPopup = () => {
    setCommentTarget(null);
    setTool('select');
    setPending(null);
    requestAnimationFrame(() => appRef.current?.focus({ preventScroll: true }));
  };
  const saveNewComment = (text: string) => {
    if (!active || !commentTarget || active.id !== commentTarget.docId || viewOnly) return;
    const markup = active.markups.find((m) => m.id === commentTarget.markupId);
    if (!markup || !isReviewMarkup(markup)) return;
    updateMarkup(markup.id, { comments: [...markup.comments, { id: uid(), author, authorEmail: user.email, date: new Date().toISOString(), text }] });
    closeCommentPopup();
  };

  const deleteMarkup = (id: string) => {
    if (!active || viewOnly) return;
    const target = active.markups.find((m) => m.id === id);
    if (target && !canDeleteMarkup(target, user)) {
      window.alert('Only the author of a markup can delete it.');
      return;
    }
    commit(active.id, active.markups.filter((m) => m.id !== id));
    setSelectedId(null);
  };

  const copyContextMarkup = () => {
    const markup = active?.markups.find((item) => item.id === contextMenu?.markupId);
    if (markup) setClipboardMarkup({ ...markup, points: markup.points.map((point) => ({ ...point })), comments: [] });
    setContextMenu(null);
  };

  const cutContextMarkup = () => {
    const markup = active?.markups.find((item) => item.id === contextMenu?.markupId);
    if (!markup) return;
    setClipboardMarkup({ ...markup, points: markup.points.map((point) => ({ ...point })), comments: [] });
    deleteMarkup(markup.id);
    setContextMenu(null);
  };

  const pasteContextMarkup = () => {
    if (!active || !clipboardMarkup || readOnly || !contextMenu) return;
    const bounds = boxOf(clipboardMarkup);
    const pasted = translate(clipboardMarkup, contextMenu.point.x - (bounds.x + bounds.w / 2), contextMenu.point.y - (bounds.y + bounds.h / 2));
    const markup: Markup = {
      ...pasted,
      id: uid(),
      page: active.page,
      author: user.name,
      authorEmail: user.email,
      date: new Date().toISOString(),
      status: 'None',
      comments: [],
    };
    commit(active.id, [...active.markups, markup]);
    setSelectedId(markup.id);
    setContextMenu(null);
    say('Markup pasted.');
  };

  const flattenContextMarkups = async (requestedIds: string[]) => {
    const document = active;
    if (!document || readOnly) return;
    if (document.shared) {
      setContextMenu(null);
      say('Flattening is unavailable in live shared documents because their page-content changes are not synchronized. Open a local PDF copy to flatten it.');
      return;
    }
    const requested = new Set(requestedIds);
    const targets = document.markups.filter((markup) => requested.has(markup.id) && canDeleteMarkup(markup, user));
    if (!targets.length) {
      setContextMenu(null);
      say('There are no markups you can flatten.');
      return;
    }
    const partial = targets.length !== requested.size;
    const scope = requested.size === 1 ? 'the selected markup' : 'all markups you can edit';
    const warning = partial ? '\nMarkups you do not own will remain editable.' : '';
    if (!window.confirm(`Flatten ${scope} into the PDF as raster images? This is permanent and cannot be undone. Save a copy first if you may need to edit them later.${warning}`)) return;
    setContextMenu(null);
    say(`Rasterizing ${targets.length} markup(s)...`);
    try {
      const result = await rasterizeMarkups(document.bytes, stateOf(document), targets.map((markup) => markup.id));
      const pdf = await loadPdf(result.bytes);
      updateDoc(document.id, () => ({
        bytes: result.bytes,
        pdf,
        markups: result.markups,
        undo: [],
        redo: [],
        dirty: true,
      }));
      setSelectedId(null);
      say(`Flattened ${targets.length} markup(s) into the PDF. Save to keep the changes.`);
    } catch (error) {
      const message = 'Could not flatten markup(s): ' + (error instanceof Error ? error.message : String(error));
      say(message);
      window.alert(message);
    }
  };

  // ---- file ops -----
  const bake = (d: Doc) => saveWithState(d.bytes, stateOf(d));

  const save = async (as = false) => {
    if (!active || viewOnly) return;
    try {
      const bytes = await bake(active);
      const path = await saveBytes(active.name, bytes, 'pdf', as ? undefined : active.path);
      if (!path) return;
      updateDoc(active.id, () => ({ bytes, path, name: baseName(path), dirty: false }));
      setMsg(`Saved ${baseName(path)} with ${active.markups.length} markup annotation(s)`);
      setSavedPdfPath(path);
    } catch (e) {
      const message = 'Save failed: ' + (e instanceof Error ? e.message : String(e));
      say(message);
      window.alert(message);
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
      say(`Opened shared document ${d.name}: ${d.numPages} pages, ${d.markups.length} markups. ${readOnly ? 'Viewer mode: read-only.' : 'Changes sync live.'}`);
    } catch (e) {
      say('Could not open shared document: ' + (e as Error).message);
    }
  };

  const uploadActive = async (project = '', description = '', members: string[] = []): Promise<{ ok: boolean; message: string }> => {
    const fail = (message: string) => {
      say(message);
      return { ok: false, message };
    };
    if (readOnly) return fail('A license is required to upload documents.');
    if (!active) return fail('Open a PDF tab first.');
    if (viewOnly) return fail('Import a license to upload shared documents.');
    if (active.shared) return fail('This tab is already a shared document.');
    try {
      const bytes = await bake(active);
      const up = await window.api!.sharedDocs({ op: 'upload', name: active.name, bytes, project, description, members });
      if (!up.ok) return fail('Upload failed: ' + (up.error || 'unknown error'));
      for (let i = 0; i < active.markups.length;) {
        const batch = batchChanges(active.markups.slice(i), []).upserts;
        const r = await window.api!.sharedDocs({ op: 'ops', id: up.doc.id, upserts: batch, cid });
        if (!r.ok) return fail(`Uploaded ${active.name}, but copying existing markups failed: ${r.error || 'unknown error'}`);
        i += batch.length;
      }
      const message = `Uploaded ${active.name} with ${active.markups.length} markup(s). Open it from the list to collaborate; this tab stays a local copy.`;
      say(message);
      return { ok: true, message };
    } catch (e) {
      return fail('Upload failed: ' + (e as Error).message);
    }
  };
  const renameDocument = async (id: string, value: string) => {
    const doc = docsRef.current.find((item) => item.id === id);
    const name = normalizePdfFilename(value);
    if (!doc || !name || viewOnly || doc.shared) return;
    if (!doc.path) {
      updateDoc(id, () => ({ name }));
      return;
    }
    const result = await window.api?.renameFile({ path: doc.path, name });
    if (!window.api) {
      updateDoc(id, () => ({ name }));
      return;
    }
    if (!result?.ok || !result.path) {
      say(result?.error || 'Could not rename this PDF.');
      return;
    }
    updateDoc(id, () => ({ name, path: result.path }));
    say(`Renamed PDF to ${name}`);
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
    if (!active || readOnly) return;
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
    if (commentTarget || defaultsOpen || licenseInfo || library || actions.uiBlocked || isTypingTarget(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    const next = active && !readOnly ? toolForKey(e, tool) : null;
    const history = active && !readOnly ? historyShortcut(e) : null;
    if (next) {
      e.preventDefault();
      setTool(next);
      setPending(null);
    } else if (history) {
      e.preventDefault();
      history === 'redo' ? redo() : undo();
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
    if (library || actions.uiBlocked || commentTarget || defaultsOpen || licenseInfo) return;
    if (readOnly && ['save', 'saveAs', 'csv', 'undo', 'redo', 'delete', 'flatten', 'flattenAll', 'toolDefaults', 'measurePanel', 'organizePanel', 'sheetsPanel'].includes(action)) return;
    if (readOnly && action.startsWith('measure')) return;
    switch (action) {
      case 'open': void open(); break;
      case 'save': void save(false); break;
      case 'saveAs': void save(true); break;
      case 'csv': if (active) void exportCsv(markupCsv(active.markups, active.path || active.name), downloadName(active.name, '-markups', 'csv')); break;
      case 'shared': if (actions.serverMode) setLibrary(true); break;
      case 'logout': void logout(); break;
      case 'users': actions.manageUsers?.(); break;
      case 'password': actions.changePassword(); break;
      case 'close': if (active) closeDoc(active.id); break;
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'select': setTool('select'); setPending(null); break;
      case 'pan': setTool('hand'); setPending(null); break;
      case 'delete': if (selectedId) deleteMarkup(selectedId); break;
      case 'flatten':
        if (selectedId) void flattenContextMarkups([selectedId]);
        break;
      case 'flattenAll':
        if (active) void flattenContextMarkups(active.markups.map((markup) => markup.id));
        break;
      case 'theme': setTheme(theme === 'dark' ? 'light' : 'dark'); break;
      case 'toggleLeftPanel': setLeftPanelVisible((visible) => !visible); break;
      case 'toggleRightPanel': setRightPanelVisible((visible) => !visible); break;
      case 'toolDefaults': setDefaultsOpen(true); break;
      case 'measurePanel': setRightTab('measure'); break;
      case 'measureLength': setTool('m-length'); setPending(null); setRightTab('markups'); break;
      case 'measurePolylength': setTool('m-polylength'); setPending(null); setRightTab('markups'); break;
      case 'measureArea': setTool('m-area'); setPending(null); setRightTab('markups'); break;
      case 'measurePerimeter': setTool('m-perimeter'); setPending(null); setRightTab('markups'); break;
      case 'measureAngle': setTool('m-angle'); setPending(null); setRightTab('markups'); break;
      case 'measureCount': setTool('m-count'); setPending(null); setRightTab('markups'); break;
      case 'organizePanel': setRightTab('organize'); break;
      case 'sheetsPanel': setRightTab('sheets'); break;
      case 'searchPanel': setRightTab('search'); break;
      case 'zoomIn': if (view === 'viewer') zoomBy(1.25); break;
      case 'zoomOut': if (view === 'viewer') zoomBy(1 / 1.25); break;
      case 'fitWidth': if (active && view === 'viewer') setFit((f) => ({ mode: 'width', n: f.n + 1 })); break;
      case 'fitPage': if (active && view === 'viewer') setFit((f) => ({ mode: 'page', n: f.n + 1 })); break;
      case 'shortcuts': window.alert('V: Select\nH: toggle Pan\nHold Space: temporary Pan\nCtrl+O: Open\nCtrl+S: Save\nCtrl+Shift+S: Save As\nCtrl+= / Ctrl+-: Zoom in / out\nCtrl+Alt+L / Ctrl+Alt+R: toggle left / right panel\nCtrl+Z: Undo; Ctrl+Y or Ctrl+Shift+Z: Redo\nDelete: delete selected markup\nAlt+F/E/O/V/H: open menus'); break;
      case 'about': void window.api?.showAbout(); break;
      case 'license':
        if (licenseStatus) setLicenseInfo(licenseStatus);
        else void window.api?.licenseStatus().then(setLicenseInfo);
        break;
    }
  };
  useEffect(() => window.api?.onMenuAction((action) => menuRef.current(action)), []);
  useEffect(() => {
    const api = window.api;
    if (!api) return;
    api.setMenuState({
      signedIn: true, documentOpen: !!active, viewerActive: view === 'viewer', canUndo: !!active?.undo.length, canRedo: !!active?.redo.length,
      selected: !viewOnly && !!active && !!selectedId && !!active.markups.find((m) => m.id === selectedId && canDeleteMarkup(m, user)),
      canFlattenSelected: !viewOnly && !!active && !active.shared && !!active.markups.find((m) => m.id === selectedId && canDeleteMarkup(m, user)),
      canFlattenAll: !viewOnly && !!active && !active.shared && active.markups.some((markup) => canDeleteMarkup(markup, user)),
      serverMode: !!actions.serverMode, blocked: library || !!actions.uiBlocked || !!commentTarget || defaultsOpen || !!licenseInfo, viewOnly,
    });
  }, [active, selectedId, user, view, actions.serverMode, actions.uiBlocked, library, viewOnly, commentTarget, defaultsOpen, licenseInfo]);
  useEffect(() => () => window.api?.setMenuState({
    signedIn: false, documentOpen: false, viewerActive: false, canUndo: false, canRedo: false, selected: false, canFlattenSelected: false, canFlattenAll: false, serverMode: false, blocked: false, viewOnly: false,
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
  const toolStyle: Style = resolveToolStyle(tool, styles[tool], styleDefaults, subject);
  const editingSelected = !!selected && tool === 'select';
  const shown = editingSelected
    ? { ...toolStyle, color: selected!.color, width: selected!.width, opacity: selected!.opacity, fill: !!selected!.fill, fillColor: selected!.fill ?? '#ffffff' }
    : toolStyle;
  const changeStyle = (patch: Partial<Style>) => {
    const savedDefaults = saveMarkupStyleDefaults({
      ...(patch.color !== undefined ? { color: patch.color } : {}),
      ...(patch.width !== undefined ? { width: patch.width } : {}),
      ...(patch.opacity !== undefined ? { opacity: patch.opacity } : {}),
    });
    setStyleDefaults(savedDefaults);
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
      if (patch.stamp !== undefined) mp.stampImage = patch.stampImage;
      updateMarkup(selected.id, mp, 'style');
    } else if (tool !== 'select' && tool !== 'hand') {
      setStyles((s) => ({ ...s, [tool]: { ...(s[tool] ?? defaultStyle(tool)), ...patch } }));
    }
  };
  const showStamp = tool === 'stamp' || selected?.type === 'stamp';
  const chooseStamp = async () => {
    try {
      const file = await window.api?.pickStamp();
      if (!file) return;
      const image = await importStamp(file, (total) => {
        const answer = window.prompt(`Choose a PDF page from 1 to ${total}:`, '1');
        return answer === null ? null : Number(answer);
      });
      if (!image) return;
      if (editingSelected && selected?.type === 'stamp') {
        updateMarkup(selected.id, { stamp: 'Custom image', stampImage: image });
      } else {
        setStyles((s) => ({ ...s, stamp: { ...(s.stamp ?? defaultStyle('stamp')), stamp: 'Custom image', stampImage: image } }));
        setTool('stamp');
      }
      say('Custom stamp loaded. Click the drawing to place it.');
    } catch (e) {
      const message = 'Could not load stamp: ' + (e instanceof Error ? e.message : String(e));
      say(message);
      window.alert(message);
    }
  };

  const countOf = useMemo(() => active?.markups.length ?? 0, [active?.markups]);
  const contextMarkup = contextMenu && active?.markups.find((markup) => markup.id === contextMenu.markupId && markup.page === active.page);
  const flattenableCount = active?.markups.filter((markup) => canDeleteMarkup(markup, user)).length ?? 0;

  const toolBtn = (t: Tool) => (
    <button key={t} title={TOOL_HINT[t] || TOOL_LABEL[t]} className={tool === t ? 'on' : ''} onClick={() => { setTool(t); setPending(null); if (t === 'stamp') setDefaultsOpen(true); }} disabled={!active || (viewOnly && t !== 'select' && t !== 'hand')}>
      {t === 'select' ? <SelectIcon theme={theme} /> : <span className="tool-icon" aria-hidden="true">{TOOL_ICONS[t]}</span>}{TOOL_LABEL[t]}
    </button>
  );

  return (
    <div className="app" ref={appRef} tabIndex={-1} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <div className="bar">
        <button onClick={open} title="Ctrl+O"><FolderIcon />Open…</button>
        <button onClick={() => setLibrary(true)} disabled={!actions.serverMode} title={actions.serverMode ? 'Open Shared Documents' : 'Shared documents require server mode'}><FolderIcon />Open Shared...</button>
        <button onClick={() => save(false)} disabled={!active || viewOnly} title="Ctrl+S"><SaveIcon />Save</button>
        <button onClick={() => save(true)} disabled={!active || viewOnly}><SaveIcon inverted />Save as…</button>
        <span className="sep" />
        <button onClick={undo} disabled={viewOnly || !active?.undo.length} title="Ctrl+Z">↶ Undo</button>
        <button onClick={redo} disabled={viewOnly || !active?.redo.length} title="Ctrl+Y">↷ Redo</button>
        <span className="sep" />
        <button className={view === 'viewer' ? 'on' : ''} onClick={() => setView('viewer')}><span className="tool-icon" aria-hidden="true">▤</span>Viewer</button>
        <button className={view === 'compare' ? 'on' : ''} onClick={() => setView('compare')} disabled={readOnly || docs.length === 0}><span className="tool-icon" aria-hidden="true">◫</span>Compare</button>
        <span className="grow" />
        {viewOnly && <><span className="muted">Unlicensed viewing — editing is disabled.</span><button onClick={() => licenseStatus && setLicenseInfo(licenseStatus)}>License information…</button><button onClick={onImportLicense}>Import license…</button></>}
        <span className="who" title={user.email}>{viewOnly ? <><b>Guest viewer</b></> : <>Signed in: <b>{user.name}</b>{user.discipline ? ` - ${user.discipline}` : ""}{user.role === "admin" ? " (Administrator)" : ""}</>}</span>
        <NotificationBell api={actions.notifications ?? null} onOpenShared={() => setLibrary(true)} onOpenNotification={(notification) => {
          if (notification.type === 'registration') actions.manageUsers?.();
          else setLibrary(true);
        }} />
        {!viewOnly && <button className="toolbar-logout" onClick={() => void logout()} title="Logout"><KeyIcon />Logout</button>}
      </div>
      {readOnly && <div className="collab warn" role="status">Read-only viewer mode - a license is required to edit or save. <button onClick={() => licenseStatus && setLicenseInfo(licenseStatus)}>Activate...</button></div>}

      {view === 'viewer' && (
        <>
          <div className="bar tools">
            {(['select', 'hand'] as Tool[]).map(toolBtn)}
            <span className="sep" />
            <span className="lbl">Markup</span>
            {MARKUP_TOOLS.map(toolBtn)}
          </div>
          <div className="bar tools measurement-tools">
            <span className="measurement-toolbar-prefix" aria-hidden="true">
              <button tabIndex={-1}><SelectIcon theme={theme} />Select</button>
              <button tabIndex={-1}><span className="tool-icon" aria-hidden="true">✋</span>Pan</button>
              <span className="sep" />
            </span>
            <span className="lbl">Measure</span>
            {MEASURE_TOOLS.map(toolBtn)}
            <button className={rightTab === 'measure' ? 'on' : ''} onClick={() => setRightTab('measure')} disabled={!active || readOnly}>Measurements...</button>
          </div>
        </>
      )}

      <div className="tabs">
        {docs.map((d) => (
          <div key={d.id} className={'tab' + (d.id === activeId ? ' active' : '')} onClick={() => { setActiveId(d.id); setSelectedId(null); }} onDoubleClick={() => promptRename(d)} title={d.shared ? 'Shared document names cannot be changed here' : 'Double-click to rename this tab'}>
            {renamingId === d.id && !d.shared ? (
              <TabNameEditor key={d.id} name={d.name} onSave={(name) => { void renameDocument(d.id, name); setRenamingId(null); }} onCancel={() => setRenamingId(null)} />
            ) : <>
              {d.shared && <span title="Shared document on the server">☁ </span>}
              {d.name}
              {d.dirty ? ' •' : ''}
              {!d.shared && !readOnly && <button className="x" aria-label={`Rename ${d.name} tab`} title="Rename tab" onClick={(e) => { e.stopPropagation(); promptRename(d); }}>✎</button>}
            </>}
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
          <b>☁ Shared document</b> - {readOnly ? 'read-only; updates from others appear live.' : 'edits sync live.'}
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
            <p>Markups · Compare revisions · Organize drawing sets</p>
            <button className="primary big" onClick={open}>Open PDF…</button>
            <button className="big" onClick={() => setLibrary(true)} disabled={!actions.serverMode} title={actions.serverMode ? 'Open shared documents' : 'Shared documents require server mode'}>Shared Documents…</button>
            <p className="muted">or drag PDF files onto this window</p>
          </div>
        ) : view === 'compare' ? (
          <ComparePanel docs={docs} activeId={active.id} onOpenRevision={async () => addDocs(await pickFiles(), false)} onMessage={say} />
        ) : (
          <>
            <div className="side left" id="left-panel" hidden={!leftPanelVisible}>
              <div className="ptabs">
                {(['project', 'pages', 'bookmarks'] as LeftTab[]).map((t) => (
                  <button key={t} className={leftTab === t ? 'on' : ''} onClick={() => setLeftTab(t)}>
                    {t === 'pages' ? 'Pages' : t === 'bookmarks' ? 'Bookmarks' : 'Project'}
                  </button>
                ))}
              </div>
              {leftTab === 'pages' && <Thumbnails doc={active} onGoto={goto} />}
              {leftTab === 'bookmarks' && (
                <BookmarksPanel doc={active} onGoto={goto} readOnly={readOnly} onChange={(b) => { if (!readOnly) updateDoc(active.id, () => ({ bookmarks: b, dirty: true })); }} />
              )}
              {leftTab === 'project' && (
                <ProjectPanel
                  docs={docs}
                  activeId={active.id}
                  me={user}
                  sharedRevision={sharedRevision}
                  viewOnly={viewOnly}
                  onActivate={setActiveId}
                  onOpen={open}
                  onOpenShared={actions.serverMode ? openShared : undefined}
                  onClose={closeDoc}
                  onRename={renameDocument}
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
                  readOnly={readOnly}
                />
              )}
            </div>
            <div className="center">
              <PanelToggle side="left" visible={leftPanelVisible} onToggle={() => setLeftPanelVisible((visible) => !visible)} />
              <PanelToggle side="right" visible={rightPanelVisible} onToggle={() => setRightPanelVisible((visible) => !visible)} />
              <PageView
                key={active.id}
                doc={active}
                tool={readOnly ? 'hand' : tool}
                style={toolStyle}
                author={author}
                user={user}
                selectedId={selectedId}
                fit={fit}
                onSelect={(id) => {
                  setSelectedId(id);
                  if (id) {
                    setRightTab((tab) => (tab === 'measure' || tab === 'markups' ? tab : 'markups'));
                    const markup = active.markups.find((item) => item.id === id);
                    if (markup?.type === 'stamp') {
                      setTool('select');
                      setDefaultsOpen(true);
                    }
                  }
                }}
                onCreate={createMarkup}
                onBeginEdit={beginEdit}
                onLive={live}
                onZoom={setZoom}
                onContextMenu={(event, markupId, point) => {
                  const currentSelection = active.markups.find((markup) => markup.id === selectedId && markup.page === active.page)?.id ?? null;
                  setContextMenu({
                    x: Math.max(4, Math.min(event.clientX, window.innerWidth - 220)),
                    y: Math.max(4, Math.min(event.clientY, window.innerHeight - 360)),
                    markupId: markupId ?? currentSelection,
                    point,
                  });
                }}
                onCalibrate={(a, b) => {
                  setPending({ a, b });
                  setRightTab('measure');
                  say('Enter the known distance between the two picked points');
                }}
                onMessage={say}
              />
              <div className="viewer-controls" aria-label="Page and zoom controls">
                <FloatingTools tool={tool} theme={theme} onTool={(t) => { setTool(t); setPending(null); }} />
                <span className="sep" />
                <button onClick={() => goto(active.page - 1)} title="Previous page" aria-label="Previous page">◀</button>
                <input className="pg" type="number" aria-label="Page number" min={1} max={active.numPages} value={active.page + 1} onChange={(e) => goto((+e.target.value || 1) - 1)} />
                <span>/ {active.numPages}</span>
                <button onClick={() => goto(active.page + 1)} title="Next page" aria-label="Next page">▶</button>
                <span className="sep" />
                <button onClick={() => zoomBy(1 / 1.25)} title="Zoom out (Ctrl+-)" aria-label="Zoom out">−</button>
                <span>{Math.round((active.zoom || 1) * 100)}%</span>
                <button onClick={() => zoomBy(1.25)} title="Zoom in (Ctrl+=)" aria-label="Zoom in">＋</button>
                <button onClick={() => setFit((f) => ({ mode: 'width', n: f.n + 1 }))} title="Fit width"><span aria-hidden="true">↔</span> Width</button>
                <button onClick={() => setFit((f) => ({ mode: 'page', n: f.n + 1 }))} title="Fit page"><span aria-hidden="true">▣</span> Page</button>
              </div>
            </div>
            <div className="side right" id="right-panel" hidden={!rightPanelVisible}>
              <div className="ptabs">
                <button className="on">Markups ({countOf})</button>
              </div>
                <MarkupsPanel
                  doc={active}
                  readOnly={readOnly}
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
                      if (m.type === 'stamp') setDefaultsOpen(true);
                      goto(m.page);
                    }
                  }}
                  onUpdate={updateMarkup}
                  onDelete={deleteMarkup}
                  onExport={(csv) => exportCsv(csv, downloadName(active.name, '-markups', 'csv'))}
                />
            </div>
            {rightTab !== 'markups' && (
              <div className="modal" role="dialog" aria-modal="true" aria-label="Document tools">
                <div className="usermgmt tool-dialog">
                  <div className="row between"><b>{rightTab === 'measure' ? 'Measurements' : rightTab === 'organize' ? 'Organize pages' : rightTab === 'sheets' ? 'Sheet index' : 'Search documents'}</b><button onClick={() => setRightTab('markups')}>Close</button></div>
              {rightTab === 'measure' && (
                <>
                <div className="row pad">{MEASURE_TOOLS.map((t) => (
                  <button key={t} onClick={() => { setTool(t); setRightTab('markups'); }}>{TOOL_LABEL[t]}</button>
                ))}</div>
                <MeasurePanel
                  doc={active}
                  pending={pending}
                  subject={subject}
                  onSubject={setSubject}
                  onTool={(t) => { setTool(t); setRightTab('markups'); say('Click two points of a known length on the drawing'); }}
                  onSetCal={setCal}
                  onClearPending={() => setPending(null)}
                  onExport={(csv) => exportCsv(csv, downloadName(active.name, '-takeoff', 'csv'))}
                  onMessage={say}
                />
                </>
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
              </div>
            )}
          </>
        )}
      </div>
      <div className="status">{msg}{savedPdfPath && <button className="status-link" onClick={() => void window.api?.openSavedPdf(savedPdfPath).catch((error) => say('Could not open the saved PDF: ' + (error instanceof Error ? error.message : String(error))))}>Open saved PDF</button>}</div>
      {contextMenu && active && (
        <div
          className="viewer-context-menu"
          ref={contextMenuRef}
          role="menu"
          aria-label="PDF viewer context menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button role="menuitem" disabled={!contextMarkup || readOnly || !canDeleteMarkup(contextMarkup, user)} onClick={cutContextMarkup}><ContextMenuIcon action="cut" />Cut</button>
          <button role="menuitem" disabled={!contextMarkup} onClick={copyContextMarkup}><ContextMenuIcon action="copy" />Copy</button>
          <button role="menuitem" disabled={!clipboardMarkup || readOnly} onClick={pasteContextMarkup}><ContextMenuIcon action="paste" />Paste</button>
          <div className="context-menu-separator" />
          <button role="menuitem" onClick={() => { setTool('select'); setPending(null); setContextMenu(null); }}><ContextMenuIcon action="select" />Select</button>
          <button role="menuitem" onClick={() => { setTool('hand'); setContextMenu(null); }}><ContextMenuIcon action="pan" />Pan</button>
          <button role="menuitem" onClick={() => { zoomBy(1.25); setContextMenu(null); }}><ContextMenuIcon action="zoom-in" />Zoom In</button>
          <button role="menuitem" onClick={() => { zoomBy(1 / 1.25); setContextMenu(null); }}><ContextMenuIcon action="zoom-out" />Zoom Out</button>
          {contextMarkup && (
            <>
              <div className="context-menu-separator" />
              <button
                role="menuitem"
                disabled={readOnly || !!active.shared || !canDeleteMarkup(contextMarkup, user)}
                title={active.shared ? 'Open a local PDF copy to flatten shared-document markups.' : undefined}
                onClick={() => void flattenContextMarkups([contextMarkup.id])}
              >
                <ContextMenuIcon action="flatten" />Flatten
              </button>
            </>
          )}
          <div className="context-menu-separator" />
          <button
            role="menuitem"
            disabled={readOnly || !!active.shared || flattenableCount === 0}
            title={active.shared ? 'Open a local PDF copy to flatten shared-document markups.' : undefined}
            onClick={() => void flattenContextMarkups(active.markups.map((markup) => markup.id))}
          >
            <ContextMenuIcon action="flatten-all" />Flatten All
          </button>
        </div>
      )}
      {library && <SharedLibrary me={user} activeName={active && !active.shared ? active.name : undefined} activeSharedId={active?.shared?.id} onClose={() => setLibrary(false)} onOpen={openShared} onUpload={uploadActive} onChanged={() => setSharedRevision((n) => n + 1)} />}
      {commentTarget && <CommentPopup onSave={saveNewComment} onCancel={closeCommentPopup} />}
      {defaultsOpen && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Tool defaults">
          <div className="usermgmt tool-dialog">
            <div className="row between"><b>Tool defaults and stamp</b><button onClick={() => setDefaultsOpen(false)}>Close</button></div>
            <p>Select a markup tool to set defaults, or select an existing markup to change its properties.</p>
            {!editingSelected && (tool === 'select' || tool === 'hand') ? <p>Choose a markup tool first.</p> : (
              <div className="props">
                <label>Color<input type="color" value={shown.color} onChange={(e) => changeStyle({ color: e.target.value })} /></label>
                <label>Line width<input type="range" min={1} max={12} value={shown.width} onChange={(e) => changeStyle({ width: +e.target.value })} /></label>
                <label>Opacity<input type="range" min={0.1} max={1} step={0.05} value={shown.opacity} onChange={(e) => changeStyle({ opacity: +e.target.value })} /></label>
                <label>Fill<input type="checkbox" checked={shown.fill} onChange={(e) => changeStyle({ fill: e.target.checked })} /></label>
              </div>
            )}
            {showStamp && <>
              <label>Stamp <select value={selected?.type === 'stamp' && editingSelected ? selected.stamp : shown.stamp} onChange={(e) => changeStyle({ stamp: e.target.value, stampImage: undefined })}>
                {(selected?.stampImage || shown.stampImage) && <option value="Custom image">Custom image</option>}
                {STAMPS.map((s) => <option key={s}>{s}</option>)}
              </select></label>
              <button onClick={() => void chooseStamp()}>Import stamp...</button>
            </>}
          </div>
        </div>
      )}
      {licenseInfo && <LicenseInfo status={licenseInfo} onClose={() => setLicenseInfo(null)} onImport={viewOnly ? () => { setLicenseInfo(null); onImportLicense?.(); } : undefined} />}
    </div>
  );
}

export type { MarkupType };
void readState;
