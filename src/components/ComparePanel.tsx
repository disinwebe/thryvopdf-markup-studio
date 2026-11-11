import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { useEffect, useRef, useState } from 'react';
import { Doc, downloadName, saveBytes, stateOf } from '../app/model';
import { CompareStats, Raster, autoAlign, compareRasters, COLOR_ADDED, COLOR_REMOVED } from '../core/compare';
import { prepareComparisonPdf } from '../core/comparePdf';
import { loadPdfForCompare, pageSize, renderRaster } from '../pdf/pdfjs';
import { ContextMenuIcon } from './ContextMenuIcon';
import { FloatingTools } from './FloatingTools';
import { ActionIcon } from './ActionIcon';

const BOX_W = 1800,
  BOX_H = 1300;

const shiftRaster = (r: Raster, dx: number, dy: number): Raster => {
  const out = new Uint8ClampedArray(r.data.length).fill(255);
  for (let y = 0; y < r.height; y++) {
    const sy = y - dy;
    if (sy < 0 || sy >= r.height) continue;
    for (let x = 0; x < r.width; x++) {
      const sx = x - dx;
      if (sx < 0 || sx >= r.width) continue;
      const o = (y * r.width + x) * 4,
        s = (sy * r.width + sx) * 4;
      out[o] = r.data[s];
      out[o + 1] = r.data[s + 1];
      out[o + 2] = r.data[s + 2];
    }
  }
  return { data: out, width: r.width, height: r.height };
};

function paint(c: HTMLCanvasElement | null, r: Raster | null) {
  if (!c || !r) return;
  c.width = r.width;
  c.height = r.height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height), 0, 0);
}

