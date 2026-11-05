import { useCallback, useEffect, useState } from 'react';
import { UploadRow, groupByProject, runUploads, toRows } from '../app/upload';

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
  rel?: string;
}

const fmtSize = (n: number) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

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
  onUpload: () => Promise<{ ok: boolean; message: string }>;
}) {
  const [docs, setDocs] = useState<SharedListing[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [project, setProject] = useState('');
  const [note, setNote] = useState('');

  const patch = (key: string, p: Partial<UploadRow>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const pick = (kind: 'files' | 'folder') =>
    run(async () => {
      setNote('');
      const r = await window.api!.pickUploads(kind);
      if (!r) return;
      if (!r.items.length) return setNote('No PDF files found in that selection.');
      const proj = project.trim() || r.project;
      setRows(toRows(r.items));
      const res = await runUploads(r.items, (i) => window.api!.sharedDocs({ op: 'upload', token: i.token, name: i.name, project: proj, rel: i.rel }), patch);
      setNote(`Uploaded ${res.done} file(s)${res.failed ? `, ${res.failed} failed` : ''}${r.truncated ? '. Only the first 500 PDFs were included.' : ''}`);
      await load();
    });

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

  return (
    <div className="modal" role="dialog" aria-label="Shared documents">
      <div className="usermgmt">
        <div className="row">
          <h2>Shared documents (server)</h2>
          <span className="grow" />
          <button onClick={onClose}>Close</button>
        </div>
        <p className="muted">PDFs stored on the central server. Everyone who opens one edits the same markups live.</p>
        <div className="row">
          <button className="primary" disabled={busy || !activeName} onClick={() => run(async () => { const r = await onUpload(); setNote(r.message); setRows([]); if (r.ok) await load(); })}>
            Upload current tab{activeName ? `: ${activeName}` : ''}
          </button>
          <button disabled={busy} onClick={() => pick('files')}>Upload PDFs…</button>
          <button disabled={busy} onClick={() => pick('folder')} title="Uploads every PDF in the folder, keeping subfolders">Upload project folder…</button>
          <input placeholder="Project name (optional)" value={project} onChange={(e) => setProject(e.target.value)} maxLength={80} />
          <button onClick={() => run(load)} disabled={busy}>Refresh</button>
        </div>
        {error && <div className="danger" role="alert">{error}</div>}
        {note && <div role="status">{note}</div>}
        {rows.length > 0 && (
          <div className="uploads" aria-label="Upload progress">
            <div className="muted">{rows.filter((r) => r.state === 'done' || r.state === 'error').length} / {rows.length} processed</div>
            {rows.map((r) => (
              <div key={r.key} className={r.state === 'error' ? 'danger' : r.state === 'done' ? 'ok' : 'muted'}>
                {r.state === 'done' ? '✔' : r.state === 'error' ? '✖' : r.state === 'uploading' ? '…' : '·'} {r.rel ? r.rel + '/' : ''}{r.name} {r.error ? '- ' + r.error : ''}
              </div>
            ))}
          </div>
        )}
        <table>
          <thead>
            <tr><th>Name</th><th>Uploaded by</th><th>Size</th><th>Markups</th><th>Working now</th><th /></tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td>{d.rel ? <span className="muted">{d.rel}/</span> : null}{d.name}</td>
                <td>{d.owner}</td>
                <td>{fmtSize(d.size)}</td>
                <td>{d.markups}</td>
                <td>{d.users.join(', ') || '-'}</td>
                <td>
                  <button className="primary" disabled={busy} onClick={() => run(() => onOpen(d))}>Open</button>
                  {(me.role === 'admin' || me.name === d.owner) && (
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
                  )}
                </td>
              </tr>
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
