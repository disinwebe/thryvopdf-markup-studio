import { useState } from 'react';
import { Doc } from '../app/model';

export function ProjectPanel(p: {
  docs: Doc[];
  activeId: string;
  onActivate(id: string): void;
  onOpen(): void;
  onClose(id: string): void;
  onRename(id: string, name: string): void;
  onMove(i: number, dir: number): void;
  onMerge(): void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  return (
    <div className="panel-body">
      <div className="row">
        <button onClick={p.onOpen}>Add PDFs…</button>
        <button onClick={p.onMerge} disabled={p.docs.length < 2} title="Merge all open documents, in this order, into a new PDF">
          Merge all
        </button>
      </div>
      <p className="muted small">The project is the set of open drawing PDFs. Order here is the merge order.</p>
      {p.docs.map((d, i) => (
        <div key={d.id} className={'item' + (d.id === p.activeId ? ' active' : '')} onClick={() => p.onActivate(d.id)}>
          <div className="grow">
            {editing === d.id ? (
              <input
                autoFocus
                value={name}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => {
                  if (name.trim()) p.onRename(d.id, name.trim().replace(/(?<!\.pdf)$/i, ''));
                  setEditing(null);
                }}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
            ) : (
              <b onDoubleClick={() => { setEditing(d.id); setName(d.name); }} title="Double-click to rename">
                {d.name}
              </b>
            )}
            <div className="muted small">
              {d.numPages} sheets · {d.markups.length} markups{d.dirty ? ' · unsaved' : ''}
            </div>
          </div>
          <div className="mini" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => p.onMove(i, -1)}>↑</button>
            <button onClick={() => p.onMove(i, 1)}>↓</button>
            <button onClick={() => p.onClose(d.id)}>✕</button>
          </div>
        </div>
      ))}
    </div>
  );
}
