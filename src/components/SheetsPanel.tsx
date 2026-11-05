import { useRef, useState } from 'react';
import { Doc } from '../app/model';
import { toCsv } from '../core/measurement';
import { DISCIPLINE_LIST, SheetMeta } from '../core/types';
import { SearchHit, searchDoc } from '../pdf/pdfjs';

const DISCIPLINES = ['', ...DISCIPLINE_LIST];

const blank: SheetMeta = { number: '', title: '', discipline: '', revision: '' };

export function sheetRows(docs: Doc[]) {
  const rows: unknown[][] = [['Document', 'Page', 'Sheet number', 'Title', 'Discipline', 'Revision']];
  for (const d of docs)
    for (let i = 0; i < d.numPages; i++) {
      const s = d.sheets[i] ?? blank;
      rows.push([d.name, i + 1, s.number, s.title, s.discipline, s.revision]);
    }
  return toCsv(rows);
}

export function SheetsPanel({
  doc,
  docs,
  onChange,
  onGoto,
  onExport,
}: {
  doc: Doc;
  docs: Doc[];
  onChange(page: number, patch: Partial<SheetMeta>): void;
  onGoto(page: number): void;
  onExport(csv: string): void;
}) {
  const [sortKey, setSortKey] = useState<keyof SheetMeta | 'page'>('page');
  const order = Array.from({ length: doc.numPages }, (_, i) => i).sort((a, b) => {
    if (sortKey === 'page') return a - b;
    return (doc.sheets[a]?.[sortKey] ?? '').localeCompare(doc.sheets[b]?.[sortKey] ?? '', undefined, { numeric: true }) || a - b;
  });
  return (
    <div className="panel-body">
      <div className="row">
        <button onClick={() => onExport(sheetRows([doc]))}>Export this doc CSV</button>
        <button onClick={() => onExport(sheetRows(docs))}>Export all open CSV</button>
      </div>
      <table className="grid sheets">
        <thead>
          <tr>
            <th onClick={() => setSortKey('page')}>Pg</th>
            <th onClick={() => setSortKey('number')}>Sheet #</th>
            <th onClick={() => setSortKey('title')}>Title</th>
            <th onClick={() => setSortKey('discipline')}>Disc.</th>
            <th onClick={() => setSortKey('revision')}>Rev</th>
          </tr>
        </thead>
        <tbody>
          {order.map((i) => {
            const s = doc.sheets[i] ?? blank;
            return (
              <tr key={i} className={i === doc.page ? 'active' : ''}>
                <td>
                  <a onClick={() => onGoto(i)}>{i + 1}</a>
                </td>
                <td>
                  <input style={{ width: 54 }} value={s.number} onChange={(e) => onChange(i, { number: e.target.value })} />
                </td>
                <td>
                  <input value={s.title} onChange={(e) => onChange(i, { title: e.target.value })} />
                </td>
                <td>
                  <select value={s.discipline} onChange={(e) => onChange(i, { discipline: e.target.value })}>
                    {DISCIPLINES.map((d) => (
                      <option key={d}>{d}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input style={{ width: 34 }} value={s.revision} onChange={(e) => onChange(i, { revision: e.target.value })} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function SearchPanel({ docs, activeId, onGoto }: { docs: Doc[]; activeId: string; onGoto(docId: string, page: number): void }) {
  const [q, setQ] = useState('');
  const [all, setAll] = useState(true);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ doc: Doc; hits: SearchHit[] }[] | null>(null);
  const run = useRef(0);

  const go = async () => {
    const id = ++run.current;
    setBusy(true);
    const out: { doc: Doc; hits: SearchHit[] }[] = [];
    for (const d of docs.filter((d) => all || d.id === activeId)) {
      const hits = await searchDoc(d.pdf, q, d.textCache);
      if (hits.length) out.push({ doc: d, hits });
      if (id !== run.current) return;
    }
    setResults(out);
    setBusy(false);
  };

  return (
    <div className="panel-body">
      <div className="row">
        <input value={q} placeholder="Search text in drawings" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
        <button onClick={go} disabled={busy || !q.trim()}>
          {busy ? '…' : 'Search'}
        </button>
      </div>
      <label className="row">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> All open documents
      </label>
      {results && results.length === 0 && <p className="muted">No matches (scanned drawings without a text layer cannot be searched).</p>}
      {results?.map(({ doc, hits }) => (
        <div key={doc.id}>
          <h4>
            {doc.name} <span className="muted">({hits.length} pages)</span>
          </h4>
          {hits.map((h) => (
            <div key={h.page} className="item" onClick={() => onGoto(doc.id, h.page)}>
              <div className="grow">
                <b>Page {h.page + 1}</b>
                {doc.sheets[h.page]?.number ? ` · ${doc.sheets[h.page].number}` : ''}
                <div className="muted small">…{h.snippet}…</div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
