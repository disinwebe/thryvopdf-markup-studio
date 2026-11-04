import { useEffect, useRef, useState } from 'react';
import { Doc } from '../app/model';
import { PDFDocumentProxy, pageSize, renderToCanvas } from '../pdf/pdfjs';

export function Thumb({ pdf, index, width = 120 }: { pdf: PDFDocumentProxy; index: number; width?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !ref.current) return;
    let task: { cancel(): void } | null = null;
    let dead = false;
    (async () => {
      const s = await pageSize(pdf, index);
      if (dead || !ref.current) return;
      const t = await renderToCanvas(pdf, index, width / s.w, ref.current);
      task = t;
      try {
        await t.promise;
      } catch {
        /* cancelled */
      }
    })();
    return () => {
      dead = true;
      task?.cancel();
    };
  }, [visible, pdf, index, width]);

  return (
    <div ref={box} className="thumb-box" style={{ minWidth: width, minHeight: width * 0.7 }}>
      <canvas ref={ref} style={{ width }} />
    </div>
  );
}

export function Thumbnails({ doc, onGoto }: { doc: Doc; onGoto(i: number): void }) {
  return (
    <div className="thumbs">
      {Array.from({ length: doc.numPages }, (_, i) => (
        <div key={doc.id + '-' + i + '-' + doc.bytes.length} className={'thumb' + (i === doc.page ? ' active' : '')} onClick={() => onGoto(i)}>
          <Thumb pdf={doc.pdf} index={i} />
          <div className="thumb-label">
            {i + 1}
            {doc.sheets[i]?.number ? ` · ${doc.sheets[i].number}` : ''}
          </div>
        </div>
      ))}
    </div>
  );
}

export function BookmarksPanel({
  doc,
  onGoto,
  onChange,
}: {
  doc: Doc;
  onGoto(i: number): void;
  onChange(b: Doc['bookmarks']): void;
}) {
  const [title, setTitle] = useState('');
  const add = () => {
    const t = title.trim() || doc.sheets[doc.page]?.title || `Page ${doc.page + 1}`;
    onChange([...doc.bookmarks, { title: t, page: doc.page, level: 0 }]);
    setTitle('');
  };
  const upd = (i: number, patch: Partial<Doc['bookmarks'][number]>) =>
    onChange(doc.bookmarks.map((b, k) => (k === i ? { ...b, ...patch } : b)));
  const move = (i: number, dir: number) => {
    const j = i + dir;
    if (j < 0 || j >= doc.bookmarks.length) return;
    const next = doc.bookmarks.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div className="panel-body">
      <div className="row">
        <input value={title} placeholder="Bookmark title (current page)" onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button onClick={add}>Add</button>
      </div>
      {doc.bookmarks.length === 0 && <p className="muted">No bookmarks. They are saved into the PDF outline.</p>}
      {doc.bookmarks.map((b, i) => (
        <div key={i} className="bm" style={{ paddingLeft: b.level * 14 }}>
          <input value={b.title} onChange={(e) => upd(i, { title: e.target.value })} />
          <button title="Go to page" onClick={() => onGoto(b.page)}>
            p{b.page + 1}
          </button>
          <button title="Move up" onClick={() => move(i, -1)}>↑</button>
          <button title="Move down" onClick={() => move(i, 1)}>↓</button>
          <button title="Outdent" onClick={() => upd(i, { level: Math.max(0, b.level - 1) })}>◂</button>
          <button title="Indent" onClick={() => upd(i, { level: Math.min(4, b.level + 1) })}>▸</button>
          <button title="Delete" onClick={() => onChange(doc.bookmarks.filter((_, k) => k !== i))}>✕</button>
        </div>
      ))}
    </div>
  );
}
