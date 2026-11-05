import { useCallback, useEffect, useState } from 'react';
import { Doc } from '../app/model';
import { groupByProject } from '../app/upload';
import type { SharedListing } from './SharedLibrary';

export function ProjectPanel(p: {
  docs: Doc[];
  activeId: string;
  onActivate(id: string): void;
  onOpen(): void;
  onOpenShared?(d: SharedListing): Promise<void>;
  onClose(id: string): void;
  onRename(id: string, name: string): void;
  onMove(i: number, dir: number): void;
  onMerge(): void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [shared, setShared] = useState<SharedListing[]>([]);
  const [sharedErr, setSharedErr] = useState('');
  const loadShared = useCallback(async () => {
    if (!window.api?.sharedDocs) return;
    const r = await window.api.sharedDocs({ op: 'list' });
    if (r.ok) {
      setShared(r.docs || []);
      setSharedErr('');
    } else setSharedErr(r.expired ? 'Session expired. Log out and sign in again.' : r.error || 'Shared documents unavailable.');
  }, []);
  useEffect(() => {
    void loadShared();
  }, [loadShared]);
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
              {d.numPages} sheets · {d.markups.filter((m) => m.type !== 'line').length} markups{d.dirty ? ' · unsaved' : ''}
            </div>
          </div>
          <div className="mini" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => p.onMove(i, -1)}>↑</button>
            <button onClick={() => p.onMove(i, 1)}>↓</button>
            <button onClick={() => p.onClose(d.id)}>✕</button>
          </div>
        </div>
      ))}
      {p.onOpenShared && (
        <div className="shared-groups">
          <div className="row">
            <b>Shared documents</b>
            <span className="grow" />
            <button onClick={() => void loadShared()} title="Reload the shared list">Refresh</button>
          </div>
          {sharedErr && <div className="danger small">{sharedErr}</div>}
          {!sharedErr && !shared.length && <div className="muted small">No shared documents yet.</div>}
          {groupByProject(shared).map((g) => (
            <div key={'g:' + g.project} className="group">
              <div className="group-title"><b>{g.project || 'Ungrouped'}</b> <span className="muted small">({g.docs.length})</span></div>
              {g.docs.map((d) => (
                <div key={d.id} className="item" onClick={() => void p.onOpenShared!(d)} title={d.description || 'Open shared document'}>
                  <div className="grow">
                    <span>{d.rel ? d.rel + '/' : ''}{d.name}</span>
                    {d.description && <div className="muted small">{d.description}</div>}
                    <div className="muted small">{d.markups} markups{d.users.length ? ' \u00b7 working: ' + d.users.join(', ') : ''}</div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
