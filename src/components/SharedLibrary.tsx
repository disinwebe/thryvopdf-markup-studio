import { Fragment, useCallback, useEffect, useState } from 'react';
import { Pick, UploadRow, filterDocumentsByName, formatReviewStatusCounts, groupByProject, reviewStatusCounts, runUploads, toRows } from '../app/upload';
import { loadCollapsedGroups, saveCollapsedGroups } from '../app/groupCollapse';

export interface SharedListing {
  id: string;
  name: string;
  owner: string;
  ownerEmail?: string;
  members?: string[] | null;
  size: number;
  created: string;
  version: number;
  markups: number;
  reviews?: { email: string; done: boolean; updated: string | null }[];
  users: string[];
  project?: string;
  description?: string;
  rel?: string;
  canRenameGroup?: boolean;
  canDeleteGroup?: boolean;
  deleteGroupRevision?: string;
}

type ShareUser = { name: string; email: string; discipline: string };

export function UserSelection({ users, ownerEmail, members, onChange }: { users: ShareUser[]; ownerEmail: string; members: string[]; onChange: (members: string[]) => void }) {
  const choices = users.filter((u) => u.email !== ownerEmail);
  const allSelected = choices.length > 0 && choices.every((u) => members.includes(u.email));
  return (
    <>
      <label><input type="checkbox" checked={allSelected} disabled={!choices.length} onChange={(e) => {
        const emails = new Set(choices.map((u) => u.email));
        onChange(e.target.checked ? [...new Set([...members, ...emails])] : members.filter((email) => !emails.has(email)));
      }} /> Select all allowed users</label>
      {choices.map((u) => (
        <label key={u.email}><input type="checkbox" checked={members.includes(u.email)} onChange={(e) => onChange(e.target.checked ? [...new Set([...members, u.email])] : members.filter((email) => email !== u.email))} /> {u.name} ({u.email})</label>
      ))}
    </>
  );
}

export function DeleteGroupButton({ project, count, disabled, onConfirm }: { project: string; count: number; disabled: boolean; onConfirm: () => void }) {
  return <button disabled={disabled} onClick={() => {
    if (window.confirm(`Permanently delete the group "${project}" and all ${count} document(s), including their markups, from the server for everyone? This cannot be undone.`)) onConfirm();
  }}>Delete group</button>;
}

const fmtSize = (n: number) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const NEW = '__new__';
const COLLAPSE_KEY = 'pms.sharedLibrary.collapsedGroups';

type Staged = { kind: 'current' } | { kind: 'files'; items: Pick[]; truncated: boolean };

