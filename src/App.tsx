import { canDeleteMarkup } from './core/comments';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { saveWithState } from './core/annotations';
import { Calibration, Markup, MarkupType, Pt, SheetMeta, STAMPS, isMeasure, uid } from './core/types';
import { translate } from './core/geometry';
import { loadPdf, nextSearchHitIndex, scanPdfSpelling, searchTextMatches, type PdfSpellingIssue, type PdfSpellingMatch, type PdfTextMatch } from './pdf/pdfjs';
import { flattenStackableLayers, rasterizeMarkups } from './app/rasterizeMarkups';
import { PagePlan, buildFromPlan, mergePdfs, parseRanges, rotatePage, splitPdf } from './core/organize';
import { PDFDocument } from 'pdf-lib';
import { readState } from './core/annotations';
import { Doc, Style, TOOL_LABEL, Tool, createDoc, defaultStyle, documentZoomKey, downloadName, loadDocumentZoom, makeMarkup, pickFiles, saveBytes, saveDocumentZoom, shouldResetMeasurementSubject, stateOf, toolStyle as resolveToolStyle } from './app/model';
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
import { CommentPopup } from './components/CommentPopup';
import { SelectIcon } from './components/SelectIcon';
import { ContextMenuIcon } from './components/ContextMenuIcon';
import { SYMBOLS, type PageContentTool, type PageObject, type PdfSymbol } from './core/pageContent';
import { importSignature, loadSignatures, saveSignatures, type SavedSignature } from './app/signatures';
import { reorderPageLayers } from './core/layerOrder';
import { markupSelectionBounds } from './core/selection';
import { groupItems, ungroupItems, expandGroupedSelection } from './core/grouping';
import { canEditComment } from './core/comments';
import { EditCommentsPopup } from './components/EditCommentsPopup';
import { ActionIcon, type ActionIconName } from './components/ActionIcon';
import { MovableToolbar, toolbarDockReservations, type ToolbarLayout } from './components/MovableToolbar';
import { StandardColorPicker } from './components/StandardColorPicker';
import { parseWatermarkPages } from './core/watermarks';
import { WatermarksManager } from './components/WatermarksManager';
import { groupWatermarks } from './core/watermarks';

const MARKUP_TOOLS: Tool[] = ['line', 'highlight', 'text', 'cloud', 'rect', 'ellipse', 'arrow', 'polyline', 'pen', 'stamp', 'image', 'note'];
const MEASURE_TOOLS: Tool[] = ['m-length', 'm-polylength', 'm-spline', 'm-radius', 'm-diameter', 'm-area', 'm-perimeter', 'm-angle', 'm-count'];
const TOOL_ICONS: Partial<Record<Tool, ActionIconName>> = {
  hand: 'pan', line: 'line', highlight: 'highlight', text: 'text', cloud: 'cloud', rect: 'rect',
  ellipse: 'ellipse', arrow: 'arrow', polyline: 'polyline', pen: 'pen', stamp: 'stamp', image: 'image', note: 'note',
  'm-length': 'm-length', 'm-polylength': 'm-polylength', 'm-spline': 'm-spline', 'm-radius': 'm-radius', 'm-diameter': 'm-diameter',
  'm-area': 'm-area', 'm-perimeter': 'm-perimeter', 'm-angle': 'm-angle', 'm-count': 'm-count',
};
const TOOL_HINT: Partial<Record<Tool, string>> = {
  select: 'Select (V)',
  hand: 'Pan (H to toggle, or hold Space while using another tool)',
  line: 'Drawing-only line (not a comment)',
  cloud: 'Click to add cloud vertices; press Enter, double-click, or right-click to finish',
  'm-radius': 'Click the circle center, then a point on its edge',
  'm-diameter': 'Click two opposite points on the circle edge',
};
const HISTORY_LIMIT = 100;

type RightTab = 'markups' | 'measure' | 'watermarks' | 'organize' | 'sheets' | 'search';
type LeftTab = 'pages' | 'bookmarks' | 'project';
type ViewerContextMenu = { x: number; y: number; markupId: string | null; calloutId: string | null; pageObjectId: string | null; stackId: string | null; point: Pt; calloutOnly: boolean };

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

