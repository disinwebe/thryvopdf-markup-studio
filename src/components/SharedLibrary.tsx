import { Fragment, useCallback, useEffect, useState } from 'react';
import { Pick, UploadRow, groupByProject, runUploads, toRows } from '../app/upload';

export interface SharedListing {
  id: string;
  name: string;
  owner: string;
  size: number;
  created: string;
  version: number;
  markups: number;
  users: string[];
  project?: string;
  description?: string;
  rel?: string;
}

const fmtSize = (n: number) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const NEW = '__new__';

type Staged = { kind: 'current' } | { kind: 'files'; items: Pick[]; truncated: boolean };

export function SharedLibrary({
  me,
  activeName,
  onClose,
  onOpen,
  onUpload,
}: {
  me: AuthUser;
  activeName?: string;
  onClose: () => void;
  onOpen: (d: SharedListing) => Promise<void>;
  onUpload: (project: string, description: string) => Promise<{ ok: boolean; message: string }>;
}) {
  const [docs, setDocs] = useState<SharedListing[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [note, setNote] = useState('');
  const [staged, setStaged] = useState<Staged | null>(null);
  const [groupSel, setGroupSel] = useState('');
  const [newGroup, setNewGroup] = useState('');
  const [desc, setDesc] = useState('');

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
        const r = await onUpload(proj, description);
        setNote(r.message);
        setRows([]);
        if (r.ok) await load();
        return;
      }
      setRows(toRows(s.items));
      const res = await runUploads(s.items, (i) => window.api!.sharedDocs({ op: 'upload', token: i.token, name: i.name, project: proj, description, rel: i.rel }), patch);
      setNote(`Uploaded ${res.done} file(s)${res.failed ? `, ${res.failed} failed` : ''}${s.truncated ? '. Only the first 500 PDFs were included.' : ''}`);
      await load();
    });

  const editMeta = (d: SharedListing) =>
    run(async () => {
      const description = window.prompt('Description for ' + d.name, d.description || '');
      if (description === null) return;
      const project = window.prompt('Group (leave empty for none). Existing: ' + (groups.join(', ') || 'none'), d.project || '');
      if (project === null) return;
      const r = await window.api!.sharedDocs({ op: 'meta', id: d.id, project, description });
      if (!r.ok) setError(r.error || 'Update failed.');
      await load();
    });

  return (
    <div className="modal" role="dialog" aria-label="Shared documents">
      <div className="usermgmt">
        <div className="row">
          <h2>Shared documents (server)</h2>
          <span className="grow" />
          <button onClick={onClose}>Close</button>
        </div>
        <p className="muted">PDFs stored on the central server, organised in groups. Everyone who opens one edits the same markups live.</p>
        <div className="row">
          <button className="primary" disabled={busy || !activeName} onClick={() => stage({ kind: 'current' }, '')}>
            Upload current tab{activeName ? `: ${activeName}` : ''}
          </button>
          <button disabled={busy} onClick={() => pick('files')}>Upload PDFs...</button>
          <button disabled={busy} onClick={() => pick('folder')} title="Uploads every PDF in the folder as one group, keeping subfolders">Upload project folder...</button>
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
            <div className="row">
              <button className="primary" disabled={busy || (groupSel === NEW && !newGroup.trim())} onClick={confirmUpload}>Upload</button>
              <button onClick={() => setStaged(null)}>Cancel</button>
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
        <table>
          <thead>
            <tr><th>Name</th><th>Uploaded by</th><th>Size</th><th>Markups</th><th>Working now</th><th /></tr>
          </thead>
          <tbody>
            {groupByProject(docs).map((g) => (
              <Fragment key={'g:' + g.project}>
                <tr className="group-row">
                  <td colSpan={6}><b>{g.project || 'Ungrouped'}</b> <span className="muted">({g.docs.length})</span></td>
                </tr>
                {g.docs.map((d) => (
                  <tr key={d.id}>
                    <td>
                      {d.rel ? <span className="muted">{d.rel}/</span> : null}{d.name}
                      {d.description ? <div className="muted small">{d.description}</div> : null}
                    </td>
                    <td>{d.owner}</td>
                    <td>{fmtSize(d.size)}</td>
                    <td>{d.markups}</td>
                    <td>{d.users.join(', ') || '-'}</td>
                    <td>
                      <button className="primary" disabled={busy} onClick={() => run(() => onOpen(d))}>Open</button>
                      {(me.role === 'admin' || me.name === d.owner) && (
                        <>
                          <button disabled={busy} onClick={() => editMeta(d)}>Edit info</button>
                          <button
                            disabled={busy}
                            onClick={() =>
                              run(async () => {
                                if (!window.confirm(`Delete ${d.name} from the server for everyone?`)) return;
                                const r = await window.api!.sharedDocs({ op: 'delete', id: d.id });
                                if (!r.ok) setError(r.error || 'Delete failed.');
                                await load();
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
            ))}
            {!docs.length && !error && (
              <tr><td colSpan={6} className="muted">No shared documents yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
