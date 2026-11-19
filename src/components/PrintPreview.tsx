import { useEffect, useMemo, useRef, useState, type CSSProperties, type WheelEvent } from 'react';
import { flattenStackableLayers, rasterizeMarkups } from '../app/rasterizeMarkups';
import { selectPrintPages, type PageRangeMode, type PageSubset } from '../app/printPages';
import { stateOf, type Doc } from '../app/model';
import { loadPdf, pageSize, renderToCanvas } from '../pdf/pdfjs';

type Orientation = 'auto' | 'portrait' | 'landscape';
type RenderedPage = { page: number; image: string; width: number; height: number; scale: number };
type Printer = { name: string; displayName: string; isDefault: boolean };
type PrinterPaper = { name: string; width: number; height: number; rawKind: number };
type PrinterSource = { name: string; rawKind: number };
type PrinterCapabilities = { paperSizes: PrinterPaper[]; paperSources: PrinterSource[]; defaultPaper: string; defaultSource: string };
type ScaleMode = 'fit' | 'actual' | 'custom';
type PreparedPdf = { pdf: Awaited<ReturnType<typeof loadPdf>>; sizes: Array<{ w: number; h: number }> };

const FALLBACK_CAPABILITIES: PrinterCapabilities = {
  paperSizes: [
    { name: 'Letter', width: 850, height: 1100, rawKind: 1 },
    { name: 'A4', width: 827, height: 1169, rawKind: 9 },
    { name: 'Legal', width: 850, height: 1400, rawKind: 5 },
    { name: 'A3', width: 1169, height: 1654, rawKind: 8 },
    { name: 'Tabloid', width: 1100, height: 1700, rawKind: 3 },
  ],
  paperSources: [],
  defaultPaper: 'Letter',
  defaultSource: '',
};