export default function App({ user, actions, viewOnly = false, licenseStatus, onImportLicense }: { user: AuthUser; actions: { serverMode?: boolean; signedIn?: boolean; uiBlocked?: boolean; logout: () => void; changePassword: () => void; manageUsers?: () => void; requestSignIn?: (onSignedIn?: () => void) => void; notifications?: NotificationsApi | null }; viewOnly?: boolean; licenseStatus?: LicenseInfoStatus; onImportLicense?: () => void }) {
  const readOnly = viewOnly;
  const [docs, setDocs] = useState<Doc[]>([]);
  const [activeId, setActiveId] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [view, setView] = useState<'viewer' | 'compare'>('viewer');
  const [tool, setTool] = useState<Tool>('select');
  const [toolbarLayouts, setToolbarLayouts] = useState<Record<string, ToolbarLayout>>({});
  const [styles, setStyles] = useState<Record<string, Style>>({});
  const [styleDefaults, setStyleDefaults] = useState(loadMarkupStyleDefaults);
  const [subject, setSubject] = useState('');
  const lastMeasurementTool = useRef<Tool | null>(null);
  const author = user.name;
  const chooseTool = (next: Tool) => {
    if (MEASURE_TOOLS.includes(next)) {
      if (shouldResetMeasurementSubject(lastMeasurementTool.current, next)) setSubject('');
      lastMeasurementTool.current = next;
    }
    setTool(next);
  };
  const [theme, setTheme] = useTheme();
  const [spellcheckLanguage, setSpellcheckLanguage] = useState<'en-US' | 'en-GB'>('en-US');
  const [spellReviewOpen, setSpellReviewOpen] = useState(false);
  const [spellReviewBusy, setSpellReviewBusy] = useState(false);
  const [spellReviewProgress, setSpellReviewProgress] = useState(0);
  const [spellReviewResults, setSpellReviewResults] = useState<PdfSpellingIssue[]>([]);
  const [spellReviewMatches, setSpellReviewMatches] = useState<PdfSpellingMatch[]>([]);
  const [spellReviewDocId, setSpellReviewDocId] = useState('');
  const [spellReviewDocName, setSpellReviewDocName] = useState('');
  const [spellReviewPagesWithText, setSpellReviewPagesWithText] = useState(0);
  const [spellReviewWordsChecked, setSpellReviewWordsChecked] = useState(0);
  const [spellReviewError, setSpellReviewError] = useState('');
  const spellReviewRun = useRef(0);
  useEffect(() => {
    let mounted = true;
    const api = window.api;
    if (api) {
      void api.spellCheckerLanguage()
        .then((language) => { if (mounted) setSpellcheckLanguage(language); })
        .catch((error: unknown) => {
          if (mounted) setMsg(`Spell checker unavailable: ${error instanceof Error ? error.message : String(error)}`);
        });
    }
    return () => { mounted = false; };
  }, []);
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
  const [closePromptOpen, setClosePromptOpen] = useState(false);
  const [closePromptBusy, setClosePromptBusy] = useState(false);
  const [closePromptError, setClosePromptError] = useState('');
  const [fit, setFit] = useState<{ mode: 'width' | 'page'; n: number }>({ mode: 'page', n: 0 });
  const [continuousScroll, setContinuousScroll] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [searchMatches, setSearchMatches] = useState<PdfTextMatch[]>([]);
  const [searchHitIndex, setSearchHitIndex] = useState(-1);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchDocumentId, setSearchDocumentId] = useState('');
  const [searchNavigation, setSearchNavigation] = useState<{ docId: string; page: number; y: number; token: number } | null>(null);
  const [msg, setMsg] = useState('Ready. Open a PDF to begin.');
  const [savedPdfPath, setSavedPdfPath] = useState<string | null>(null);
  const [pending, setPending] = useState<{ a: Pt; b: Pt } | null>(null);
  const [library, setLibrary] = useState(false);
  const [sharedRevision, setSharedRevision] = useState(0);
  const [commentTarget, setCommentTarget] = useState<{ docId: string; markupId: string } | null>(null);
  const [editingCommentsTarget, setEditingCommentsTarget] = useState<{ docId: string; markupId: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<ViewerContextMenu | null>(null);
  const [clipboardSelection, setClipboardSelection] = useState<{ markups: Markup[]; pageObjects: PageObject[] }>({ markups: [], pageObjects: [] });
  const [contentMode, setContentMode] = useState<'text' | 'symbol' | 'signature' | null>(null);
  const [contentSize, setContentSize] = useState(24);
  const [contentColor, setContentColor] = useState('#202020');
  const [contentSymbol, setContentSymbol] = useState<PdfSymbol>('check');
  const [signatureStore] = useState(loadSignatures);
  const [signatures, setSignatures] = useState<SavedSignature[]>(signatureStore.items);
  const [signatureError, setSignatureError] = useState(signatureStore.error ?? '');
  const [signatureId, setSignatureId] = useState<string | null>(signatureStore.items[0]?.id ?? null);
  const [removeSignatureBackground, setRemoveSignatureBackground] = useState(false);
  const [signatureManagerOpen, setSignatureManagerOpen] = useState(false);
  const [watermarkDialogOpen, setWatermarkDialogOpen] = useState(false);
  const [watermarkKind, setWatermarkKind] = useState<'text' | 'image' | 'pdf'>('text');
  const [watermarkText, setWatermarkText] = useState('CONFIDENTIAL');
  const [watermarkPages, setWatermarkPages] = useState('');
  const [watermarkColor, setWatermarkColor] = useState('#c00000');
  const [watermarkOpacity, setWatermarkOpacity] = useState(0.25);
  const [watermarkRotation, setWatermarkRotation] = useState(-45);
  const [watermarkFile, setWatermarkFile] = useState<PickedFile | null>(null);
  const [selectedMarkupIds, setSelectedMarkupIds] = useState<string[]>([]);
  const [selectedCalloutIds, setSelectedCalloutIds] = useState<string[]>([]);
  const [selectedPageObjectIds, setSelectedPageObjectIds] = useState<string[]>([]);
  const [editingPageObjectId, setEditingPageObjectId] = useState<string | null>(null);
  const [editingPageObjectIsNew, setEditingPageObjectIsNew] = useState(false);
  const [pageObjectTextDraft, setPageObjectTextDraft] = useState('');
  const signatureFileInput = useRef<HTMLInputElement>(null);
  const signatureListRef = useRef(signatures);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const toolbarGroupsRef = useRef<HTMLDivElement>(null);
  const [toolbarAppWidth, setToolbarAppWidth] = useState(0);
  const [toolbarAppHeight, setToolbarAppHeight] = useState(0);
  const [toolbarBaseHeight, setToolbarBaseHeight] = useState(0);
  const lastEdit = useRef<{ key: string; t: number } | null>(null);
  const searchRun = useRef(0);
  const searchNavigationToken = useRef(0);
  const pendingMarkupSelection = useRef<{ docId: string; markupId: string } | null>(null);
  const closeRequestHandlerRef = useRef<() => void>(() => {});
  const docsRef = useRef(docs);
  docsRef.current = docs;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const toolbarLayoutList = useMemo(() => Object.values(toolbarLayouts), [toolbarLayouts]);
  const reportToolbarLayout = useCallback((id: string, layout: ToolbarLayout | null) => {
    setToolbarLayouts((current) => {
      if (!layout) {
        if (!(id in current)) return current;
        const next = { ...current };
        delete next[id];
        return next;
      }
      const previous = current[id];
      if (previous && previous.edge === layout.edge && previous.corner === layout.corner && previous.width === layout.width &&
        previous.height === layout.height && previous.visible === layout.visible && previous.moved === layout.moved &&
        previous.position.x === layout.position.x && previous.position.y === layout.position.y) return current;
      return { ...current, [id]: { ...layout, id } };
    });
  }, []);
  const toolbarReservations = useMemo(
    () => toolbarDockReservations(toolbarLayoutList, toolbarAppWidth, toolbarAppHeight, toolbarBaseHeight),
    [toolbarAppHeight, toolbarAppWidth, toolbarBaseHeight, toolbarLayoutList],
  );

  useEffect(() => {
    const app = appRef.current;
    const toolbarGroups = toolbarGroupsRef.current;
    if (!app || !toolbarGroups) return;
    const updateSize = () => {
      const width = app.clientWidth;
      const height = app.clientHeight;
      const baseHeight = toolbarGroups.offsetHeight;
      setToolbarAppWidth((current) => current === width ? current : width);
      setToolbarAppHeight((current) => current === height ? current : height);
      setToolbarBaseHeight((current) => current === baseHeight ? current : baseHeight);
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(app);
    observer.observe(toolbarGroups);
    return () => observer.disconnect();
  }, []);

  const active = docs.find((d) => d.id === activeId) ?? null;
  const updateSelection = (markupIds: string[], pageObjectIds: string[], calloutIds: string[] = []) => {
    setSelectedMarkupIds(markupIds);
    setSelectedCalloutIds(calloutIds);
    setSelectedPageObjectIds(pageObjectIds);
    setSelectedId(markupIds[markupIds.length - 1] ?? null);
  };
  useEffect(() => {
    updateSelection([], []);
  }, [activeId, active?.page]);
  useEffect(() => {
    searchRun.current += 1;
    setSearchMatches([]);
    setSearchHitIndex(-1);
    setSearchDocumentId('');
    setSearchBusy(false);
    setSearchError('');
    setSearchNavigation(null);
  }, [active?.id]);
  useEffect(() => {
    const pending = pendingMarkupSelection.current;
    if (!pending) return;
    if (!active || active.id !== pending.docId) {
      pendingMarkupSelection.current = null;
      return;
    }
    const markup = active.markups.find((item) => item.id === pending.markupId);
    if (!markup) {
      pendingMarkupSelection.current = null;
      return;
    }
    if (markup.page === active.page) {
      pendingMarkupSelection.current = null;
      updateSelection([markup.id], []);
    }
  }, [active?.id, active?.page]);
  const selectedSignature = signatures.find((signature) => signature.id === signatureId) ?? null;
  const contentTool: PageContentTool | null = contentMode === 'text'
    ? { kind: 'text', size: contentSize, color: contentColor }
    : contentMode === 'symbol'
      ? { kind: 'symbol', symbol: contentSymbol, size: contentSize, color: contentColor }
      : contentMode === 'signature' && selectedSignature
        ? { kind: 'signature', signature: selectedSignature }
        : null;
  const logout = async () => {
    await leaveAll();
    const localDocs = docs.filter((d) => !d.shared);
    setDocs(localDocs);
    if (active?.shared) setActiveId(localDocs.at(-1)?.id ?? '');
    await actions.logout();
  };
  const openSharedLibrary = () => {
    if (actions.signedIn) setLibrary(true);
    else if (actions.requestSignIn) actions.requestSignIn(() => setLibrary(true));
    else setLibrary(true);
  };
  const say = useCallback((m: string) => { setMsg(m); setSavedPdfPath(null); }, []);
  const setSavedSignatures = (next: SavedSignature[]) => {
    try {
      saveSignatures(next);
      signatureListRef.current = next;
      setSignatures(next);
      setSignatureError('');
    } catch (error) {
      setSignatureError(error instanceof Error ? error.message : String(error));
    }
  };
  const addSignatures = async (files: FileList | null, removeBackground: boolean) => {
    if (!files) return;
    let firstAdded: string | null = null;
    for (const file of Array.from(files)) {
      try {
        const signature = await importSignature(file, signatureListRef.current, removeBackground);
        const next = [...signatureListRef.current, signature];
        setSavedSignatures(next);
        if (!firstAdded) firstAdded = signature.id;
      } catch (error) {
        setSignatureError(error instanceof Error ? error.message : String(error));
      }
    }
    if (!signatureId && firstAdded) setSignatureId(firstAdded);
  };

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

  const addDocs = useCallback(async (files: PickedFile[], activate = true, fitPage = false) => {
    for (const f of files) {
      try {
        const d = await createDoc(f.name, f.data, f.path, false, { fitPage });
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
    const api = window.api;
    if (!api) return;
    let active = true;
    const onFiles = (files: PickedFile[], error?: string) => {
      if (!active) return;
      if (error) return say(`Could not open the requested PDF: ${error}`);
      if (files.length) void addDocs(files, true, true);
    };
    const unsubscribe = api.onOpenFiles(onFiles);
    void api.startupFiles().then((files) => onFiles(files)).catch((error) => onFiles([], error instanceof Error ? error.message : String(error)));
    void api.consumeOpenFiles().then((files) => onFiles(files)).catch((error) => onFiles([], error instanceof Error ? error.message : String(error)));
    return () => { active = false; unsubscribe(); };
  }, [addDocs, say]);

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
    updateSelection([m.id], []);
    if (isMeasure(m.type)) {
      setRightTab('measure');
      setRightPanelVisible(true);
    }
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
    !viewOnly && active && (() => {
      const target = active.markups.find((markup) => markup.id === id);
      const watermarkId = target?.watermarkId;
      return commit(active.id, active.markups.map((markup) =>
        markup.id === id || (!!watermarkId && markup.watermarkId === watermarkId) ? { ...markup, ...patch } : markup), key);
    })();

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
  const beginEditComments = (markupId: string) => {
    if (!active || viewOnly) return;
    const markup = active.markups.find((item) => item.id === markupId);
    if (!markup || !markup.comments.some((comment) => canEditComment(comment, user))) return;
    setEditingCommentsTarget({ docId: active.id, markupId });
  };
  const saveEditedComments = (edits: Record<string, string>) => {
    if (!active || !editingCommentsTarget || active.id !== editingCommentsTarget.docId || viewOnly) return;
    const markup = active.markups.find((item) => item.id === editingCommentsTarget.markupId);
    if (!markup) return;
    const editedAt = new Date().toISOString();
    const comments = markup.comments.map((comment) => {
      const text = edits[comment.id]?.trim();
      return text && canEditComment(comment, user) && text !== comment.text
        ? { ...comment, text, edited: editedAt }
        : comment;
    });
    updateMarkup(markup.id, { comments });
    setEditingCommentsTarget(null);
  };

  const deleteMarkup = (id: string) => {
    if (!active || viewOnly) return;
    const target = active.markups.find((m) => m.id === id);
    const targets = target?.watermarkId
      ? active.markups.filter((markup) => markup.watermarkId === target.watermarkId)
      : target ? [target] : [];
    if (targets.some((markup) => !canDeleteMarkup(markup, user))) {
      window.alert('Only the author of a markup can delete it.');
      return;
    }
    const ids = new Set(targets.map((markup) => markup.id));
    commit(active.id, active.markups.filter((m) => !ids.has(m.id)));
    updateSelection([], []);
  };

  const openWatermarkDialog = () => {
    if (!active || readOnly) return;
    setWatermarkPages(`1-${active.numPages}`);
    setWatermarkFile(null);
    setWatermarkDialogOpen(true);
  };
  const chooseWatermarkFile = async () => {
    if (!window.api) {
      window.alert('File import is unavailable.');
      return;
    }
    try {
      const filters = watermarkKind === 'pdf'
        ? [{ name: 'PDF documents', extensions: ['pdf'] }]
        : [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }];
      const [file] = await window.api.openFiles({ multi: false, filters });
      if (file) setWatermarkFile(file);
    } catch (error) {
      window.alert(`Could not choose watermark source: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const addWatermark = async () => {
    if (!active || readOnly) return;
    const doc = active;
    try {
      const pages = parseWatermarkPages(watermarkPages, doc.numPages);
      if (watermarkKind === 'text' && !watermarkText.trim()) throw new Error('Enter watermark text.');
      if (watermarkKind !== 'text' && !watermarkFile) throw new Error('Choose an image or PDF source.');
      const image = watermarkKind === 'text' ? undefined : await importStamp(watermarkFile!, (total) => {
        const answer = window.prompt(`Choose a PDF page from 1 to ${total}:`, '1');
        return answer === null ? null : Number(answer);
      });
      if (watermarkKind !== 'text' && !image) return;
      if (active?.id !== doc.id) return;
      const watermarkId = uid();
      const markups: Markup[] = [];
      for (const pageIndex of pages) {
        const page = await doc.pdf.getPage(pageIndex + 1);
        const viewport = page.getViewport({ scale: 1 });
        const maxWidth = viewport.width * 0.78;
        const maxHeight = viewport.height * (watermarkKind === 'text' ? 0.18 : 0.4);
        const fontSize = Math.max(12, Math.min(viewport.height * 0.14, maxWidth / Math.max(1, watermarkText.trim().length * 0.62)));
        const width = watermarkKind === 'text'
          ? Math.min(maxWidth, Math.max(fontSize * 2, watermarkText.trim().length * fontSize * 0.62))
          : Math.min(maxWidth, maxHeight * (image!.width / image!.height));
        const height = watermarkKind === 'text' ? Math.min(maxHeight, fontSize * 1.5) : width / (image!.width / image!.height);
        const extra: Partial<Markup> = {
          watermark: true,
          watermarkKind,
          watermarkId,
          watermarkName: watermarkKind === 'text' ? watermarkText.trim() : watermarkFile!.name,
          rotation: watermarkRotation,
          opacity: watermarkOpacity,
          ...(image ? { image, imageLockAspectRatio: true } : { stamp: watermarkText.trim(), fontSize }),
        };
        markups.push(makeMarkup(
          watermarkKind === 'text' ? 'stamp' : 'image',
          pageIndex,
          [
            { x: (viewport.width - width) / 2, y: (viewport.height - height) / 2 },
            { x: (viewport.width + width) / 2, y: (viewport.height + height) / 2 },
          ],
          {
            ...defaultStyle(watermarkKind === 'text' ? 'stamp' : 'image'),
            color: watermarkColor,
            opacity: watermarkOpacity,
            ...(watermarkKind === 'text' ? { stamp: watermarkText.trim(), fontSize } : {}),
          },
          author,
          extra,
        ));
      }
      if (active?.id !== doc.id) return;
      commit(doc.id, [...doc.markups, ...markups.map((markup) => ({ ...markup, authorEmail: user.email }))]);
      const selectedMarkup = markups.find((markup) => markup.page === doc.page) ?? markups[0];
      updateSelection([selectedMarkup.id], []);
      setTool('select');
      setWatermarkDialogOpen(false);
      setRightTab('watermarks');
      setRightPanelVisible(true);
      say(`Watermark added to ${pages.length} page${pages.length === 1 ? '' : 's'}.`);
    } catch (error) {
      window.alert(`Could not add watermark: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const contextSelectionIds = () => {
    const markupIds = contextMenu?.calloutOnly ? selectedMarkupIds : contextMenu?.markupId && selectedMarkupIds.includes(contextMenu.markupId)
      ? selectedMarkupIds
      : contextMenu?.markupId ? [contextMenu.markupId] : selectedMarkupIds;
    const objectIds = contextMenu?.pageObjectId && selectedPageObjectIds.includes(contextMenu.pageObjectId)
      ? selectedPageObjectIds
      : contextMenu?.pageObjectId ? [contextMenu.pageObjectId] : selectedPageObjectIds;
    return { markupIds, objectIds };
  };
  const contextGroupSelection = () => {
    const ids = contextSelectionIds();
    const markupIds = [...new Set([...ids.markupIds, ...(contextMenu?.calloutId ? [contextMenu.calloutId] : [])])];
    return expandGroupedSelection(active?.markups ?? [], active?.pageObjects ?? [], active?.page ?? 0, markupIds, ids.objectIds);
  };
  const canGroupContextSelection = () => {
    if (!active || readOnly) return false;
    const selection = contextGroupSelection();
    const markups = active.markups.filter((markup) => selection.markupIds.includes(markup.id));
    const objects = active.pageObjects.filter((object) => selection.pageObjectIds.includes(object.id));
    return markups.length + objects.length >= 2 &&
      markups.every((markup) => canDeleteMarkup(markup, user)) &&
      (!active.shared || objects.length === 0);
  };
  const contextHasGroup = () => {
    if (!active) return false;
    const selection = contextGroupSelection();
    return active.markups.some((markup) => selection.markupIds.includes(markup.id) && !!markup.groupId) ||
      active.pageObjects.some((object) => selection.pageObjectIds.includes(object.id) && !!object.groupId);
  };
  const groupContextSelection = () => {
    if (!active || !canGroupContextSelection()) return;
    const selection = contextGroupSelection();
    const grouped = groupItems(active.markups, active.pageObjects, selection.markupIds, selection.pageObjectIds, uid());
    commit(active.id, grouped.markups);
    updateDoc(active.id, () => ({ pageObjects: grouped.pageObjects, dirty: true }));
    updateSelection(selection.markupIds, selection.pageObjectIds);
    setContextMenu(null);
  };
  const ungroupContextSelection = () => {
    if (!active || readOnly) return;
    const selection = contextGroupSelection();
    if (active.shared && (selection.pageObjectIds.length > 0 ||
        active.markups.some((markup) => selection.markupIds.includes(markup.id) && !canDeleteMarkup(markup, user)))) return;
    const ungrouped = ungroupItems(active.markups, active.pageObjects, selection.markupIds, selection.pageObjectIds);
    if (!ungrouped.changed) return;
    commit(active.id, ungrouped.markups);
    updateDoc(active.id, () => ({ pageObjects: ungrouped.pageObjects, dirty: true }));
    updateSelection(selection.markupIds, selection.pageObjectIds);
    setContextMenu(null);
  };
  const selectedGroupMembers = () => expandGroupedSelection(active?.markups ?? [], active?.pageObjects ?? [], active?.page ?? 0, selectedMarkupIds, selectedPageObjectIds);
  const canGroupSelected = () => {
    if (!active || readOnly) return false;
    const selection = selectedGroupMembers();
    const markups = active.markups.filter((markup) => selection.markupIds.includes(markup.id));
    const objects = active.pageObjects.filter((object) => selection.pageObjectIds.includes(object.id));
    return markups.length + objects.length >= 2 &&
      markups.every((markup) => canDeleteMarkup(markup, user)) &&
      (!active.shared || objects.length === 0);
  };
  const canUngroupSelected = () => {
    if (!active || readOnly) return false;
    const selection = selectedGroupMembers();
    if (active.shared && selection.pageObjectIds.length > 0) return false;
    const markups = active.markups.filter((markup) => selection.markupIds.includes(markup.id));
    if (markups.some((markup) => !canDeleteMarkup(markup, user))) return false;
    return markups.some((markup) => !!markup.groupId) ||
      active.pageObjects.some((object) => selection.pageObjectIds.includes(object.id) && !!object.groupId);
  };
  const groupSelected = () => {
    if (!active || !canGroupSelected()) return;
    const selection = selectedGroupMembers();
    const grouped = groupItems(active.markups, active.pageObjects, selection.markupIds, selection.pageObjectIds, uid());
    commit(active.id, grouped.markups);
    updateDoc(active.id, () => ({ pageObjects: grouped.pageObjects, dirty: true }));
    updateSelection(selection.markupIds, selection.pageObjectIds);
  };
  const ungroupSelected = () => {
    if (!active || !canUngroupSelected()) return;
    const selection = selectedGroupMembers();
    const ungrouped = ungroupItems(active.markups, active.pageObjects, selection.markupIds, selection.pageObjectIds);
    if (!ungrouped.changed) return;
    commit(active.id, ungrouped.markups);
    updateDoc(active.id, () => ({ pageObjects: ungrouped.pageObjects, dirty: true }));
    updateSelection(selection.markupIds, selection.pageObjectIds);
  };
  const canCutSelection = () => {
    if (!active || readOnly || (active.shared && selectedPageObjectIds.length > 0)) return false;
    return selectedMarkupIds.length + selectedPageObjectIds.length > 0 &&
      selectedMarkupIds.every((id) => {
        const markup = active.markups.find((item) => item.id === id);
        return !!markup && canDeleteMarkup(markup, user);
      });
  };
  const canCutContextSelection = () => {
    if (!active || readOnly) return false;
    const ids = contextSelectionIds();
    const markups = active.markups.filter((markup) => ids.markupIds.includes(markup.id));
    const objects = active.pageObjects.filter((object) => ids.objectIds.includes(object.id));
    return (markups.length > 0 || objects.length > 0) &&
      (!active.shared || objects.length === 0) &&
      markups.every((markup) => canDeleteMarkup(markup, user));
  };
  const copySelection = (useContextTarget = false) => {
    if (!active) return;
    const ids = useContextTarget ? contextSelectionIds() : { markupIds: selectedMarkupIds, objectIds: selectedPageObjectIds };
    const markups = active.markups.filter((markup) => ids.markupIds.includes(markup.id)).map((markup) => ({
      ...markup,
      points: markup.points.map((point) => ({ ...point })),
      comments: [],
    }));
    const pageObjects = active.pageObjects.filter((object) => ids.objectIds.includes(object.id)).map((object) => ({ ...object }));
    if (markups.length || pageObjects.length) setClipboardSelection({ markups, pageObjects });
    setContextMenu(null);
  };
  const cutSelection = (useContextTarget = false) => {
    if (!active || readOnly) return;
    const ids = useContextTarget ? contextSelectionIds() : { markupIds: selectedMarkupIds, objectIds: selectedPageObjectIds };
    const markups = active.markups.filter((markup) => ids.markupIds.includes(markup.id));
    const pageObjects = active.pageObjects.filter((object) => ids.objectIds.includes(object.id));
    if (!markups.length && !pageObjects.length) return;
    if (active.shared && pageObjects.length) return;
    if (!markups.every((markup) => canDeleteMarkup(markup, user))) return;
    setClipboardSelection({
      markups: markups.map((markup) => ({ ...markup, points: markup.points.map((point) => ({ ...point })), comments: [] })),
      pageObjects: pageObjects.map((object) => ({ ...object })),
    });
    if (markups.length) commit(active.id, active.markups.filter((markup) => !ids.markupIds.includes(markup.id)));
    if (pageObjects.length) updateDoc(active.id, (document) => ({
      pageObjects: document.pageObjects.filter((object) => !ids.objectIds.includes(object.id)),
      dirty: true,
    }));
    updateSelection([], []);
    setContextMenu(null);
  };
  const deleteSelection = () => {
    if (!active || readOnly) return;
    const markups = active.markups.filter((markup) => selectedMarkupIds.includes(markup.id) && canDeleteMarkup(markup, user));
    const pageObjects = active.shared ? [] : active.pageObjects.filter((object) => selectedPageObjectIds.includes(object.id));
    if (markups.length) commit(active.id, active.markups.filter((markup) => !markups.some((item) => item.id === markup.id)));
    if (pageObjects.length) updateDoc(active.id, (document) => ({
      pageObjects: document.pageObjects.filter((object) => !pageObjects.some((item) => item.id === object.id)),
      dirty: true,
    }));
    updateSelection([], []);
  };
  const pasteSelection = (point?: Pt) => {
    if (!active || readOnly || (!clipboardSelection.markups.length && !clipboardSelection.pageObjects.length)) return;
    const availablePageObjects = active.shared ? [] : clipboardSelection.pageObjects;
    if (!clipboardSelection.markups.length && !availablePageObjects.length) return;
    const items = [
      ...clipboardSelection.markups.map((markup) => markupSelectionBounds(markup)),
      ...availablePageObjects.map((object) => ({ x: object.x, y: object.y, w: object.width, h: object.height })),
    ];
    const x = Math.min(...items.map((item) => item.x));
    const y = Math.min(...items.map((item) => item.y));
    const right = Math.max(...items.map((item) => item.x + item.w));
    const bottom = Math.max(...items.map((item) => item.y + item.h));
    const target = point ?? { x: (x + right) / 2 + 20, y: (y + bottom) / 2 + 20 };
    const dx = target.x - (x + right) / 2;
    const dy = target.y - (y + bottom) / 2;
    const markups = clipboardSelection.markups.map((markup) => ({
      ...translate(markup, dx, dy),
      id: uid(),
      page: active.page,
      author: user.name,
      authorEmail: user.email,
      date: new Date().toISOString(),
      status: 'None' as Markup['status'],
      comments: [],
    }));
    const pageObjects = availablePageObjects.map((object) => ({
      ...object,
      id: uid(),
      page: active.page,
      x: object.x + dx,
      y: object.y + dy,
    }));
    if (!markups.length && !pageObjects.length) return;
    if (markups.length) commit(active.id, [...active.markups, ...markups]);
    if (pageObjects.length) updateDoc(active.id, (document) => ({ pageObjects: [...document.pageObjects, ...pageObjects], dirty: true }));
    updateSelection(markups.map((markup) => markup.id), pageObjects.map((object) => object.id));
    setContextMenu(null);
    say('Selection pasted.');
  };

  const stackContextLayer = (direction: 'front' | 'back') => {
    if (!active || !contextMenu) return;
    const id = contextMenu.stackId;
    if (!id || active.shared || readOnly) return;
    const pageMarkups = active.markups.filter((markup) => markup.page === active.page && markup.type === 'stamp');
    const pageObjects = active.pageObjects.filter((object) => object.page === active.page);
    const reordered = reorderPageLayers(pageMarkups, pageObjects, id, direction);
    if (!reordered.changed) return;
    const markupOrder = new Map(reordered.markups.map((markup) => [markup.id, markup]));
    const objectOrder = new Map(reordered.pageObjects.map((object) => [object.id, object]));
    updateDoc(active.id, () => ({
      markups: active.markups.map((markup) => markupOrder.get(markup.id) ?? markup),
      pageObjects: active.pageObjects.map((object) => objectOrder.get(object.id) ?? object),
      dirty: true,
    }));
    setContextMenu(null);
    say(direction === 'front' ? 'Object brought to front.' : 'Object sent to back.');
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
      const flattenedLayers = await flattenStackableLayers(
        document.bytes,
        stateOf(document),
        document.pageObjects,
        targets.filter((markup) => markup.type === 'stamp').map((markup) => markup.id),
      );
      const remainingTargets = targets.filter((markup) => markup.type !== 'stamp');
      const result = remainingTargets.length
        ? await rasterizeMarkups(flattenedLayers.bytes, { ...stateOf(document), markups: flattenedLayers.markups }, remainingTargets.map((markup) => markup.id))
        : flattenedLayers;
      const pdf = await loadPdf(result.bytes);
      updateDoc(document.id, () => ({
        bytes: result.bytes,
        pdf,
        markups: result.markups,
        pageObjects: [],
        undo: [],
        redo: [],
        dirty: true,
      }));
      updateSelection([], []);
      say(`Flattened ${targets.length} markup(s) into the PDF. Save to keep the changes.`);
    } catch (error) {
      const message = 'Could not flatten markup(s): ' + (error instanceof Error ? error.message : String(error));
      say(message);
      window.alert(message);
    }
  };

  // ---- file ops -----
  const bake = async (d: Doc) => (await flattenStackableLayers(d.bytes, stateOf(d), d.pageObjects)).bytes;

  const createPageObject = (page: number, point: Pt) => {
    const documentId = active?.id;
    const placement = contentTool;
    if (!documentId || !placement || readOnly) return;
    if (active?.shared) {
      say('Text, symbol, and signature placement is not available in a live shared document. Open a local PDF copy to add page content.');
      setContentMode(null);
      return;
    }
    const object: PageObject = placement.kind === 'text'
      ? { id: uid(), page, kind: 'text', x: point.x, y: point.y, width: Math.max(50, placement.size * 6), height: placement.size * 1.5, fontSize: placement.size, color: placement.color, text: 'Text' }
      : placement.kind === 'symbol'
        ? { id: uid(), page, kind: 'symbol', x: point.x - placement.size / 2, y: point.y - placement.size / 2, width: placement.size, height: placement.size, fontSize: placement.size, color: placement.color, symbol: placement.symbol }
        : { id: uid(), page, kind: 'signature', x: point.x, y: point.y, width: 140, height: 140 * placement.signature.height / placement.signature.width, fontSize: 0, color: '#000000', signature: placement.signature };
    updateDoc(documentId, (document) => ({ pageObjects: [...document.pageObjects, object], dirty: true     }));
    updateSelection([], [object.id]);
    setContentMode(null);
    if (object.kind === 'text') {
      setPageObjectTextDraft(object.text ?? '');
      setEditingPageObjectId(object.id);
      setEditingPageObjectIsNew(true);
    } else {
      say(`${object.kind === 'symbol' ? 'Symbol' : 'Signature'} placed. Select and drag to move; drag the corner to resize.`);
    }
  };
  const updatePageObjects = (objects: PageObject[]) => {
    if (!active || active.shared || readOnly) return;
    updateDoc(active.id, () => ({ pageObjects: objects, dirty: true }));
  };
  const editPageObject = (id: string) => {
    const object = active?.pageObjects.find((item) => item.id === id);
    if (!object || object.kind !== 'text') return;
    setPageObjectTextDraft(object.text ?? '');
    setEditingPageObjectId(id);
    setEditingPageObjectIsNew(false);
  };
  const savePageObjectText = () => {
    if (!active || !editingPageObjectId || !pageObjectTextDraft.trim()) return;
    const text = pageObjectTextDraft.trim();
    updatePageObjects(active.pageObjects.map((object) => object.id === editingPageObjectId && object.kind === 'text'
      ? { ...object, text, width: Math.max(40, Math.max(...text.split(/\r?\n/).map((line) => line.length)) * object.fontSize * 0.62), height: Math.max(1, text.split(/\r?\n/).length) * object.fontSize * 1.35 }
      : object));
    setEditingPageObjectId(null);
    setEditingPageObjectIsNew(false);
    say('PDF text updated. Double-click the text to edit it again.');
  };
  const cancelPageObjectText = () => {
    if (editingPageObjectIsNew && active && editingPageObjectId) {
      updatePageObjects(active.pageObjects.filter((object) => object.id !== editingPageObjectId));
      updateSelection([], []);
    };
    setEditingPageObjectId(null);
    setEditingPageObjectIsNew(false);
  };

  const saveDocument = async (document: Doc, as = false): Promise<boolean> => {
    if (viewOnly || document.shared) return false;
    try {
      const bytes = await bake(document);
      const path = await saveBytes(document.name, bytes, 'pdf', as ? undefined : document.path);
      if (!path) return false;
      updateDoc(document.id, () => ({ path, name: baseName(path), dirty: false }));
      setMsg(`Saved ${baseName(path)} with ${document.markups.filter((markup) => markup.type !== 'stamp').length} markup annotation(s)`);
      setSavedPdfPath(path);
      return true;
    } catch (e) {
      const message = 'Save failed: ' + (e instanceof Error ? e.message : String(e));
      say(message);
      window.alert(message);
      return false;
    }
  };
  const save = async (as = false) => {
    if (active) await saveDocument(active, as);
  };

  const finishAppClose = async () => {
    setClosePromptBusy(true);
    try {
      await leaveAll();
    } catch (error) {
      say('Could not notify all shared-document sessions before closing: ' + (error instanceof Error ? error.message : String(error)));
    }
    setClosePromptOpen(false);
    setClosePromptBusy(false);
    window.api?.respondToAppClose(true);
  };

  const requestAppClose = () => {
    setClosePromptError('');
    if (docsRef.current.some((document) => document.dirty && !document.shared)) {
      setClosePromptOpen(true);
      return;
    }
    void finishAppClose();
  };
  closeRequestHandlerRef.current = requestAppClose;

  useEffect(() => {
    const api = window.api;
    if (!api) return;
    const unsubscribe = api.onAppCloseRequested(() => closeRequestHandlerRef.current());
    api.markCloseGuardReady();
    return unsubscribe;
  }, []);

  const cancelAppClose = () => {
    setClosePromptOpen(false);
    setClosePromptError('');
    window.api?.respondToAppClose(false);
  };

  const saveAllAndClose = async () => {
    if (closePromptBusy) return;
    setClosePromptBusy(true);
    setClosePromptError('');
    for (const document of docsRef.current.filter((item) => item.dirty && !item.shared)) {
      const saved = await saveDocument(document);
      if (!saved) {
        setClosePromptError(`Could not save ${document.name}. You can retry, discard the changes, or cancel closing.`);
        setClosePromptBusy(false);
        return;
      }
    }
    await finishAppClose();
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
        zoom: loadDocumentZoom(`shared:${info.id}`),
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
      const annotations = active.markups.filter((markup) => markup.type !== 'stamp');
      for (let i = 0; i < annotations.length;) {
        const batch = batchChanges(annotations.slice(i), []).upserts;
        const r = await window.api!.sharedDocs({ op: 'ops', id: up.doc.id, upserts: batch, cid });
        if (!r.ok) return fail(`Uploaded ${active.name}, but copying existing markups failed: ${r.error || 'unknown error'}`);
        i += batch.length;
      }
      const message = `Uploaded ${active.name} with ${annotations.length} markup(s). Open it from the list to collaborate; this tab stays a local copy.`;
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
      pageObjects: [],
      calibrations: fresh.calibrations,
      sheets: fresh.sheets,
      bookmarks,
      undo: [],
      redo: [],
      dirty: true,
      page: Math.max(0, Math.min(fresh.numPages - 1, page)),
      textCache: new Map(),
    }));
    updateSelection([], []);
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

  const rotateCurrentPage = async (rotation: 90 | -90) => {
    if (!active || active.shared || readOnly || view !== 'viewer') return;
    try {
      const rotated = await rotatePage(active.bytes, active.page, rotation);
      const bytes = await saveWithState(rotated, stateOf(active));
      const pdf = await loadPdf(bytes);
      updateDoc(active.id, () => ({ bytes, pdf, dirty: true }));
      say(`Rotated page ${active.page + 1} ${rotation > 0 ? 'clockwise' : 'counter-clockwise'}`);
    } catch (error) {
      say(`Could not rotate page: ${error instanceof Error ? error.message : String(error)}`);
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
  const changeSearchText = (text: string) => {
    searchRun.current += 1;
    setSearchText(text);
    setSearchMatches([]);
    setSearchHitIndex(-1);
    setSearchDocumentId('');
    setSearchBusy(false);
    setSearchError('');
    setSearchNavigation(null);
  };
  const setSearchNavigationTo = (docId: string, match: PdfTextMatch) => {
    setSearchNavigation({
      docId,
      page: match.page,
      y: (match.points[0].y + match.points[3].y) / 2,
      token: ++searchNavigationToken.current,
    });
  };
  const runTextSearch = async () => {
    if (!active) return;
    const query = searchText.trim();
    if (!query) {
      changeSearchText('');
      return;
    }
    const doc = active;
    const request = ++searchRun.current;
    setSearchMatches([]);
    setSearchHitIndex(-1);
    setSearchDocumentId(doc.id);
    setSearchBusy(true);
    setSearchError('');
    try {
      const matches = await searchTextMatches(doc.pdf, query);
      if (request !== searchRun.current || activeIdRef.current !== doc.id) return;
      setSearchMatches(matches);
      if (matches.length) {
        setSearchHitIndex(0);
        goto(matches[0].page);
        setSearchNavigationTo(doc.id, matches[0]);
      }
    } catch (error) {
      if (request === searchRun.current && activeIdRef.current === doc.id) {
        const message = `Text search failed: ${error instanceof Error ? error.message : String(error)}`;
        setSearchError(message);
        say(message);
      }
    } finally {
      if (request === searchRun.current) setSearchBusy(false);
    }
  };
  const navigateSearchHit = (direction: -1 | 1) => {
    if (!active || searchDocumentId !== active.id || searchMatches.length === 0) return;
    const index = nextSearchHitIndex(searchHitIndex, searchMatches.length, direction);
    const match = searchMatches[index];
    setSearchHitIndex(index);
    goto(match.page);
    setSearchNavigationTo(active.id, match);
  };
  const closeSpellReview = () => {
    spellReviewRun.current++;
    setSpellReviewOpen(false);
    setSpellReviewBusy(false);
  };
  const runPdfSpellCheck = async () => {
    if (!active) return;
    const doc = active;
    const request = ++spellReviewRun.current;
    const api = window.api;
    setSpellReviewDocId(doc.id);
    setSpellReviewDocName(doc.name);
    setSpellReviewOpen(true);
    setSpellReviewBusy(true);
    setSpellReviewProgress(0);
    setSpellReviewResults([]);
    setSpellReviewMatches([]);
    setSpellReviewPagesWithText(0);
    setSpellReviewWordsChecked(0);
    setSpellReviewError('');
    try {
      if (!api) throw new Error('The spell checker is unavailable.');
      const result = await scanPdfSpelling(
        doc.pdf,
        (words) => api.checkSpellWords(words),
        (completed, total) => {
          if (spellReviewRun.current === request) setSpellReviewProgress(total ? Math.round(completed / total * 100) : 100);
        },
      );
      if (spellReviewRun.current !== request) return;
      setSpellReviewResults(result.issues);
      setSpellReviewMatches(result.issues.flatMap((issue) => issue.matches));
      setSpellReviewPagesWithText(result.pagesWithText);
      setSpellReviewWordsChecked(result.wordsChecked);
      say(result.issues.length
        ? `Found ${result.issues.length} possible spelling issue${result.issues.length === 1 ? '' : 's'} in ${doc.name}.`
        : 'No spelling issues found in searchable PDF text.');
    } catch (error) {
      if (spellReviewRun.current === request) {
        setSpellReviewError(`PDF spell check failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      if (spellReviewRun.current === request) setSpellReviewBusy(false);
    }
  };
  const navigateToSpellReviewPage = (page: number) => {
    if (!docs.some((doc) => doc.id === spellReviewDocId)) return;
    setView('viewer');
    setActiveId(spellReviewDocId);
    updateDoc(spellReviewDocId, () => ({ page: page - 1 }));
    closeSpellReview();
  };
  const addSpellReviewWord = async (word: string) => {
    const api = window.api;
    if (!api) return;
    try {
      await api.addSpellCheckerWord(word);
      setSpellReviewResults((issues) => issues.filter((issue) => issue.word.toLocaleLowerCase('en') !== word.toLocaleLowerCase('en')));
      setSpellReviewMatches((matches) => matches.filter((match) => match.word.toLocaleLowerCase('en') !== word.toLocaleLowerCase('en')));
      say(`“${word}” added to your personal dictionary.`);
    } catch (error) {
      setSpellReviewError(`Could not add “${word}” to the dictionary: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const clearSpellReviewHighlights = () => {
    spellReviewRun.current++;
    setSpellReviewOpen(false);
    setSpellReviewBusy(false);
    setSpellReviewResults([]);
    setSpellReviewMatches([]);
    setSpellReviewDocId('');
    setSpellReviewDocName('');
    setSpellReviewPagesWithText(0);
    setSpellReviewWordsChecked(0);
    setSpellReviewError('');
    say('Spelling highlights cleared.');
  };
  const setZoom = (z: number) => {
    if (!active) return;
    updateDoc(active.id, () => ({ zoom: z }));
    saveDocumentZoom(documentZoomKey(active), z);
  };
  const zoomBy = (f: number) => active && setZoom(Math.max(0.05, Math.min(8, (active.zoom || 1) * f)));

  // ---- keyboard -----
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e) => {
    if (spellReviewOpen) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSpellReview();
      }
      return;
    }
    if (commentTarget || defaultsOpen || licenseInfo || library || actions.uiBlocked || isTypingTarget(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (view === 'compare' && !mod && (key === 'v' || key === 'h' || e.code === 'Space')) return;
    const next = active && !readOnly ? toolForKey(e, tool) : null;
    const history = active && !readOnly ? historyShortcut(e) : null;
    if (mod && key === 'c' && (selectedMarkupIds.length || selectedPageObjectIds.length)) {
      e.preventDefault();
      copySelection();
    } else if (mod && key === 'x' && canCutSelection()) {
      e.preventDefault();
      cutSelection();
    } else if (mod && key === 'v' && (clipboardSelection.markups.length || clipboardSelection.pageObjects.length)) {
      e.preventDefault();
      pasteSelection();
    } else if (next) {
      e.preventDefault();
      chooseTool(next);
      setPending(null);
    } else if (mod && e.shiftKey && key === 'arrowright' && active && !readOnly && !active.shared && view === 'viewer') {
      e.preventDefault();
      void rotateCurrentPage(90);
    } else if (mod && e.shiftKey && key === 'arrowleft' && active && !readOnly && !active.shared && view === 'viewer') {
      e.preventDefault();
      void rotateCurrentPage(-90);
    } else if (history) {
      e.preventDefault();
      history === 'redo' ? redo() : undo();
    } else if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save(e.shiftKey);
    } else if (mod && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      open();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && tool === 'select') {
      if (selectedMarkupIds.length || selectedPageObjectIds.length) deleteSelection();
    } else if (e.key === 'Escape') {
      if (watermarkDialogOpen) setWatermarkDialogOpen(false);
      setTool('select');
      setPending(null);
      setContentMode(null);
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
    if (action.startsWith('toolbar:')) {
      const [, id, command] = action.split(':');
      if (['file', 'content', 'markup', 'measure'].includes(id) && (command === 'show' || command === 'hide')) {
        window.dispatchEvent(new CustomEvent('toolbar-visibility', { detail: { id, visible: command === 'show' } }));
      }
      return;
    }
    if (action.startsWith('spellcheck-language:')) {
      const language = action.slice('spellcheck-language:'.length);
      if (language !== 'en-US' && language !== 'en-GB') return;
      void window.api?.setSpellCheckerLanguage(language)
        .then((selected) => {
          setSpellcheckLanguage(selected);
          setMsg(`Spell check language: English (${selected === 'en-US' ? 'US' : 'UK'}).`);
        })
        .catch((error: unknown) => setMsg(`Could not change spell check language: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }
    if (action === 'quit') {
      void window.api?.quitApp();
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
      case 'shared': openSharedLibrary(); break;
      case 'logout': void logout(); break;
      case 'users': actions.manageUsers?.(); break;
      case 'password': actions.changePassword(); break;
      case 'close': if (active) closeDoc(active.id); break;
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'select': setTool('select'); setPending(null); break;
      case 'pan': setTool('hand'); setPending(null); break;
      case 'delete': if (selectedId) deleteMarkup(selectedId); break;
      case 'group': groupSelected(); break;
      case 'ungroup': ungroupSelected(); break;
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
      case 'measureLength': chooseTool('m-length'); setPending(null); setRightTab('measure'); break;
      case 'measurePolylength': chooseTool('m-polylength'); setPending(null); setRightTab('measure'); break;
      case 'measureSpline': chooseTool('m-spline'); setPending(null); setRightTab('measure'); break;
      case 'measureRadius': chooseTool('m-radius'); setPending(null); setRightTab('measure'); break;
      case 'measureDiameter': chooseTool('m-diameter'); setPending(null); setRightTab('measure'); break;
      case 'measureArea': chooseTool('m-area'); setPending(null); setRightTab('measure'); break;
      case 'measurePerimeter': chooseTool('m-perimeter'); setPending(null); setRightTab('measure'); break;
      case 'measureAngle': chooseTool('m-angle'); setPending(null); setRightTab('measure'); break;
      case 'measureCount': chooseTool('m-count'); setPending(null); setRightTab('measure'); break;
      case 'organizePanel': setRightTab('organize'); break;
      case 'sheetsPanel': setRightTab('sheets'); break;
      case 'searchPanel': setRightTab('search'); break;
      case 'spellcheckPdf': void runPdfSpellCheck(); break;
      case 'zoomIn':
        if (view === 'viewer') zoomBy(1.25);
        else if (view === 'compare') window.dispatchEvent(new CustomEvent('compare-zoom', { detail: 1.25 }));
        break;
      case 'zoomOut':
        if (view === 'viewer') zoomBy(1 / 1.25);
        else if (view === 'compare') window.dispatchEvent(new CustomEvent('compare-zoom', { detail: 1 / 1.25 }));
        break;
      case 'fitWidth': if (active && view === 'viewer') setFit((f) => ({ mode: 'width', n: f.n + 1 })); break;
      case 'fitPage': if (active && view === 'viewer') setFit((f) => ({ mode: 'page', n: f.n + 1 })); break;
      case 'shortcuts': window.alert('V: Select\nH: toggle Pan\nHold Space: temporary Pan\nCtrl+O: Open\nCtrl+S: Save\nCtrl+Shift+S: Save As\nCtrl+Shift+K: Check spelling in PDF\nCtrl+Shift+Right: Rotate page clockwise\nCtrl+Shift+Left: Rotate page counter-clockwise\nCtrl+= / Ctrl+-: Zoom in / out\nCtrl+Alt+L / Ctrl+Alt+R: toggle left / right panel\nCtrl+Z: Undo; Ctrl+Y or Ctrl+Shift+Z: Redo\nDelete: delete selected markup\nAlt+F/E/O/V/H: open menus'); break;
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
      signedIn: !!actions.signedIn, documentOpen: !!active, viewerActive: view === 'viewer', compareActive: view === 'compare', canUndo: !!active?.undo.length, canRedo: !!active?.redo.length,
      selected: !viewOnly && !!active && !!selectedId && !!active.markups.find((m) => m.id === selectedId && canDeleteMarkup(m, user)),
      canGroupSelected: canGroupSelected(),
      canUngroupSelected: canUngroupSelected(),
      canFlattenSelected: !viewOnly && !!active && !active.shared && !!active.markups.find((m) => m.id === selectedId && canDeleteMarkup(m, user)),
      canFlattenAll: !viewOnly && !!active && !active.shared && active.markups.some((markup) => canDeleteMarkup(markup, user)),
      serverMode: !!actions.serverMode, blocked: library || !!actions.uiBlocked || !!commentTarget || defaultsOpen || watermarkDialogOpen || !!licenseInfo || spellReviewOpen, viewOnly,
      spellcheckLanguage,
      toolbars: {
        file: toolbarLayouts.file?.visible ?? true,
        content: toolbarLayouts.content?.visible ?? true,
        markup: toolbarLayouts.markup?.visible ?? true,
        measure: toolbarLayouts.measure?.visible ?? true,
      },
    });
  }, [active, selectedId, selectedMarkupIds, selectedPageObjectIds, user, view, actions.serverMode, actions.signedIn, actions.uiBlocked, library, viewOnly, commentTarget, defaultsOpen, watermarkDialogOpen, licenseInfo, toolbarLayouts, spellcheckLanguage, spellReviewOpen]);
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
      if (patch.stampLockAspectRatio !== undefined) mp.stampLockAspectRatio = patch.stampLockAspectRatio;
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
        updateMarkup(selected.id, { stamp: 'Custom image', stampImage: image, stampLockAspectRatio: selected.stampLockAspectRatio !== false });
      } else {
        setStyles((s) => ({ ...s, stamp: { ...(s.stamp ?? defaultStyle('stamp')), stamp: 'Custom image', stampImage: image, stampLockAspectRatio: s.stamp?.stampLockAspectRatio !== false } }));
        setTool('stamp');
      }
      say('Custom stamp loaded. Click the drawing to place it.');
    } catch (e) {
      const message = 'Could not load stamp: ' + (e instanceof Error ? e.message : String(e));
      say(message);
      window.alert(message);
    }
  };
  const addImageMarkup = async (page: number, point: Pt) => {
    if (!active || readOnly || !window.api) return;
    try {
      const [file] = await window.api.openFiles({
        multi: false,
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }],
      });
      if (!file) return;
      const image = await importStamp(file, () => null);
      if (!image) return;
      const scale = Math.min(1, 120 / image.width, 120 / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      const markup = makeMarkup('image', page, [
        { x: point.x - width / 2, y: point.y - height / 2 },
        { x: point.x + width / 2, y: point.y + height / 2 },
      ], { ...toolStyle, image }, author, { image, imageLockAspectRatio: true });
      createMarkup(markup);
      say('Image markup added. Add a comment to describe it.');
    } catch (error) {
      say(`Could not add image markup: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const countOf = useMemo(() => active?.markups.filter((markup) => !isMeasure(markup.type) && !markup.watermark).length ?? 0, [active?.markups]);
  const watermarkCount = useMemo(() => groupWatermarks(active?.markups ?? []).length, [active?.markups]);
  const measurementCount = useMemo(() => active?.markups.filter((markup) => isMeasure(markup.type)).length ?? 0, [active?.markups]);
  const contextMarkup = contextMenu && active?.markups.find((markup) => markup.id === contextMenu.markupId && markup.page === active.page);
  const contextStackable = !!contextMenu?.stackId;
  const contextSelection = contextMenu ? contextGroupSelection() : { markupIds: [], pageObjectIds: [] };
  const contextSelectionSize = contextSelection.markupIds.length + contextSelection.pageObjectIds.length;
  const showGroupAction = contextSelectionSize > 1;
  const showUngroupAction = contextMenu ? contextHasGroup() : false;
  const flattenableCount = active?.markups.filter((markup) => canDeleteMarkup(markup, user)).length ?? 0;

  const toolBtn = (t: Tool) => (
    <button key={t} title={TOOL_HINT[t] || TOOL_LABEL[t]} className={tool === t ? 'on' : ''} onClick={() => { chooseTool(t); setPending(null); if (MEASURE_TOOLS.includes(t)) setRightTab('measure'); if (t === 'stamp') setDefaultsOpen(true); if (t === 'cloud') say('Click to add cloud vertices. Press Enter, double-click, or right-click to finish.'); if (t === 'm-radius') say('Click the circle center, then a point on its edge.'); if (t === 'm-diameter') say('Click two opposite points on the circle edge.'); }} disabled={!active || (viewOnly && t !== 'select' && t !== 'hand')}>
      {t === 'select' ? <SelectIcon theme={theme} /> : <ActionIcon name={TOOL_ICONS[t] ?? 'line'} className="tool-icon" />}<span className="toolbar-command-label">{TOOL_LABEL[t]}</span>
    </button>
  );

  return (
    <div className="app" ref={appRef} tabIndex={-1} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <NotificationBell api={actions.notifications ?? null} onSignIn={() => actions.requestSignIn?.()} onOpenShared={openSharedLibrary} onOpenNotification={(notification) => {
        if (notification.type === 'registration') actions.manageUsers?.();
        else openSharedLibrary();
      }} />
      <div className="toolbar-groups" ref={toolbarGroupsRef} hidden={!active}>
        <MovableToolbar id="file" label="File management" boundsRef={appRef} layouts={toolbarLayoutList} onLayoutChange={reportToolbarLayout}>
          <div className="bar">
            <button onClick={open} title="Open PDF (Ctrl+O)"><FolderIcon /><span className="toolbar-command-label">Open…</span></button>
            <button onClick={openSharedLibrary} title={actions.signedIn ? 'Open Shared Documents' : 'Sign in to open shared documents'}><FolderIcon /><span className="toolbar-command-label">Open Shared...</span></button>
            <button onClick={() => save(false)} disabled={!active || viewOnly} title="Save (Ctrl+S)"><SaveIcon /><span className="toolbar-command-label">Save</span></button>
            <button onClick={() => save(true)} disabled={!active || viewOnly} title="Save as"><SaveIcon inverted /><span className="toolbar-command-label">Save as…</span></button>
            <span className="sep" />
            <button onClick={() => void rotateCurrentPage(90)} disabled={!active || viewOnly || !!active.shared || view !== 'viewer'} title="Rotate current page clockwise (Ctrl+Shift+Right)" aria-label="Rotate current page clockwise"><ActionIcon name="rotate-cw" className="tool-icon" /><span className="toolbar-command-label">Rotate clockwise</span></button>
            <button onClick={() => void rotateCurrentPage(-90)} disabled={!active || viewOnly || !!active.shared || view !== 'viewer'} title="Rotate current page counter-clockwise (Ctrl+Shift+Left)" aria-label="Rotate current page counter-clockwise"><ActionIcon name="rotate-ccw" className="tool-icon" /><span className="toolbar-command-label">Rotate counter-clockwise</span></button>
            <span className="sep" />
            <button className={view === 'viewer' ? 'on' : ''} onClick={() => setView('viewer')} title="Viewer"><ActionIcon name="page" className="tool-icon" /><span className="toolbar-command-label">Viewer</span></button>
            <button className={view === 'compare' ? 'on' : ''} onClick={() => setView('compare')} disabled={readOnly || docs.length === 0} title="Compare"><ActionIcon name="compare" className="tool-icon" /><span className="toolbar-command-label">Compare</span></button>
            {viewOnly && <><span className="muted">Unlicensed viewing — editing is disabled.</span><button onClick={() => licenseStatus && setLicenseInfo(licenseStatus)} title="License information"><ActionIcon name="key" className="tool-icon" /><span className="toolbar-command-label">License information…</span></button><button onClick={onImportLicense} title="Import license"><ActionIcon name="open" className="tool-icon" /><span className="toolbar-command-label">Import license…</span></button></>}
          </div>
        </MovableToolbar>
        <MovableToolbar id="content" label="Content tools" boundsRef={appRef} layouts={toolbarLayoutList} onLayoutChange={reportToolbarLayout}>
          <div className="bar tools">
            {view === 'viewer' && <>{toolBtn('select')} {toolBtn('hand')} <span className="sep" /></>}
            <button onClick={undo} disabled={viewOnly || !active?.undo.length} title="Undo (Ctrl+Z)"><ActionIcon name="undo" className="tool-icon" /><span className="toolbar-command-label">Undo</span></button>
            <button onClick={redo} disabled={viewOnly || !active?.redo.length} title="Redo (Ctrl+Y)"><ActionIcon name="redo" className="tool-icon" /><span className="toolbar-command-label">Redo</span></button>
            <span className="sep" />
            <button className={contentMode === 'text' ? 'on' : ''} onClick={() => { setTool('select'); setContentMode(contentMode === 'text' ? null : 'text'); }} disabled={!active || readOnly || !!active.shared} title="Text: click the page to add editable PDF text"><ActionIcon name="text" className="tool-icon" /><span className="toolbar-command-label">Text</span></button>
            <button className={contentMode === 'symbol' ? 'on' : ''} onClick={() => { setTool('select'); setContentMode(contentMode === 'symbol' ? null : 'symbol'); }} disabled={!active || readOnly || !!active.shared} title="Symbol: place a flattened symbol"><ActionIcon name="symbol" className="tool-icon" /><span className="toolbar-command-label">Symbol</span></button>
            <button className={contentMode === 'signature' ? 'on' : ''} onClick={() => setSignatureManagerOpen(true)} disabled={!active || readOnly || !!active.shared} title="Signatures: manage and place transparent PNG signatures"><ActionIcon name="signature" className="tool-icon" /><span className="toolbar-command-label">Signatures</span></button>
            <button onClick={openWatermarkDialog} disabled={!active || readOnly} title="Add and manage text, image, or PDF watermarks"><ActionIcon name="stamp" className="tool-icon" /><span className="toolbar-command-label">Watermark</span></button>
            {contentMode === 'text' && (
              <span className="toolbar-content-controls">
                <input aria-label="PDF text size" type="number" min={6} max={96} value={contentSize} onChange={(e) => setContentSize(Math.max(6, Math.min(96, +e.target.value || 24)))} />
                <StandardColorPicker ariaLabel="PDF text color" value={contentColor} onChange={setContentColor} />
                <span className="muted small">Click page, then type</span>
              </span>
            )}
            {contentMode === 'symbol' && (
              <span className="toolbar-content-controls">
                <select aria-label="Symbol" value={contentSymbol} onChange={(e) => setContentSymbol(e.target.value as PdfSymbol)}>
                  {SYMBOLS.map((symbol) => <option key={symbol.value} value={symbol.value}>{symbol.glyph} {symbol.label}</option>)}
                </select>
                <input aria-label="Symbol size" type="number" min={12} max={96} value={contentSize} onChange={(e) => setContentSize(Math.max(12, Math.min(96, +e.target.value || 24)))} />
                <StandardColorPicker ariaLabel="Symbol color" value={contentColor} onChange={setContentColor} />
                <span className="muted small">Click page to place</span>
              </span>
            )}
          </div>
        </MovableToolbar>
        {view === 'viewer' && <>
          <MovableToolbar id="markup" label="Markup tools" boundsRef={appRef} layouts={toolbarLayoutList} onLayoutChange={reportToolbarLayout}>
            <div className="bar tools">{MARKUP_TOOLS.map(toolBtn)}</div>
          </MovableToolbar>
          <MovableToolbar id="measure" label="Measurement tools" boundsRef={appRef} layouts={toolbarLayoutList} onLayoutChange={reportToolbarLayout}>
            <div className="bar tools measurement-tools">
              {MEASURE_TOOLS.map(toolBtn)}
              <button className={rightTab === 'measure' ? 'on' : ''} onClick={() => setRightTab('measure')} disabled={!active || readOnly} title="Open measurements panel"><ActionIcon name="m-length" className="tool-icon" /><span className="toolbar-command-label">Measurements ({measurementCount})</span></button>
            </div>
          </MovableToolbar>
        </>}
      </div>
      <div className="toolbar-dock-reserve toolbar-dock-reserve-top" style={{ height: active ? toolbarReservations.top : 0 }} aria-hidden="true" />
      {readOnly && <div className="collab warn" role="status">Read-only viewer mode - a license is required to edit or save. <button onClick={() => licenseStatus && setLicenseInfo(licenseStatus)}>Activate...</button></div>}

      <div className="tabs-row" style={{ marginLeft: toolbarReservations.left, marginRight: toolbarReservations.right }}>
        <div className="tabs">
          {docs.map((d) => (
            <div key={d.id} className={'tab' + (d.id === activeId ? ' active' : '')} onClick={() => { setActiveId(d.id); updateSelection([], []); }} onDoubleClick={() => promptRename(d)} title={d.shared ? 'Shared document names cannot be changed here' : 'Double-click to rename this tab'}>
              {renamingId === d.id && !d.shared ? (
                <TabNameEditor key={d.id} name={d.name} onSave={(name) => { void renameDocument(d.id, name); setRenamingId(null); }} onCancel={() => setRenamingId(null)} />
              ) : <>
                {d.shared && <span title="Shared document on the server">☁ </span>}
                <span className="tab-document-name" style={{ fontSize: `${Math.max(8, Math.min(12, 300 / Math.max(d.name.length, 1)))}px` }}>{d.name}</span>
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
        {active && view === 'viewer' && (
          <div className="pdf-text-search" role="search" aria-label="Search text in active PDF">
            {spellReviewDocId === active.id && spellReviewMatches.length > 0 && (
              <button onClick={clearSpellReviewHighlights} title="Clear misspelling highlights">Clear spelling marks</button>
            )}
            <label htmlFor="pdf-text-search-input"><ActionIcon name="search" className="pdf-search-icon" /><span>Search Text</span></label>
            <input
              id="pdf-text-search-input"
              type="search"
              aria-label="Search Text"
              placeholder="Exact word"
              value={searchText}
              onChange={(event) => changeSearchText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                if (searchBusy) return;
                if (searchDocumentId === active.id && searchMatches.length > 0) navigateSearchHit(1);
                else void runTextSearch();
              }}
            />
            <button onClick={() => void runTextSearch()} disabled={searchBusy || !searchText.trim()} title="Search exact words in this PDF">Find</button>
            <span className={'pdf-search-count' + (searchError ? ' error' : '')} aria-live="polite" title={searchError || undefined}>
              {searchBusy ? 'Searching…' : searchError || (searchDocumentId === active.id && searchText.trim()
                ? searchMatches.length ? `${searchHitIndex + 1} of ${searchMatches.length}` : '0 matches'
                : '')}
            </span>
            <button onClick={() => navigateSearchHit(-1)} disabled={searchDocumentId !== active.id || searchMatches.length === 0} title="Previous match" aria-label="Previous search match"><ActionIcon name="left" className="pdf-search-nav-icon" /></button>
            <button onClick={() => navigateSearchHit(1)} disabled={searchDocumentId !== active.id || searchMatches.length === 0} title="Next match" aria-label="Next search match"><ActionIcon name="right" className="pdf-search-nav-icon" /></button>
          </div>
        )}
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

      <div className="main" style={{ marginLeft: active ? toolbarReservations.left : 0, marginRight: active ? toolbarReservations.right : 0 }}>
        {!active ? (
          <div className="empty">
            <h1>ThryvoPDF Markup Studio</h1>
            <p>Markups · Compare revisions · Organize drawing sets</p>
            <button className="primary big" onClick={open}>Open PDF…</button>
            <button className="big" onClick={openSharedLibrary} title={actions.signedIn ? 'Open shared documents' : 'Sign in to open shared documents'}>Shared Documents…</button>
            <p className="muted">or drag PDF files onto this window</p>
          </div>
        ) : view === 'compare' ? (
          <ComparePanel docs={docs} activeId={active.id} onOpenRevision={async () => addDocs(await pickFiles(), false)} onMessage={say} theme={theme} />
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
                  onOpenShared={actions.signedIn ? openShared : undefined}
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
                selectedMarkupIds={selectedMarkupIds}
                selectedCalloutIds={selectedCalloutIds}
                selectedPageObjectIds={selectedPageObjectIds}
                fit={fit}
                continuous={continuousScroll}
                onPageChange={goto}
                searchMatches={active.id === searchDocumentId ? searchMatches.map((match, index) => ({ ...match, index })) : []}
                spellcheckMatches={active.id === spellReviewDocId ? spellReviewMatches : []}
                activeSearchIndex={searchHitIndex}
                searchNavigation={searchNavigation?.docId === active.id ? searchNavigation : null}
                contentTool={contentTool}
                onCreatePageObject={createPageObject}
                onSelectionChange={(markupIds, pageObjectIds, calloutIds) => {
                  updateSelection(markupIds, pageObjectIds, calloutIds);
                  const selectedMarkup = active.markups.find((markup) => markup.id === markupIds[markupIds.length - 1]);
                  if (selectedMarkup) setRightTab(selectedMarkup.watermark ? 'watermarks' : isMeasure(selectedMarkup.type) ? 'measure' : 'markups');
                }}
                onPageObjectsChange={updatePageObjects}
                onEditPageObject={editPageObject}
                onAddImage={addImageMarkup}
                onEditComments={beginEditComments}
                onCreate={createMarkup}
                onBeginEdit={beginEdit}
                onLive={live}
                onZoom={setZoom}
                onViewportChange={(docId, left, top) => {
                  setDocs((all) => {
                    const document = all.find((item) => item.id === docId);
                    if (!document || (Math.abs((document.viewport?.left ?? 0) - left) <= 1 && Math.abs((document.viewport?.top ?? 0) - top) <= 1)) return all;
                    return all.map((item) => item.id === docId ? { ...item, viewport: { left, top } } : item);
                  });
                }}
                onContextMenu={(event, markupId, pageObjectId, point, calloutOnly = false) => {
                  const currentSelection = active.markups.find((markup) => markup.id === selectedId && markup.page === active.page)?.id ?? null;
                  const clickedMarkup = active.markups.find((markup) => markup.id === markupId && markup.page === active.page);
                  setContextMenu({
                    x: Math.max(4, Math.min(event.clientX, window.innerWidth - 220)),
                    y: Math.max(4, Math.min(event.clientY, window.innerHeight - 410)),
                    markupId: calloutOnly ? null : markupId ?? currentSelection,
                    calloutId: calloutOnly ? markupId : null,
                    pageObjectId,
                    stackId: pageObjectId ?? (clickedMarkup?.type === 'stamp' ? clickedMarkup.id : null),
                    point,
                    calloutOnly,
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
                <FloatingTools tool={tool} theme={theme} onTool={(t) => { chooseTool(t); setPending(null); }} />
                <span className="sep" />
                <button onClick={() => goto(active.page - 1)} title="Previous page" aria-label="Previous page"><ActionIcon name="left" className="tool-icon" /></button>
                <input className="pg" type="number" aria-label="Page number" min={1} max={active.numPages} value={active.page + 1} onChange={(e) => goto((+e.target.value || 1) - 1)} />
                <span>/ {active.numPages}</span>
                <button onClick={() => goto(active.page + 1)} title="Next page" aria-label="Next page"><ActionIcon name="right" className="tool-icon" /></button>
                <span className="sep" />
                <button className={continuousScroll ? 'on' : ''} aria-pressed={continuousScroll} onClick={() => setContinuousScroll((enabled) => !enabled)} title="Toggle continuous scrolling">Continuous</button>
                <span className="sep" />
                <button onClick={() => zoomBy(1 / 1.25)} title="Zoom out (Ctrl+-)" aria-label="Zoom out"><ActionIcon name="zoom-out" className="tool-icon" /></button>
                <span>{Math.round((active.zoom || 1) * 100)}%</span>
                <button onClick={() => zoomBy(1.25)} title="Zoom in (Ctrl+=)" aria-label="Zoom in"><ActionIcon name="zoom-in" className="tool-icon" /></button>
                <button onClick={() => setFit((f) => ({ mode: 'width', n: f.n + 1 }))} title="Fit width"><ActionIcon name="fit-width" className="tool-icon" />Width</button>
                <button onClick={() => setFit((f) => ({ mode: 'page', n: f.n + 1 }))} title="Fit page"><ActionIcon name="page" className="tool-icon" />Page</button>
              </div>
            </div>
            <div className="side right" id="right-panel" hidden={!rightPanelVisible}>
              <div className="ptabs">
                <button className={rightTab === 'markups' ? 'on' : ''} onClick={() => setRightTab('markups')}>Markups ({countOf})</button>
                <button className={rightTab === 'watermarks' ? 'on' : ''} onClick={() => setRightTab('watermarks')}>Watermarks ({watermarkCount})</button>
                <button className={rightTab === 'measure' ? 'on' : ''} onClick={() => setRightTab('measure')}>Measurements ({measurementCount})</button>
              </div>
              {rightTab === 'markups' && (
                <MarkupsPanel
                  mode="markups"
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
                      setTool('select');
                      if (m.page === active.page) {
                        pendingMarkupSelection.current = null;
                        updateSelection([id], []);
                      } else {
                        pendingMarkupSelection.current = { docId: active.id, markupId: id };
                        goto(m.page);
                      }
                    }
                  }}
                  onUpdate={updateMarkup}
                  onDelete={deleteMarkup}
                  onExport={(csv) => exportCsv(csv, downloadName(active.name, '-markups', 'csv'))}
                />
              )}
              {rightTab === 'measure' && (
                <div className="measurement-tab-content">
                  <MeasurePanel
                    doc={active}
                    pending={pending}
                    subject={subject}
                    onSubject={setSubject}
                    onTool={(t) => { setTool(t); setRightTab('measure'); say('Click two points of a known length on the drawing'); }}
                    onSetCal={setCal}
                    onClearPending={() => setPending(null)}
                    onExport={(csv) => exportCsv(csv, downloadName(active.name, '-takeoff', 'csv'))}
                    onMessage={say}
                  />
                  <MarkupsPanel
                    mode="measurements"
                    doc={active}
                    readOnly={readOnly}
                    selectedId={selectedId}
                    author={author}
                    user={user}
                    commentSize={commentSize}
                    onCommentSize={changeCommentSize}
                    onSelect={(id) => {
                      const measurement = active.markups.find((markup) => markup.id === id);
                      if (!measurement) return;
                      setTool('select');
                      if (measurement.page === active.page) {
                        pendingMarkupSelection.current = null;
                        updateSelection([id], []);
                      } else {
                        pendingMarkupSelection.current = { docId: active.id, markupId: id };
                        goto(measurement.page);
                      }
                    }}
                    onUpdate={updateMarkup}
                    onDelete={deleteMarkup}
                    onExport={() => undefined}
                  />
                </div>
              )}
              {rightTab === 'watermarks' && (
                <WatermarksManager
                  doc={active}
                  user={user}
                  readOnly={readOnly}
                  selectedId={selectedId}
                  onSelect={(id) => {
                    const markup = active.markups.find((item) => item.id === id);
                    if (!markup) return;
                    setTool('select');
                    setRightTab('watermarks');
                    setRightPanelVisible(true);
                    if (markup.page === active.page) {
                      pendingMarkupSelection.current = null;
                      updateSelection([id], []);
                    } else {
                      pendingMarkupSelection.current = { docId: active.id, markupId: id };
                      goto(markup.page);
                    }
                  }}
                  onUpdate={updateMarkup}
                  onDelete={deleteMarkup}
                />
              )}
            </div>
            {rightTab !== 'markups' && rightTab !== 'measure' && rightTab !== 'watermarks' && (
              <div className="modal" role="dialog" aria-modal="true" aria-label="Document tools">
                <div className="usermgmt tool-dialog">
                  <div className="row between"><b>{rightTab === 'organize' ? 'Organize pages' : rightTab === 'sheets' ? 'Sheet index' : 'Search documents'}</b><button onClick={() => setRightTab('markups')}>Close</button></div>
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
      <div className="toolbar-dock-reserve toolbar-dock-reserve-bottom" style={{ height: active ? toolbarReservations.bottom : 0 }} aria-hidden="true" />
      {contextMenu && active && (
        <div
          className="viewer-context-menu"
          ref={contextMenuRef}
          role="menu"
          aria-label="PDF viewer context menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button role="menuitem" disabled={!canCutContextSelection()} onClick={() => cutSelection(true)}><ContextMenuIcon action="cut" />Cut</button>
          <button role="menuitem" disabled={!contextMarkup && !contextMenu.pageObjectId && !selectedMarkupIds.length && !selectedPageObjectIds.length} onClick={() => copySelection(true)}><ContextMenuIcon action="copy" />Copy</button>
          <button role="menuitem" disabled={readOnly || (!clipboardSelection.markups.length && !clipboardSelection.pageObjects.length) || (!!active.shared && clipboardSelection.markups.length === 0)} onClick={() => pasteSelection(contextMenu.point)}><ContextMenuIcon action="paste" />Paste</button>
          {(showGroupAction || showUngroupAction) && <div className="context-menu-separator" />}
          {showGroupAction && <button role="menuitem" disabled={!canGroupContextSelection()} onClick={groupContextSelection}><ContextMenuIcon action="group" />Group</button>}
          {showUngroupAction && <button role="menuitem" disabled={readOnly || (active.shared && contextSelection.pageObjectIds.length > 0) || active.markups.some((markup) => contextSelection.markupIds.includes(markup.id) && !canDeleteMarkup(markup, user))} onClick={ungroupContextSelection}><ContextMenuIcon action="ungroup" />Ungroup</button>}
          <div className="context-menu-separator" />
          <button role="menuitem" onClick={() => { setTool('select'); setPending(null); setContextMenu(null); }}><ContextMenuIcon action="select" />Select</button>
          <button role="menuitem" onClick={() => { setTool('hand'); setContextMenu(null); }}><ContextMenuIcon action="pan" />Pan</button>
          <button role="menuitem" onClick={() => { zoomBy(1.25); setContextMenu(null); }}><ContextMenuIcon action="zoom-in" />Zoom In</button>
          <button role="menuitem" onClick={() => { zoomBy(1 / 1.25); setContextMenu(null); }}><ContextMenuIcon action="zoom-out" />Zoom Out</button>
          {contextStackable && (
            <>
              <div className="context-menu-separator" />
              <button role="menuitem" disabled={readOnly || !!active.shared} onClick={() => stackContextLayer('front')}><ContextMenuIcon action="bring-front" />Bring to Front</button>
              <button role="menuitem" disabled={readOnly || !!active.shared} onClick={() => stackContextLayer('back')}><ContextMenuIcon action="bring-back" />Bring to Back</button>
            </>
          )}
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
      {editingCommentsTarget && active?.id === editingCommentsTarget.docId && (() => {
        const markup = active.markups.find((item) => item.id === editingCommentsTarget.markupId);
        const comments = markup?.comments.filter((comment) => canEditComment(comment, user)) ?? [];
        return comments.length ? <EditCommentsPopup comments={comments} onSave={saveEditedComments} onCancel={() => setEditingCommentsTarget(null)} /> : null;
      })()}
      {editingPageObjectId && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Edit PDF text">
          <div className="usermgmt page-text-editor">
            <div className="row between"><b>{editingPageObjectIsNew ? 'Add PDF text' : 'Edit PDF text'}</b><button onClick={cancelPageObjectText}>Cancel</button></div>
            <p className="muted">This is editable PDF page text, not a markup annotation. Double-click it on the page to edit it later.</p>
            <textarea autoFocus aria-label="PDF text" spellCheck rows={4} value={pageObjectTextDraft} onChange={(e) => setPageObjectTextDraft(e.target.value)} onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                cancelPageObjectText();
              } else if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                savePageObjectText();
              }
            }} />
            <div className="row">
              <button className="primary" disabled={!pageObjectTextDraft.trim()} onClick={savePageObjectText}>Apply text</button>
              <button onClick={cancelPageObjectText}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {signatureManagerOpen && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Manage signatures">
          <div className="usermgmt signature-manager">
            <div className="row between"><b>Manage signatures</b><button onClick={() => setSignatureManagerOpen(false)}>Close</button></div>
            <p className="muted">Signatures are stored on this device and flattened into PDF page content when placed.</p>
            <label className="inline-check">
              <input type="checkbox" checked={removeSignatureBackground} onChange={(e) => setRemoveSignatureBackground(e.target.checked)} />
              Remove white background from uploaded PNGs
            </label>
            <p className="muted">Enable this for signatures scanned on white paper. It removes white and near-white pixels; leave it off for PNGs that already have transparency or contain white ink.</p>
            <input ref={signatureFileInput} type="file" accept="image/png,.png" multiple hidden onChange={(e) => { void addSignatures(e.currentTarget.files, removeSignatureBackground); e.currentTarget.value = ''; }} />
            <button onClick={() => signatureFileInput.current?.click()}>Upload PNG signatures...</button>
            {signatureError && <p className="warn" role="alert">{signatureError}</p>}
            {signatures.length === 0 ? <p className="muted">No signatures saved yet.</p> : (
              <div className="signature-list">
                {signatures.map((signature) => (
                  <div className="signature-item" key={signature.id}>
                    <label className="inline-check">
                      <input type="radio" name="active-signature" checked={signatureId === signature.id} onChange={() => setSignatureId(signature.id)} />
                      <img src={signature.data} alt="" />
                    </label>
                    <input aria-label="Signature name" value={signature.name} onChange={(e) => setSavedSignatures(signatures.map((item) => item.id === signature.id ? { ...item, name: e.target.value } : item))} />
                    <button className="danger" onClick={() => {
                      const next = signatures.filter((item) => item.id !== signature.id);
                      setSavedSignatures(next);
                      if (signatureId === signature.id) setSignatureId(next[0]?.id ?? null);
                      if (contentMode === 'signature' && signatureId === signature.id) setContentMode(null);
                    }}>Remove</button>
                  </div>
                ))}
              </div>
            )}
            <div className="row">
              <button className="primary" disabled={!selectedSignature} onClick={() => {
                if (!selectedSignature) return;
                setTool('select');
                setContentMode('signature');
                setSignatureManagerOpen(false);
                say(`Click the PDF page to place ${selectedSignature.name}.`);
              }}>Place selected signature</button>
              <button onClick={() => setSignatureManagerOpen(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
      {watermarkDialogOpen && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Add watermark">
          <div className="usermgmt tool-dialog watermark-dialog">
            <div className="row between"><b>Add watermark</b><button onClick={() => setWatermarkDialogOpen(false)}>Close</button></div>
            <p className="muted">Watermarks are editable markups. Resize with the page handles; edit, replace, or delete them in the Watermarks Manager.</p>
            <label>
              Watermark type
              <select value={watermarkKind} onChange={(event) => { setWatermarkKind(event.target.value as 'text' | 'image' | 'pdf'); setWatermarkFile(null); }}>
                <option value="text">Text</option>
                <option value="image">Image</option>
                <option value="pdf">PDF page</option>
              </select>
            </label>
            {watermarkKind === 'text' ? (
              <>
                <label>Text<textarea spellCheck rows={2} value={watermarkText} onChange={(event) => setWatermarkText(event.target.value)} /></label>
                <label>Text color<StandardColorPicker value={watermarkColor} onChange={setWatermarkColor} /></label>
              </>
            ) : (
              <div className="row">
                <button onClick={() => void chooseWatermarkFile()}>{watermarkFile ? 'Choose another source...' : `Choose ${watermarkKind === 'pdf' ? 'PDF' : 'image'}...`}</button>
                <span className="muted">{watermarkFile?.name ?? 'No source selected'}</span>
              </div>
            )}
            <label>
              Apply to pages
              <input aria-label="Watermark pages" value={watermarkPages} onChange={(event) => setWatermarkPages(event.target.value)} placeholder="1-3, 5" />
            </label>
            <label>
              Opacity ({Math.round(watermarkOpacity * 100)}%)
              <input type="range" min={0.05} max={1} step={0.05} value={watermarkOpacity} onChange={(event) => setWatermarkOpacity(+event.target.value)} />
            </label>
            <label>
              Rotation ({watermarkRotation}°)
              <input type="range" min={-180} max={180} step={1} value={watermarkRotation} onChange={(event) => setWatermarkRotation(+event.target.value)} />
            </label>
            <div className="row">
              <button className="primary" onClick={() => void addWatermark()}>Add watermark</button>
              <button onClick={() => setWatermarkDialogOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {defaultsOpen && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Tool defaults">
          <div className="usermgmt tool-dialog">
            <div className="row between"><b>Tool defaults and stamp</b><button onClick={() => setDefaultsOpen(false)}>Close</button></div>
            <p>Select a markup tool to set defaults, or select an existing markup to change its properties.</p>
            {!editingSelected && (tool === 'select' || tool === 'hand') ? <p>Choose a markup tool first.</p> : (
              <div className="props">
                <label>Color<StandardColorPicker value={shown.color} onChange={(color) => changeStyle({ color })} /></label>
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
              {(editingSelected ? !!selected?.stampImage : !!shown.stampImage) && (
                <label className="inline-check">
                  Lock aspect ratio
                  <input
                    type="checkbox"
                    checked={editingSelected ? selected?.stampLockAspectRatio !== false : shown.stampLockAspectRatio !== false}
                    onChange={(e) => changeStyle({ stampLockAspectRatio: e.target.checked })}
                  />
                </label>
              )}
            </>}
          </div>
        </div>
      )}
      {spellReviewOpen && (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="spell-review-title">
          <div className="usermgmt spell-review-dialog">
            <div className="row between">
              <h3 id="spell-review-title">Check spelling in PDF</h3>
              <div className="row">
                {spellReviewMatches.length > 0 && <button onClick={clearSpellReviewHighlights}>Clear highlights</button>}
                <button onClick={closeSpellReview}>Close</button>
              </div>
            </div>
            <p className="muted">{spellReviewDocName} · Checks selectable PDF text only; scanned pages require OCR.</p>
            {spellReviewBusy && <p role="status">Checking PDF text… {spellReviewProgress}%</p>}
            {spellReviewError && <p className="danger" role="alert">{spellReviewError}</p>}
            {!spellReviewBusy && !spellReviewError && spellReviewResults.length === 0 && (
              <p role="status">
                {spellReviewPagesWithText === 0
                  ? 'No selectable text was found. Scanned pages require OCR before they can be checked.'
                  : `No spelling issues found in ${spellReviewWordsChecked.toLocaleString()} words.`}
              </p>
            )}
            {!spellReviewBusy && spellReviewResults.length > 0 && (
              <>
                <p role="status">Found {spellReviewResults.length} possible misspellings across {spellReviewWordsChecked.toLocaleString()} words.</p>
                <div className="spell-review-results">
                  {spellReviewResults.map((issue) => (
                    <div className="spell-review-item" key={issue.word.toLocaleLowerCase('en')}>
                      <div>
                        <b>{issue.word}</b>
                        <div className="spell-review-pages">
                          {issue.pages.map((page) => <button key={page} onClick={() => navigateToSpellReviewPage(page)}>Page {page}</button>)}
                          <span className="muted small">{issue.occurrences} occurrence{issue.occurrences === 1 ? '' : 's'}</span>
                        </div>
                        <div className="muted small">Suggestions: {issue.suggestions.join(', ') || 'none'}</div>
                      </div>
                      <button onClick={() => void addSpellReviewWord(issue.word)}>Add to dictionary</button>
                    </div>
                  ))}
                </div>
              </>
            )}
            <div className="row"><button onClick={closeSpellReview}>Done</button></div>
          </div>
        </div>
      )}
      {licenseInfo && <LicenseInfo status={licenseInfo} onClose={() => setLicenseInfo(null)} onImport={viewOnly ? () => { setLicenseInfo(null); onImportLicense?.(); } : undefined} />}
      {closePromptOpen && (
        <div className="modal close-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="close-confirm-title">
          <div className="usermgmt close-confirm">
            <b id="close-confirm-title">Save changes before closing?</b>
            <p>The following PDFs have unsaved changes:</p>
            <ul>{docs.filter((document) => document.dirty && !document.shared).map((document) => <li key={document.id}>{document.name}</li>)}</ul>
            {closePromptError && <p className="danger" role="alert">{closePromptError}</p>}
            <div className="row close-confirm-actions">
              <button onClick={() => void finishAppClose()} disabled={closePromptBusy}>Don't Save</button>
              <button onClick={cancelAppClose} disabled={closePromptBusy}>Cancel</button>
              <button className="primary" onClick={() => void saveAllAndClose()} disabled={closePromptBusy || viewOnly}>Save All</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export type { MarkupType };
void readState;