export function ComparePanel({
  docs,
  activeId,
  onOpenRevision,
  onMessage,
  theme,
}: {
  docs: Doc[];
  activeId: string;
  onOpenRevision(): void;
  onMessage(msg: string): void;
  theme: 'light' | 'dark';
}) {
  const [aId, setAId] = useState(activeId);
  const [bId, setBId] = useState(docs.find((d) => d.id !== activeId)?.id ?? activeId);
  const [aPage, setAPage] = useState(0);
  const [bPage, setBPage] = useState(0);
  const [mode, setMode] = useState<'overlay' | 'side' | 'ghost'>('overlay');
  const [tol, setTol] = useState(2);
  const [shift, setShift] = useState({ dx: 0, dy: 0 });
  const [zoom, setZoom] = useState(0.5);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<CompareStats | null>(null);
  const rasters = useRef<{ a: Raster; b: Raster } | null>(null);
  const overlay = useRef<Raster | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [panEnabled, setPanEnabled] = useState(false);
  const [spacePan, setSpacePan] = useState(false);
  const [panning, setPanning] = useState(false);
  const cOver = useRef<HTMLCanvasElement>(null);
  const cA = useRef<HTMLCanvasElement>(null);
  const cB = useRef<HTMLCanvasElement>(null);
  const compareView = useRef<HTMLDivElement>(null);
  const compareMenu = useRef<HTMLDivElement>(null);
  const panDrag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const panActive = panEnabled || spacePan;

  const docA = docs.find((d) => d.id === aId);
  const docB = docs.find((d) => d.id === bId);
  const fitZoom = (fit: 'width' | 'page', dimensions = size) => {
    const viewport = compareView.current;
    if (!viewport || !dimensions) return;
    const contentWidth = dimensions.w * (mode === 'side' ? 2 : 1) + (mode === 'side' ? 10 : 0);
    const availableWidth = Math.max(1, viewport.clientWidth - 40);
    const availableHeight = Math.max(1, viewport.clientHeight - 70);
    const scale = fit === 'width'
      ? availableWidth / contentWidth
      : Math.min(availableWidth / contentWidth, availableHeight / dimensions.h);
    setZoom(Math.max(0.05, Math.min(3, scale)));
    viewport.scrollTo({ left: 0, top: 0 });
  };

  useEffect(() => {
    if (!docs.find((d) => d.id === aId)) setAId(docs[0]?.id ?? '');
    if (!docs.find((d) => d.id === bId)) setBId(docs[docs.length - 1]?.id ?? '');
  }, [docs, aId, bId]);

  useEffect(() => {
    if (!contextMenu) return;
    const closeOutside = (event: PointerEvent) => {
      if (!compareMenu.current?.contains(event.target as Node)) setContextMenu(null);
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      const key = event.key.toLowerCase();
      if (!event.ctrlKey && !event.metaKey && key === 'v') {
        event.preventDefault();
        setPanEnabled(false);
        setSpacePan(false);
      } else if (!event.ctrlKey && !event.metaKey && key === 'h') {
        event.preventDefault();
        setSpacePan(false);
        setPanEnabled((enabled) => !enabled);
      } else if (event.code === 'Space' && !event.ctrlKey && !event.metaKey && !event.repeat) {
        event.preventDefault();
        setSpacePan(true);
      } else if ((event.ctrlKey || event.metaKey) && (key === '+' || key === '=')) {
        event.preventDefault();
        setZoom((value) => Math.min(3, value * 1.25));
      } else if ((event.ctrlKey || event.metaKey) && (key === '-' || key === '_')) {
        event.preventDefault();
        setZoom((value) => Math.max(0.05, value / 1.25));
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpacePan(false);
    };
    const handleMenuZoom = (event: Event) => {
      const factor = (event as CustomEvent<number>).detail;
      if (typeof factor === 'number' && factor > 0) setZoom((value) => Math.max(0.05, Math.min(3, value * factor)));
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('compare-zoom', handleMenuZoom);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('compare-zoom', handleMenuZoom);
    };
  }, []);

  const recompute = (t = tol, s = shift) => {
    const r = rasters.current;
    if (!r) return;
    const { overlay: ov, stats: st } = compareRasters(r.a, r.b, { tolerance: t, dx: s.dx, dy: s.dy });
    overlay.current = ov;
    setStats(st);
    draw(ov, s);
  };

  const draw = (ov: Raster | null = overlay.current, s = shift) => {
    const r = rasters.current;
    if (!r) return;
    if (mode === 'overlay' || mode === 'ghost') {
      if (ov && mode === 'overlay') paint(cOver.current, ov);
      if (ov && mode === 'ghost') {
        // faded sheet A under the colour-coded changes
        const g = new Uint8ClampedArray(ov.data);
        for (let i = 0; i < g.length; i += 4) {
          const isWhite = ov.data[i] === 255 && ov.data[i + 1] === 255 && ov.data[i + 2] === 255;
          if (isWhite) {
            const v = 255 - (255 - r.a.data[i]) * 0.18;
            g[i] = g[i + 1] = g[i + 2] = v;
          }
        }
        paint(cOver.current, { data: g, width: ov.width, height: ov.height });
      }
    } else {
      paint(cA.current, r.a);
      paint(cB.current, shiftRaster(r.b, s.dx, s.dy));
    }
  };

  useEffect(() => {
    // canvases mount after mode change; repaint once they exist
    const t = setTimeout(() => draw(), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, size]);

  const run = async () => {
    if (!docA || !docB) return onMessage('Open two PDFs (or a revision) to compare');
    setBusy(true);
    try {
      const [annotatedA, annotatedB] = await Promise.all([
        prepareComparisonPdf(docA.bytes, docA.pageObjects, stateOf(docA)),
        prepareComparisonPdf(docB.bytes, docB.pageObjects, stateOf(docB)),
      ]);
      const [pdfA, pdfB] = await Promise.all([
        loadPdfForCompare(annotatedA),
        loadPdfForCompare(annotatedB),
      ]);
      const sa = await pageSize(pdfA, aPage);
      const scale = Math.min(BOX_W / sa.w, BOX_H / sa.h);
      const w = Math.round(sa.w * scale),
        h = Math.round(sa.h * scale);
      try {
        const [ra, rb] = await Promise.all([renderRaster(pdfA, aPage, w, h), renderRaster(pdfB, bPage, w, h)]);
        rasters.current = { a: ra.raster, b: rb.raster };
      } finally {
        await Promise.all([pdfA.destroy(), pdfB.destroy()]);
      }
      setSize({ w, h });
      const zero = { dx: 0, dy: 0 };
      setShift(zero);
      recompute(tol, zero);
      requestAnimationFrame(() => fitZoom('page', { w, h }));
    } catch (e) {
      onMessage('Compare failed: ' + (e as Error).message);
    }
    setBusy(false);
  };

  const align = () => {
    const r = rasters.current;
    if (!r) return;
    const s = autoAlign(r.a, r.b, 60);
    setShift(s);
    recompute(tol, s);
    onMessage(`Auto-aligned: offset ${s.dx}, ${s.dy} px`);
  };

  const nudge = (dx: number, dy: number) => {
    const s = { dx: shift.dx + dx, dy: shift.dy + dy };
    setShift(s);
    recompute(tol, s);
  };

  const exportPng = async () => {
    const c = cOver.current;
    if (!c) return onMessage('Switch to Overlay/Ghost view to export the result');
    const blob: Blob | null = await new Promise((r) => c.toBlob(r, 'image/png'));
    if (!blob) return;
    const path = await saveBytes('compare.png', new Uint8Array(await blob.arrayBuffer()), 'png');
    if (path) onMessage('Saved ' + path);
  };

  const exportPdf = async () => {
    const c = cOver.current;
    if (!c || !docA || !docB || !stats) return onMessage('Run a comparison in Overlay/Ghost view first');
    const blob: Blob | null = await new Promise((r) => c.toBlob(r, 'image/png'));
    if (!blob) return;
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.HelveticaBold);
    const img = await pdf.embedPng(new Uint8Array(await blob.arrayBuffer()));
    const pageW = 1200,
      pageH = (1200 * c.height) / c.width + 60;
    const page = pdf.addPage([pageW, pageH]);
    page.drawImage(img, { x: 0, y: 0, width: pageW, height: pageH - 60 });
    const c1 = rgb(COLOR_REMOVED[0] / 255, COLOR_REMOVED[1] / 255, COLOR_REMOVED[2] / 255);
    const c2 = rgb(COLOR_ADDED[0] / 255, COLOR_ADDED[1] / 255, COLOR_ADDED[2] / 255);
    page.drawText(`Compare: ${docA.name} p${aPage + 1}  vs  ${docB.name} p${bPage + 1}`, { x: 14, y: pageH - 24, size: 14, font });
    page.drawText(`Removed (only in A): ${stats.removed}px`, { x: 14, y: pageH - 46, size: 11, font, color: c1 });
    page.drawText(`Added (only in B): ${stats.added}px`, { x: 260, y: pageH - 46, size: 11, font, color: c2 });
    page.drawText(`Changed: ${(stats.changeRatio * 100).toFixed(1)}%`, { x: 500, y: pageH - 46, size: 11, font });
    const path = await saveBytes(downloadName(docB.name, '-compare'), await pdf.save(), 'pdf');
    if (path) onMessage('Saved ' + path);
  };

  const docOpts = docs.map((d) => (
    <option key={d.id} value={d.id}>
      {d.name}
    </option>
  ));

  return (
    <div className="compare">
      <div className="compare-bar">
        <div className="cmp-sel">
          <b style={{ color: '#e22626' }}>A (old)</b>
          <select value={aId} onChange={(e) => setAId(e.target.value)}>{docOpts}</select>
          <input type="number" min={1} max={docA?.numPages ?? 1} value={aPage + 1} onChange={(e) => setAPage(Math.max(0, (+e.target.value || 1) - 1))} />
        </div>
        <div className="cmp-sel">
          <b style={{ color: '#186eeb' }}>B (new)</b>
          <select value={bId} onChange={(e) => setBId(e.target.value)}>{docOpts}</select>
          <input type="number" min={1} max={docB?.numPages ?? 1} value={bPage + 1} onChange={(e) => setBPage(Math.max(0, (+e.target.value || 1) - 1))} />
        </div>
        <button onClick={onOpenRevision}>Open revision…</button>
        <button className="primary" onClick={run} disabled={busy}>
          {busy ? 'Comparing…' : 'Compare'}
        </button>
        <span className="sep" />
        <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
          <option value="overlay">Overlay differences</option>
          <option value="ghost">Differences on faded A</option>
          <option value="side">Side by side</option>
        </select>
        <label>
          Tolerance
          <input type="range" min={0} max={8} value={tol} onChange={(e) => { setTol(+e.target.value); recompute(+e.target.value); }} />
        </label>
        <button onClick={align} disabled={!size}>Auto-align</button>
        <span className="nudge">
          <button onClick={() => nudge(-1, 0)} aria-label="Nudge left"><ActionIcon name="left" className="tool-icon" /></button>
          <button onClick={() => nudge(0, -1)} aria-label="Nudge up"><ActionIcon name="up" className="tool-icon" /></button>
          <button onClick={() => nudge(0, 1)} aria-label="Nudge down"><ActionIcon name="down" className="tool-icon" /></button>
          <button onClick={() => nudge(1, 0)} aria-label="Nudge right"><ActionIcon name="right" className="tool-icon" /></button>
          <span className="muted small"> {shift.dx},{shift.dy}</span>
        </span>
        <button onClick={exportPng}>Export PNG</button>
        <button onClick={exportPdf}>Export PDF</button>
      </div>
      {stats && (
        <div className="legend">
          <span style={{ color: '#e22626' }}>■ Removed (A only): {stats.removed.toLocaleString()} px</span>
          <span style={{ color: '#186eeb' }}>■ Added (B only): {stats.added.toLocaleString()} px</span>
          <span style={{ color: '#969696' }}>■ Unchanged: {stats.unchanged.toLocaleString()} px</span>
          <span>Changed: {(stats.changeRatio * 100).toFixed(1)}%</span>
        </div>
      )}
      <div className="compare-canvas-area">
      <div
        className={'compare-view' + (panActive ? ' pan-enabled' : '') + (panning ? ' panning' : '')}
        ref={compareView}
        onContextMenu={(event) => {
          event.preventDefault();
          setContextMenu({
            x: Math.max(4, Math.min(event.clientX, window.innerWidth - 180)),
            y: Math.max(4, Math.min(event.clientY, window.innerHeight - 130)),
          });
        }}
        onPointerDown={(event) => {
          if (event.target instanceof Element && event.target.closest('.compare-controls')) return;
          if (!panActive || event.button !== 0 || !compareView.current) return;
          panDrag.current = { x: event.clientX, y: event.clientY, left: compareView.current.scrollLeft, top: compareView.current.scrollTop };
          setPanning(true);
          event.currentTarget.setPointerCapture(event.pointerId);
          event.preventDefault();
        }}
        onPointerMove={(event) => {
          const drag = panDrag.current;
          if (!drag || !compareView.current) return;
          compareView.current.scrollLeft = drag.left - (event.clientX - drag.x);
          compareView.current.scrollTop = drag.top - (event.clientY - drag.y);
        }}
        onPointerUp={() => { panDrag.current = null; setPanning(false); }}
        onPointerCancel={() => { panDrag.current = null; setPanning(false); }}
        onWheel={(event) => {
          if (!event.ctrlKey && !event.metaKey) return;
          event.preventDefault();
          const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
          setZoom((value) => Math.max(0.05, Math.min(3, value * factor)));
        }}
      >
        {!size && <p className="muted pad">Pick two documents/pages and press Compare. Open a new revision with “Open revision…”.</p>}
        {size && (
          <div className="compare-stage">
            {mode !== 'side' && <canvas ref={cOver} style={{ width: size.w * zoom, height: size.h * zoom }} />}
            {mode === 'side' && (
              <div className="compare-side-by-side">
                <div>
                  <div className="cap">A · {docA?.name} p{aPage + 1}</div>
                  <canvas ref={cA} className="compare-page" style={{ width: size.w * zoom, height: size.h * zoom }} />
                </div>
                <div>
                  <div className="cap">B · {docB?.name} p{bPage + 1}</div>
                  <canvas ref={cB} className="compare-page" style={{ width: size.w * zoom, height: size.h * zoom }} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {size && (
        <div className="compare-controls viewer-controls" aria-label="Compare view controls">
          <FloatingTools tool={panActive ? 'hand' : 'select'} theme={theme} onTool={(selectedTool) => { setSpacePan(false); setPanEnabled(selectedTool === 'hand'); }} />
          <span className="sep" />
          <button title="Zoom out" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(0.05, value / 1.25))}><ActionIcon name="zoom-out" className="tool-icon" /></button>
          <span>{Math.round(zoom * 100)}%</span>
          <button title="Zoom in" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(3, value * 1.25))}><ActionIcon name="zoom-in" className="tool-icon" /></button>
          <button onClick={() => fitZoom('width')} title="Fit width"><ActionIcon name="fit-width" className="tool-icon" />Width</button>
          <button onClick={() => fitZoom('page')} title="Fit page"><ActionIcon name="page" className="tool-icon" />Page</button>
        </div>
      )}
      </div>
      {contextMenu && (
        <div
          className="viewer-context-menu compare-context-menu"
          ref={compareMenu}
          role="menu"
          aria-label="Compare view context menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button role="menuitem" onClick={() => { setPanEnabled((enabled) => !enabled); setSpacePan(false); setContextMenu(null); }}>
            <ContextMenuIcon action="pan" />{panActive ? 'Stop panning' : 'Pan'}
          </button>
          <button role="menuitem" onClick={() => { setZoom((value) => Math.min(3, value * 1.25)); setContextMenu(null); }}>
            <ContextMenuIcon action="zoom-in" />Zoom In
          </button>
          <button role="menuitem" onClick={() => { setZoom((value) => Math.max(0.1, value / 1.25)); setContextMenu(null); }}>
            <ContextMenuIcon action="zoom-out" />Zoom Out
          </button>
        </div>
      )}
    </div>
  );
}