const paperKey = (paper: PrinterPaper) => `${paper.rawKind}:${paper.width}x${paper.height}:${paper.name}`;
const inches = (hundredths: number) => hundredths / 100;
const toMicrons = (hundredths: number) => Math.round(hundredths * 254);

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function PrintPreview({ document, onClose }: { document: Doc; onClose: () => void }) {
  const [prepared, setPrepared] = useState<PreparedPdf | null>(null);
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [printer, setPrinter] = useState('');
  const [printersLoading, setPrintersLoading] = useState(!!window.api);
  const [capabilities, setCapabilities] = useState<PrinterCapabilities | null>(window.api ? null : FALLBACK_CAPABILITIES);
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(false);
  const [capabilityRefresh, setCapabilityRefresh] = useState(0);
  const [selectedPaperKey, setSelectedPaperKey] = useState('');
  const [propertiesBusy, setPropertiesBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pageMode, setPageMode] = useState<PageRangeMode>('all');
  const [range, setRange] = useState('1');
  const [subset, setSubset] = useState<PageSubset>('all');
  const [reverse, setReverse] = useState(false);
  const [includeMarkups, setIncludeMarkups] = useState(true);
  const [orientation, setOrientation] = useState<Orientation>('auto');
  const [scaleMode, setScaleMode] = useState<ScaleMode>('fit');
  const [scale, setScale] = useState(100);
  const [margins, setMargins] = useState({ top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 });
  const [copies, setCopies] = useState(1);
  const [collate, setCollate] = useState(true);
  const [duplex, setDuplex] = useState<'default' | 'simplex' | 'longEdge' | 'shortEdge'>('default');
  const [selectedPage, setSelectedPage] = useState(document.page);
  const [zoom, setZoom] = useState(100);
  const [rendered, setRendered] = useState<RenderedPage[]>([]);
  const cache = useRef(new Map<number, RenderedPage>());
  const wheelLocked = useRef(false);

  useEffect(() => {
    if (!window.api) return;
    void window.api.printPrinters()
      .then((available) => {
        setPrinters(available);
        const selected = available.find((item) => item.isDefault) ?? available[0];
        setPrinter(selected?.name ?? '');
      })
      .catch((reason: unknown) => setError(`Could not load printers: ${messageOf(reason)}`))
      .finally(() => setPrintersLoading(false));
  }, []);

  useEffect(() => {
    if (!printer) {
      setCapabilities(null);
      return;
    }
    if (!window.api) {
      setCapabilities(FALLBACK_CAPABILITIES);
      setSelectedPaperKey(paperKey(FALLBACK_CAPABILITIES.paperSizes[0]));
      return;
    }
    let cancelled = false;
    setCapabilitiesLoading(true);
    setCapabilities(null);
    void window.api.printPrinterCapabilities(printer)
      .then((result) => {
        if (cancelled) return;
        if (!result.paperSizes.length) throw new Error('The selected printer has no supported paper sizes.');
        setCapabilities(result);
        const preferred = result.paperSizes.find((paper) => paper.name === result.defaultPaper) ?? result.paperSizes[0];
        setSelectedPaperKey(paperKey(preferred));
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(`Could not load paper sizes for this printer: ${messageOf(reason)}`);
      })
      .finally(() => { if (!cancelled) setCapabilitiesLoading(false); });
    return () => { cancelled = true; };
  }, [printer, capabilityRefresh]);

  useEffect(() => {
    let cancelled = false;
    let pdf: PreparedPdf['pdf'] | null = null;
    setLoading(true);
    setError('');
    void (async () => {
      try {
        let bytes = document.bytes;
        if (includeMarkups) {
          const stacked = await flattenStackableLayers(bytes, stateOf(document), document.pageObjects);
          bytes = stacked.bytes;
          if (stacked.markups.length) {
            const flattened = await rasterizeMarkups(bytes, { ...stateOf(document), markups: stacked.markups }, stacked.markups.map((markup) => markup.id));
            bytes = flattened.bytes;
          }
        }
        const loaded = await loadPdf(bytes);
        pdf = loaded;
        const sizes = await Promise.all(Array.from({ length: loaded.numPages }, (_, index) => pageSize(loaded, index)));
        if (cancelled) {
          await loaded.destroy();
          return;
        }
        cache.current.clear();
        setRendered([]);
        setPrepared({ pdf: loaded, sizes });
        setLoading(false);
      } catch (reason) {
        if (!cancelled) {
          setError(`Could not prepare the print preview: ${messageOf(reason)}`);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      if (pdf) void pdf.destroy();
    };
  }, [document, includeMarkups]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const selection = useMemo(() => {
    if (!prepared) return { pages: [] as number[], error: '' };
    try {
      return {
        pages: selectPrintPages({
          pageCount: prepared.pdf.numPages,
          mode: pageMode,
          currentPage: document.page,
          range,
          subset,
          reverse,
        }),
        error: '',
      };
    } catch (reason) {
      return { pages: [] as number[], error: messageOf(reason) };
    }
  }, [prepared, pageMode, document.page, range, subset, reverse]);
  const { pages, error: selectionError } = selection;
  const pageToPreview = pages.includes(selectedPage) ? selectedPage : pages[0];
  const preview = rendered.find((page) => page.page === pageToPreview);
  const selectedPaper = capabilities?.paperSizes.find((paper) => paperKey(paper) === selectedPaperKey) ?? capabilities?.paperSizes[0] ?? null;
  const paperWidth = inches(selectedPaper?.width ?? 850);
  const paperHeight = inches(selectedPaper?.height ?? 1100);
  const landscape = orientation === 'landscape' || (orientation === 'auto' && !!prepared?.sizes[pageToPreview]?.w && (prepared.sizes[pageToPreview]?.w ?? 0) > (prepared.sizes[pageToPreview]?.h ?? 0));
  const sheetWidth = landscape ? paperHeight : paperWidth;
  const sheetHeight = landscape ? paperWidth : paperHeight;
  const printMargins = landscape
    ? { top: margins.top, right: margins.right, bottom: margins.bottom, left: margins.left }
    : margins;
  const marginError = printMargins.left + printMargins.right >= sheetWidth || printMargins.top + printMargins.bottom >= sheetHeight
    ? 'Margins leave no printable area on this paper size.'
    : '';
  const pageContentStyle: CSSProperties = {
    position: 'absolute',
    top: `${(printMargins.top / sheetHeight) * 100}%`,
    right: `${(printMargins.right / sheetWidth) * 100}%`,
    bottom: `${(printMargins.bottom / sheetHeight) * 100}%`,
    left: `${(printMargins.left / sheetWidth) * 100}%`,
  };
  const printContentStyle: CSSProperties = {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
    padding: `${printMargins.top}in ${printMargins.right}in ${printMargins.bottom}in ${printMargins.left}in`,
  };

  const renderPage = async (pdf: PreparedPdf['pdf'], page: number, renderScale = 1.6) => {
    const cached = cache.current.get(page);
    if (cached && cached.scale >= renderScale) return cached;
    const canvas = window.document.createElement('canvas');
    try {
      const task = await renderToCanvas(pdf, page, renderScale, canvas);
      await task.promise;
      const size = await pageSize(pdf, page);
      const result = { page, image: canvas.toDataURL('image/png'), width: size.w, height: size.h, scale: renderScale };
      cache.current.set(page, result);
      setRendered([...cache.current.values()]);
      return result;
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  };

  useEffect(() => {
    if (!prepared || pageToPreview === undefined) return;
    let cancelled = false;
    void renderPage(prepared.pdf, pageToPreview).catch((reason: unknown) => {
      if (!cancelled) setError(`Could not render the print preview: ${messageOf(reason)}`);
    });
    return () => { cancelled = true; };
  }, [prepared, pageToPreview]);

  const print = async () => {
    if (!prepared || loading || busy || selectionError || marginError || !selectedPaper || !pages.length) return;
    if (window.api && !printer) {
      setError('Select an available printer before printing.');
      return;
    }
    setBusy(true);
    setError('');
    let closeOnSuccess = false;
    const previousTitle = window.document.title;
    window.document.title = document.name;
    try {
      for (const page of pages) await renderPage(prepared.pdf, page, 2);
      setRendered([...cache.current.values()]);
      setSelectedPage(pages[0]);
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const result = await window.api?.printDocument({
        silent: true,
        printBackground: true,
        landscape,
        pageSize: { width: toMicrons(selectedPaper.width), height: toMicrons(selectedPaper.height) },
        copies: Math.max(1, Math.min(99, copies)),
        collate,
        deviceName: printer,
        ...(duplex === 'default' ? {} : { duplexMode: duplex }),
      });
      if (!window.api) {
        window.print();
        closeOnSuccess = true;
      } else if (!result?.ok && !result?.cancelled) {
        throw new Error(result?.error ?? 'The print job could not be sent.');
      } else {
        closeOnSuccess = !!result?.ok;
      }
    } catch (reason) {
      setError(`Could not print the document: ${messageOf(reason)}`);
    } finally {
      window.document.title = previousTitle;
      setBusy(false);
    }
    if (closeOnSuccess) onClose();
  };

  const currentSheet = Math.max(0, pages.indexOf(pageToPreview)) + 1;
  const pageImageStyle = (item: RenderedPage): CSSProperties => {
    if (scaleMode === 'actual') return { flex: '0 0 auto', width: `${item.width / 72}in`, height: `${item.height / 72}in`, objectFit: 'fill' };
    if (scaleMode === 'custom') return { flex: '0 0 auto', width: `${scale}%`, height: `${scale}%`, objectFit: 'contain' };
    return { width: '100%', height: '100%', objectFit: 'contain' };
  };
  const changePage = (direction: -1 | 1) => {
    const index = pages.indexOf(pageToPreview);
    const next = pages[index + direction];
    if (next !== undefined) setSelectedPage(next);
  };
  const onPreviewWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (pages.length < 2 || Math.abs(event.deltaY) < 20 || wheelLocked.current) return;
    event.preventDefault();
    changePage(event.deltaY > 0 ? 1 : -1);
    wheelLocked.current = true;
    window.setTimeout(() => { wheelLocked.current = false; }, 180);
  };
  const openProperties = async () => {
    if (!window.api || !printer || propertiesBusy) return;
    setPropertiesBusy(true);
    setError('');
    try {
      await window.api.openPrinterProperties(printer);
      setCapabilityRefresh((revision) => revision + 1);
    } catch (reason) {
      setError(`Could not open printer properties: ${messageOf(reason)}`);
    } finally {
      setPropertiesBusy(false);
    }
  };

  return (
    <div className="modal print-preview-modal" role="dialog" aria-modal="true" aria-label="Print preview">
      <style>{`@page { size: ${sheetWidth}in ${sheetHeight}in; margin: 0; }`}</style>
      <div className="print-preview-dialog">
        <header className="print-preview-header">
          <div><b>Print</b><span>{document.name}</span></div>
          <button type="button" aria-label="Close print preview" onClick={onClose}>×</button>
        </header>
        <div className="print-preview-layout">
          <aside className="print-preview-controls">
            <div className="print-preview-options">
              <label>Printer
                <select value={printer} onChange={(event) => setPrinter(event.target.value)} disabled={printersLoading || !printers.length}>
                  {printers.length ? printers.map((item) => <option value={item.name} key={item.name}>{item.displayName || item.name}{item.isDefault ? ' (default)' : ''}</option>) : <option value="">No printers available</option>}
                </select>
                {window.api && !printersLoading && !printers.length && <small className="danger">No printers are installed or available.</small>}
              </label>
              <button type="button" className="print-preview-properties-button" onClick={() => void openProperties()} disabled={!printer || propertiesBusy || !window.api}>
                {propertiesBusy ? 'Close printer properties to continue…' : 'Printer Properties…'}
              </button>
              <small>Paper type, tray and finishing are configured in printer properties.</small>
              <section>
                <b>Pages</b>
                <div className="print-preview-radio"><label><input type="radio" checked={pageMode === 'all'} onChange={() => setPageMode('all')} /> All</label><label><input type="radio" checked={pageMode === 'current'} onChange={() => setPageMode('current')} /> Current</label><label><input type="radio" checked={pageMode === 'custom'} onChange={() => setPageMode('custom')} /> Custom</label></div>
                {pageMode === 'custom' && <label>Page range
                  <input value={range} onChange={(event) => setRange(event.target.value)} aria-invalid={!!selectionError} placeholder="e.g. 1-3, 5" />
                  {selectionError && <small className="danger">{selectionError}</small>}
                </label>}
                <label>Page subset
                  <select value={subset} onChange={(event) => setSubset(event.target.value as PageSubset)}><option value="all">All pages</option><option value="odd">Odd pages only</option><option value="even">Even pages only</option></select>
                </label>
                <label className="print-preview-check"><input type="checkbox" checked={reverse} onChange={(event) => setReverse(event.target.checked)} /> Reverse pages</label>
              </section>
              <section>
                <b>Page Setup</b>
                <label>Paper size
                  <select value={selectedPaperKey} onChange={(event) => setSelectedPaperKey(event.target.value)} disabled={capabilitiesLoading || !capabilities?.paperSizes.length}>
                    {capabilities?.paperSizes.map((item) => <option value={paperKey(item)} key={paperKey(item)}>{item.name}</option>)}
                  </select>
                </label>
                {capabilitiesLoading && <small>Loading sizes supported by this printer…</small>}
                <label>Paper source
                  <input readOnly value={capabilities?.defaultSource || 'Choose a tray in Printer Properties'} />
                </label>
                {!!capabilities?.paperSources.length && <small>Available sources: {capabilities.paperSources.map((source) => source.name).join(', ')}. Change the source in Printer Properties.</small>}
                <label>Orientation
                  <select value={orientation} onChange={(event) => setOrientation(event.target.value as Orientation)}><option value="auto">Auto</option><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select>
                </label>
                <div className="print-margin-grid" aria-label="Margins in inches">
                  {(['left', 'right', 'top', 'bottom'] as const).map((side) => <label key={side}>{side[0].toUpperCase() + side.slice(1)} (in.)
                    <input type="number" min="0" max="3" step="0.05" value={margins[side]} onChange={(event) => setMargins((current) => ({ ...current, [side]: Math.max(0, Math.min(3, Number(event.target.value) || 0)) }))} />
                  </label>)}
                </div>
                {marginError && <small className="danger" role="alert">{marginError}</small>}
              </section>
              <section>
                <b>Advanced Print Options</b>
                <label>Print content
                  <select value={includeMarkups ? 'markups' : 'document'} onChange={(event) => setIncludeMarkups(event.target.value === 'markups')}>
                    <option value="markups">Document and markups</option><option value="document">Document only</option>
                  </select>
                </label>
                <label>Scaling
                  <select value={scaleMode} onChange={(event) => setScaleMode(event.target.value as ScaleMode)}><option value="fit">Fit to printable area</option><option value="actual">Actual size</option><option value="custom">Custom scale</option></select>
                </label>
                {scaleMode === 'custom' && <label>Scale (%)
                  <input type="number" min="25" max="400" value={scale} onChange={(event) => setScale(Math.max(25, Math.min(400, Number(event.target.value) || 25)))} />
                </label>}
                <label>Copies<input type="number" min={1} max={99} value={copies} onChange={(event) => setCopies(Math.max(1, Math.min(99, Number(event.target.value) || 1)))} /></label>
                <label>Duplex<select value={duplex} onChange={(event) => setDuplex(event.target.value as typeof duplex)}><option value="default">Printer default</option><option value="simplex">Single-sided</option><option value="longEdge">Flip on long edge</option><option value="shortEdge">Flip on short edge</option></select></label>
                <label className="print-preview-check"><input type="checkbox" checked={collate} onChange={(event) => setCollate(event.target.checked)} /> Collate copies</label>
              </section>
              {(error || (pageMode !== 'custom' && selectionError)) && <p className="danger" role="alert">{error || selectionError}</p>}
            </div>
            <div className="print-preview-actions">
              <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="button" className="primary" onClick={() => void print()} disabled={loading || busy || printersLoading || capabilitiesLoading || (window.api ? !printer : false) || !!selectionError || !!marginError || !selectedPaper || !pages.length}>
                {busy ? 'Preparing…' : 'Print'}
              </button>
            </div>
          </aside>
          <main className="print-preview-stage">
            <div className="print-preview-sheet-strip" aria-label="Preview pages">
              {pages.slice(0, 100).map((page) => <button type="button" key={page} className={page === pageToPreview ? 'selected' : ''} onClick={() => setSelectedPage(page)}>{page + 1}</button>)}
              {pages.length > 100 && <span>+{pages.length - 100} more</span>}
            </div>
            <div className="print-preview-canvas" tabIndex={0} onWheel={onPreviewWheel} onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'PageDown') { event.preventDefault(); changePage(1); }
              else if (event.key === 'ArrowUp' || event.key === 'PageUp') { event.preventDefault(); changePage(-1); }
            }}>
              {loading ? <p>Preparing print preview…</p> : error && !preview ? <p className="danger">{error}</p> : preview ? (
                <div className="print-preview-page" style={{ aspectRatio: `${sheetWidth} / ${sheetHeight}`, transform: `scale(${zoom / 100})` }}>
                  <div className="print-preview-page-content" style={pageContentStyle}>
                    <img src={preview.image} alt={`Page ${preview.page + 1}`} style={pageImageStyle(preview)} />
                  </div>
                </div>
              ) : <p>No pages to preview.</p>}
            </div>
            <footer className="print-preview-footer">
              <div className="print-preview-navigation">
                <button type="button" aria-label="Previous page" onClick={() => changePage(-1)} disabled={currentSheet <= 1}>‹</button>
                <span>Sheet {currentSheet} of {pages.length || 0}</span>
                <button type="button" aria-label="Next page" onClick={() => changePage(1)} disabled={currentSheet >= pages.length}>›</button>
              </div>
              <div><button type="button" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(25, value - 10))}>−</button><span>{zoom}%</span><button type="button" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(200, value + 10))}>+</button></div>
            </footer>
          </main>
        </div>
        <div className="print-preview-print-pages">
          {pages.map((page) => {
            const item = rendered.find((entry) => entry.page === page);
            return item ? <div className="print-preview-print-page" key={page} style={{ width: `${sheetWidth}in`, height: `${sheetHeight}in` }}><div className="print-preview-print-content" style={printContentStyle}><img src={item.image} alt="" style={pageImageStyle(item)} /></div></div> : null;
          })}
        </div>
      </div>
    </div>
  );
}