export function SharedLibrary({
  me,
  activeName,
  activeSharedId,
  onClose,
  onOpen,
  onUpload,
  readOnly = false,
  onChanged,
}: {
  me: AuthUser;
  activeName?: string;
  activeSharedId?: string;
  onClose: () => void;
  onOpen: (d: SharedListing) => Promise<void>;
  onUpload: (project: string, description: string, members: string[]) => Promise<{ ok: boolean; message: string }>;
  readOnly?: boolean;
  onChanged: () => void;
}) {
  const [docs, setDocs] = useState<SharedListing[]>([]);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [note, setNote] = useState('');
  const [staged, setStaged] = useState<Staged | null>(null);
  const [groupSel, setGroupSel] = useState('');
  const [newGroup, setNewGroup] = useState('');
  const [desc, setDesc] = useState('');
  const [users, setUsers] = useState<{ name: string; email: string; discipline: string }[]>([]);
  const [members, setMembers] = useState<string[]>([]);
  const [editingAccess, setEditingAccess] = useState<SharedListing | null>(null);
  const [collapsed, setCollapsed] = useState<string[]>(() => {
    try { return loadCollapsedGroups(localStorage, COLLAPSE_KEY); } catch { return []; }
  });
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [groupName, setGroupName] = useState('');

  const saveCollapsed = (next: string[]) => {
    setCollapsed(next);
    try { saveCollapsedGroups(localStorage, next, COLLAPSE_KEY); } catch { /* storage unavailable */ }
  };

  const patch = (key: string, p: Partial<UploadRow>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const groups = [...new Set(docs.map((d) => d.project || '').filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const chosenGroup = (groupSel === NEW ? newGroup : groupSel).trim();

  const load = useCallback(async () => {
    const r = await window.api!.sharedDocs({ op: 'list' });
    if (r.ok) {
      setDocs(r.docs || []);
      setError('');
    } else setError(r.expired ? 'Your session expired. Log out and sign in again.' : r.error || 'Could not load shared documents.');
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      await load();
      if (active) timer = setTimeout(() => { void refresh(); }, 30_000);
    };
    timer = setTimeout(() => { void refresh(); }, 30_000);
    return () => { active = false; clearTimeout(timer); };
  }, [load]);
  useEffect(() => {
    if (readOnly) return;
    let active = true;
    void window.api!.sharedDocs({ op: 'users' }).then((r) => {
      if (!active) return;
      if (r.ok && Array.isArray(r.users)) setUsers(r.users);
      else setError(r.error || 'Could not load users for sharing.');
    }).catch(() => { if (active) setError('Could not load users for sharing.'); });
    return () => { active = false; };
  }, [readOnly]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const stage = (s: Staged, group: string) => {
    setNote('');
    setDesc('');
    setMembers([]);
    if (group && !groups.includes(group)) {
      setGroupSel(NEW);
      setNewGroup(group);
    } else {
      setGroupSel(group);
      setNewGroup('');
    }
    setStaged(s);
  };

  const pick = (kind: 'files' | 'folder') =>
    run(async () => {
      const r = await window.api!.pickUploads(kind);
      if (!r) return;
      if (!r.items.length) return setNote('No PDF files found in that selection.');
      stage({ kind: 'files', items: r.items, truncated: r.truncated }, r.project);
    });

  const confirmUpload = () =>
    run(async () => {
      if (!staged) return;
      const s = staged;
      const proj = chosenGroup;
      const description = desc.trim();
      setStaged(null);
      if (s.kind === 'current') {
        const r = await onUpload(proj, description, members);
        setNote(r.message);
        setRows([]);
        if (r.ok) { await load(); onChanged(); }
        return;
      }
      setRows(toRows(s.items));
      const res = await runUploads(s.items, (i) => window.api!.sharedDocs({ op: 'upload', token: i.token, name: i.name, project: proj, description, rel: i.rel, members }), patch);
      setNote(`Uploaded ${res.done} file(s)${res.failed ? `, ${res.failed} failed` : ''}${s.truncated ? '. Only the first 500 PDFs were included.' : ''}`);
      await load();
      if (res.done) onChanged();
    });

  const renameGroup = (project: string) =>
    run(async () => {
      const newProject = groupName.trim();
      if (!newProject) { setError('Enter a group name.'); return; }
      if (newProject === project) { setEditingGroup(null); return; }
      const r = await window.api!.sharedDocs({ op: 'rename-group', project, newProject });
      if (!r.ok) { setError(r.error || 'Group rename failed.'); return; }
      if (collapsed.includes(project)) saveCollapsed([...collapsed.filter((g) => g !== project), newProject]);
      try {
        const projectCollapsed = loadCollapsedGroups(localStorage);
        if (projectCollapsed.includes(project)) saveCollapsedGroups(localStorage, [...projectCollapsed.filter((g) => g !== project), newProject]);
      } catch { /* storage unavailable */ }
      setEditingGroup(null);
      await load();
      onChanged();
    });

  const deleteGroup = (project: string, revision: string) => {
    void run(async () => {
      try {
        const r = await window.api!.sharedDocs({ op: 'delete-group', project, revision });
        if (!r.ok) { setError(r.error || 'Group deletion failed.'); return; }
        await load();
        onChanged();
      } catch {
        setError('Group deletion failed. Refresh to check the server before retrying.');
      }
    });
  };

  return (
    <div className="modal" role="dialog" aria-label="Shared documents">
      <div className="usermgmt">
        <div className="row">
          <h2>Shared documents (server)</h2>
          <span className="grow" />
          <button onClick={onClose}>Close</button>
        </div>
        <p className="muted">{readOnly ? 'Viewer mode: shared documents and live markups are read-only.' : 'Only the uploader and selected users can open newly shared documents.'}</p>
        <div className="row">
          <button className="primary" disabled={readOnly || busy || !activeName} onClick={() => stage({ kind: 'current' }, '')}>
            Upload current tab{activeName ? `: ${activeName}` : ''}
          </button>
          <button disabled={readOnly || busy} onClick={() => pick('files')}>Upload PDFs...</button>
          <button disabled={readOnly || busy} onClick={() => pick('folder')} title="Uploads every PDF in the folder as one group, keeping subfolders">Upload project folder...</button>
          <button onClick={() => run(load)} disabled={busy}>Refresh</button>
        </div>
        {staged && (
          <div className="upload-form" aria-label="Upload details">
            <b>{staged.kind === 'current' ? 'Upload current tab' : `Upload ${staged.items.length} PDF(s)`}</b>
            <label>
              Group
              <select value={groupSel} onChange={(e) => setGroupSel(e.target.value)}>
                <option value="">(no group)</option>
                {groups.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
                <option value={NEW}>New group...</option>
              </select>
            </label>
            {groupSel === NEW && <input placeholder="New group name" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} maxLength={80} />}
            <label>
              Description (stored with each uploaded document)
              <textarea rows={2} maxLength={500} placeholder="e.g. Issued for construction, Rev B" value={desc} onChange={(e) => setDesc(e.target.value)} />
            </label>
            {!desc.trim() && <div className="muted">No description yet. Adding one helps others identify these files.</div>}
            <fieldset>
              <legend>Users allowed to access these documents</legend>
              <p className="muted">You always have access. Select others to share with; none selected means only you can open them.</p>
              <UserSelection users={users} ownerEmail={me.email} members={members} onChange={setMembers} />
            </fieldset>
            <div className="row">
              <button className="primary" disabled={busy || (groupSel === NEW && !newGroup.trim())} onClick={confirmUpload}>Upload</button>
              <button onClick={() => setStaged(null)}>Cancel</button>
            </div>
          </div>
        )}
        {editingAccess && (
          <div className="upload-form" aria-label="Manage document access">
            <b>Access for {editingAccess.name}</b>
            {editingAccess.members === null && <p className="muted">This older document is currently accessible to all signed-in users. Saving restricts it to the selected users.</p>}
            <UserSelection users={users} ownerEmail={me.email} members={members} onChange={setMembers} />
            <div className="row">
              <button disabled={busy} onClick={() => run(async () => {
                const r = await window.api!.sharedDocs({ op: 'members', id: editingAccess.id, members });
                if (!r.ok) { setError(r.error || 'Could not update access.'); return; }
                setEditingAccess(null);
                await load();
                onChanged();
              })}>Save access</button>
              <button onClick={() => setEditingAccess(null)}>Cancel</button>
            </div>
          </div>
        )}
        {error && <div className="danger" role="alert">{error}</div>}
        {note && <div role="status">{note}</div>}
        {rows.length > 0 && (
          <div className="uploads" aria-label="Upload progress">
            <div className="muted">{rows.filter((r) => r.state === 'done' || r.state === 'error').length} / {rows.length} processed</div>
            {rows.map((r) => (
              <div key={r.key} className={r.state === 'error' ? 'danger' : r.state === 'done' ? 'ok' : 'muted'}>
                {r.state === 'done' ? '\u2714' : r.state === 'error' ? '\u2716' : r.state === 'uploading' ? '\u2026' : '\u00b7'} {r.rel ? r.rel + '/' : ''}{r.name} {r.error ? '- ' + r.error : ''}
              </div>
            ))}
          </div>
        )}
        <input
          type="search"
          className="shared-search"
          aria-label="Search shared document filenames"
          placeholder="Search filenames"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <table>
          <thead>
            <tr><th>Name</th><th>Uploaded by</th><th>Size</th><th>Markups</th><th>Review status</th><th>Working now</th><th /></tr>
          </thead>
          <tbody>
            {groupByProject(filterDocumentsByName(docs, search)).map((g) => {
              const counts = reviewStatusCounts(g.docs);
              return (
              <Fragment key={'g:' + g.project}>
                <tr className="group-row">
                  <td colSpan={7}>
                    <div className="row">
                      <button aria-expanded={!collapsed.includes(g.project)} aria-label={`${collapsed.includes(g.project) ? 'Expand' : 'Collapse'} ${g.project || 'Ungrouped'}`} onClick={() => saveCollapsed(collapsed.includes(g.project) ? collapsed.filter((p) => p !== g.project) : [...collapsed, g.project])}>
                        <span aria-hidden="true">{collapsed.includes(g.project) ? '▶' : '▼'}</span> <b>{g.project || 'Ungrouped'}</b> <span className="muted">{formatReviewStatusCounts(counts)}</span>
                      </button>
                      {!readOnly && g.project && (me.role === 'admin' || g.docs.some((d) => d.canRenameGroup)) && (
                        editingGroup === g.project ? (
                          <form className="row" onSubmit={(e) => { e.preventDefault(); void renameGroup(g.project); }}>
                            <label>Group name <input autoFocus maxLength={80} value={groupName} onChange={(e) => setGroupName(e.target.value)} /></label>
                            <button type="submit" disabled={busy || !groupName.trim()}>Save</button>
                            <button type="button" disabled={busy} onClick={() => setEditingGroup(null)}>Cancel</button>
                          </form>
                        ) : <button disabled={busy} onClick={() => { setError(''); setEditingGroup(g.project); setGroupName(g.project); }}>Rename group</button>
                      )}
                      {!readOnly && g.project && g.docs[0].canDeleteGroup && g.docs[0].deleteGroupRevision && (
                        <DeleteGroupButton project={g.project} count={g.docs.length} disabled={busy} onConfirm={() => deleteGroup(g.project, g.docs[0].deleteGroupRevision!)} />
                      )}
                    </div>
                  </td>
                </tr>
                {!collapsed.includes(g.project) && g.docs.map((d) => (
                  <tr key={d.id} className={d.id === activeSharedId ? 'shared-doc-row active' : 'shared-doc-row'}>
                    <td>
                      {d.rel ? <span className="muted">{d.rel}/</span> : null}{d.name}
                      {d.description ? <div className="muted small">{d.description}</div> : null}
                    </td>
                    <td>{d.owner}</td>
                    <td>{fmtSize(d.size)}</td>
                    <td>{d.markups}</td>
                    <td>
                      {d.reviews?.length ? d.reviews.map((review) => (
                        <div key={review.email} className={review.done ? 'review-complete' : 'muted small'}>
                          {review.email}: {review.done ? 'Done' : 'Needs review'}
                          {review.done && review.updated && <span className="muted small"> · {new Date(review.updated).toLocaleString()}</span>}
                        </div>
                      )) : <span className="muted">No assigned reviewers</span>}
                      {d.reviews?.some((review) => review.email === me.email) && (
                        <label className="shared-review-check" onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={!!d.reviews.find((review) => review.email === me.email)?.done}
                            disabled={busy || readOnly}
                            aria-label={`Mark ${d.name} review as done`}
                            onChange={(event) => {
                              event.stopPropagation();
                              const done = event.target.checked;
                              void run(async () => {
                                const result = await window.api!.sharedDocs({ op: 'review', id: d.id, done });
                                if (!result.ok) { setError(result.error || 'Could not update review status.'); return; }
                                await load();
                              });
                            }}
                          />
                          <span>Review done</span>
                        </label>
                      )}
                    </td>
                    <td>{d.users.join(', ') || '-'}</td>
                    <td>
                      <button className="primary" disabled={busy} onClick={() => run(() => onOpen(d))}>Open</button>
                      {!readOnly && (me.role === 'admin' || me.email === d.ownerEmail) && (
                        <>
                          {me.email === d.ownerEmail && <button disabled={busy} onClick={() => { setEditingAccess(d); setMembers(d.members ?? []); }}>Manage access</button>}
                          <button
                            disabled={busy}
                            onClick={() =>
                              run(async () => {
                                if (!window.confirm(`Delete ${d.name} from the server for everyone?`)) return;
                                const r = await window.api!.sharedDocs({ op: 'delete', id: d.id });
                                if (!r.ok) setError(r.error || 'Delete failed.');
                                await load();
                                if (r.ok) onChanged();
                              })
                            }
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </Fragment>
            );})}
            {!!docs.length && !filterDocumentsByName(docs, search).length && (
              <tr><td colSpan={7} className="muted">No filenames match your search.</td></tr>
            )}
            {!docs.length && !error && (
              <tr><td colSpan={6} className="muted">No shared documents yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
