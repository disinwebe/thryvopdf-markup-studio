import { useCallback, useEffect, useState } from 'react';

export interface SharedListing {
  id: string;
  name: string;
  owner: string;
  size: number;
  created: string;
  version: number;
  markups: number;
  users: string[];
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
  onUpload: () => Promise<boolean>;
}) {
  const [docs, setDocs] = useState<SharedListing[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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
          <button className="primary" disabled={busy || !activeName} onClick={() => run(async () => { if (await onUpload()) await load(); })}>
            Upload current tab{activeName ? `: ${activeName}` : ''}
          </button>
          <button onClick={() => run(load)} disabled={busy}>Refresh</button>
        </div>
        {error && <div className="danger" role="alert">{error}</div>}
        <table>
          <thead>
            <tr><th>Name</th><th>Uploaded by</th><th>Size</th><th>Markups</th><th>Working now</th><th /></tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td>{d.name}</td>
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
