import { useState } from 'react';
import { Doc } from '../app/model';
import { PagePlan, chunkEvery, parseRanges } from '../core/organize';
import { Thumb } from './Thumbnails';

export interface OrganizePanelProps {
  doc: Doc;
  docs: Doc[];
  onPlan(plan: PagePlan[]): void;
  onExtract(indices: number[]): void;
  onSplit(groups: number[][]): void;
  onInsert(sourceId: string, range: string, at: number): void;
  onMessage(msg: string): void;
}

export function OrganizePanel(p: OrganizePanelProps) {
  const { doc } = p;
  const n = doc.numPages;
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [splitSpec, setSplitSpec] = useState('');
  const [every, setEvery] = useState('1');
  const [srcId, setSrcId] = useState('');
  const [srcRange, setSrcRange] = useState('');

  const identity = (): PagePlan[] => Array.from({ length: n }, (_, i) => ({ src: 0, index: i }));
  const chosen = () => (sel.size ? [...sel].sort((a, b) => a - b) : Array.from({ length: n }, (_, i) => i));
  const toggle = (i: number, e: React.MouseEvent) => {
    const next = new Set(e.ctrlKey || e.shiftKey ? sel : []);
    if (e.shiftKey && sel.size) {
      const last = Math.max(...sel);
      for (let k = Math.min(last, i); k <= Math.max(last, i); k++) next.add(k);
    } else if (sel.has(i) && (e.ctrlKey || sel.size === 1)) next.delete(i);
    else next.add(i);
    setSel(next);
  };

  const rotate = (deg: number, idx = chosen()) => {
    const plan = identity();
    for (const i of idx) plan[i].rotate = deg;
    p.onPlan(plan);
  };
  const del = (idx = chosen()) => {
    if (sel.size === 0 && idx.length === n) return p.onMessage('Select pages to delete');
    if (idx.length >= n) return p.onMessage('Cannot delete every page');
    p.onPlan(identity().filter((_, i) => !idx.includes(i)));
    setSel(new Set());
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= n || from === to) return;
    const plan = identity();
    const [x] = plan.splice(from, 1);
    plan.splice(to, 0, x);
    p.onPlan(plan);
    setSel(new Set([to]));
  };
  const duplicate = () => {
    const idx = chosen();
    const plan: PagePlan[] = [];
    for (let i = 0; i < n; i++) {
      plan.push({ src: 0, index: i });
      if (idx.includes(i)) plan.push({ src: 0, index: i });
    }
    p.onPlan(plan);
  };
  const split = () => {
    try {
      p.onSplit(splitSpec.trim() ? parseRanges(splitSpec, n) : chunkEvery(n, Math.max(1, parseInt(every) || 1)));
    } catch (e) {
      p.onMessage((e as Error).message);
    }
  };
  const others = p.docs.filter((d) => d.id !== doc.id);

  return (
    <div className="panel-body">
      <div className="muted small">Click to select · Ctrl/Shift for multiple · drag to reorder. With nothing selected, actions apply to all pages.</div>
      <div className="row wrap">
        <button onClick={() => rotate(-90)}>⟲ Rotate left</button>
        <button onClick={() => rotate(90)}>⟳ Rotate right</button>
        <button onClick={() => del()}>🗑 Delete</button>
        <button onClick={duplicate}>⧉ Duplicate</button>
        <button onClick={() => p.onExtract(chosen())}>Extract → new PDF</button>
      </div>
      <h4>Split</h4>
      <div className="row">
        <input value={splitSpec} onChange={(e) => setSplitSpec(e.target.value)} placeholder="Ranges e.g. 1-3, 4, 5-" />
      </div>
      <div className="row">
        <span>or every</span>
        <input style={{ width: 44 }} value={every} onChange={(e) => setEvery(e.target.value)} />
        <span>pages</span>
        <button onClick={split}>Split to folder…</button>
      </div>
      <h4>Insert pages from another PDF</h4>
      <div className="row">
        <select value={srcId} onChange={(e) => setSrcId(e.target.value)}>
          <option value="">Choose…</option>
          {others.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
          <option value="__file">Browse for file…</option>
        </select>
        <input value={srcRange} onChange={(e) => setSrcRange(e.target.value)} placeholder="Pages (all)" style={{ width: 90 }} />
        <button
          disabled={!srcId}
          onClick={() => p.onInsert(srcId, srcRange, sel.size ? Math.max(...sel) + 1 : n)}
        >
          Insert {sel.size ? 'after selection' : 'at end'}
        </button>
      </div>
      <h4>Pages ({n})</h4>
      <div className="list">
        {Array.from({ length: n }, (_, i) => (
          <div
            key={i + '-' + doc.bytes.length}
            className={'org-row' + (sel.has(i) ? ' active' : '')}
            draggable
            onDragStart={() => setDragFrom(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => dragFrom !== null && move(dragFrom, i)}
            onClick={(e) => toggle(i, e)}
          >
            <Thumb pdf={doc.pdf} index={i} width={56} />
            <div className="grow">
              <b>Page {i + 1}</b>
              <div className="muted small">{doc.sheets[i]?.number ? `${doc.sheets[i].number} ${doc.sheets[i].title}` : ' '}</div>
            </div>
            <div className="mini" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => move(i, i - 1)} title="Move up">↑</button>
              <button onClick={() => move(i, i + 1)} title="Move down">↓</button>
              <button onClick={() => rotate(90, [i])} title="Rotate right">⟳</button>
              <button onClick={() => del([i])} title="Delete page">✕</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
