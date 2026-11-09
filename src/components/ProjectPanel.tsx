import { useCallback, useEffect, useRef, useState } from 'react';
import { Doc } from '../app/model';
import { groupByProject } from '../app/upload';
import { SHARED_REFRESH_MS, startPolling } from '../app/shortcuts';
import { loadCollapsedGroups, saveCollapsedGroups } from '../app/groupCollapse';
import { isReviewMarkup } from '../core/numbering';
import type { SharedListing } from './SharedLibrary';
import { normalizePdfFilename } from '../app/filename';

export function ProjectPanel(p: {
  docs: Doc[];
  activeId: string;
  me: AuthUser;
  sharedRevision?: number;
  viewOnly?: boolean;
  onActivate(id: string): void;
  onOpen(): void;
  onOpenShared?(d: SharedListing): Promise<void>;
  onClose(id: string): void;
  onRename(id: string, name: string): void | Promise<void>;
  onMove(i: number, dir: number): void;
  onMerge(): void;
  readOnly?: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [originalName, setOriginalName] = useState('');
  const cancelRename = useRef(false);
  const finishRename = (id: string) => {
    if (cancelRename.current) {
      cancelRename.current = false;
      return;
    }
    const next = normalizePdfFilename(name);
    if (next && next !== originalName) void p.onRename(id, next);
    setEditing(null);
  };
  const [shared, setShared] = useState<SharedListing[]>([]);
  const [sharedErr, setSharedErr] = useState('');
  const [reviewBusy, setReviewBusy] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<string[]>(() => {
    try { return loadCollapsedGroups(localStorage); } catch { return []; }
  });
  const toggleGroup = (project: string) => setCollapsed((prev) => {
    const next = prev.includes(project) ? prev.filter((v) => v !== project) : [...prev, project];
    try { saveCollapsedGroups(localStorage, next); } catch { /* storage unavailable */ }
    return next;
  });
  const hasShared = !!p.onOpenShared;
  const loadShared = useCallback(async () => {
    if (!hasShared || !window.api?.sharedDocs) return;
    try {
      const r = await window.api.sharedDocs({ op: 'list' });
      if (r.ok) {
        setShared(r.docs || []);
        setSharedErr('');
      } else setSharedErr(r.expired ? 'Session expired. Log out and sign in again.' : r.error || 'Shared documents unavailable.');
    } catch {
      setSharedErr('Shared documents unavailable. Check your connection and sign-in.');
    }
  }, [hasShared]);
  useEffect(() => {
    void loadShared();
    try { setCollapsed(loadCollapsedGroups(localStorage)); } catch { /* storage unavailable */ }
    // Auto-refresh only while this tab is mounted (visible) and the window is not hidden.
    return startPolling(() => void loadShared(), SHARED_REFRESH_MS, () => !document.hidden);
  }, [loadShared, p.sharedRevision]);
  return (
    <div className="panel-body">
      <div className="row">
        <button onClick={p.onOpen}>Add PDFs…</button>
        <button onClick={p.onMerge} disabled={p.readOnly || p.docs.length < 2} title="Merge all open documents, in this order, into a new PDF">
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
                onBlur={() => finishRename(d.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') { e.preventDefault(); cancelRename.current = true; setName(originalName); setEditing(null); }
                }}
              />
            ) : (
              <b onDoubleClick={() => {
                if (p.viewOnly || d.shared) return;
                cancelRename.current = false;
                setEditing(d.id);
                setName(d.name);
                setOriginalName(d.name);
              }} title={p.viewOnly || d.shared ? undefined : 'Double-click to rename'}>
                {d.name}
              </b>
            )}
            <div className="muted small">
              {d.numPages} sheets · {d.markups.filter(isReviewMarkup).length} markups{d.dirty ? ' · unsaved' : ''}
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
            <b>Shared documents</b> <span className="muted small">(auto-refresh every 30 sec)</span>
            <span className="grow" />
            <button onClick={() => void loadShared()} title="Reload the shared list">Refresh</button>
          </div>
          {sharedErr && <div className="danger small">{sharedErr}</div>}
          {!sharedErr && !shared.length && <div className="muted small">No shared documents yet.</div>}
          {groupByProject(shared).map((g) => (
            <div key={'g:' + g.project} className="group">
              <button className="group-title group-toggle" aria-expanded={!collapsed.includes(g.project)} onClick={() => toggleGroup(g.project)}>
                <span aria-hidden="true">{collapsed.includes(g.project) ? '▶' : '▼'}</span> <b>{g.project || 'Ungrouped'}</b> <span className="muted small">({g.docs.length})</span>
              </button>
              {!collapsed.includes(g.project) && g.docs.map((d) => {
                const review = d.reviews?.find((item) => item.email === p.me.email);
                const isActive = p.docs.some((openDoc) => openDoc.id === p.activeId && openDoc.shared?.id === d.id);
                const displayName = `${d.rel ? d.rel + '/' : ''}${d.name}`;
                const nameStyle = { fontSize: `${Math.max(8, Math.min(12, 300 / Math.max(displayName.length, 1)))}px` };
                return (
                  <div key={d.id} className={'item shared-document' + (isActive ? ' active' : '') + (review?.done ? ' review-complete' : '')} onClick={() => void p.onOpenShared!(d)} title={d.description || 'Open shared document'}>
                    <div className="grow">
                      <div className="shared-document-heading">
                        <span className="shared-document-name" style={nameStyle} title={displayName}>{displayName}</span>
                        {review && <label className="shared-review-check" onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={review.done}
                            disabled={reviewBusy === d.id || p.readOnly}
                            aria-label={`Mark ${d.name} review as done`}
                            onChange={(event) => {
                              event.stopPropagation();
                              setReviewBusy(d.id);
                              setSharedErr('');
                              void window.api!.sharedDocs({ op: 'review', id: d.id, done: event.target.checked })
                                .then(async (result) => {
                                  if (!result.ok) {
                                    setSharedErr(result.error || 'Could not update review status.');
                                    return;
                                  }
                                  await loadShared();
                                })
                                .catch(() => setSharedErr('Could not update review status. Check your connection and refresh.'))
                                .finally(() => setReviewBusy((current) => current === d.id ? null : current));
                            }}
                          />
                          <span>{reviewBusy === d.id ? 'Saving…' : 'Review done'}</span>
                        </label>}
                      </div>
                      {d.description && <div className="muted small">{d.description}</div>}
                      <div className="muted small">{d.markups} markups{d.users.length ? ' \u00b7 working: ' + d.users.join(', ') : ''}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
