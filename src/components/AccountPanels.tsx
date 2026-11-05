import { FormEvent, useCallback, useEffect, useState } from 'react';

export function ChangePassword({ forced, onDone, onCancel }: { forced?: boolean; onDone: (u: AuthUser) => void; onCancel?: () => void }) {
  const [f, setF] = useState({ current: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const r = await window.api!.changePassword(f);
    setBusy(false);
    if (r.ok && r.user) onDone(r.user);
    else if (!r.ok) setError(r.error);
  };
  return (
    <form className="auth-card" onSubmit={submit}>
      <h2>{forced ? 'You must change your password before continuing' : 'Change password'}</h2>
      <label>
        Current password
        <input autoFocus type="password" value={f.current} onChange={set('current')} autoComplete="current-password" />
      </label>
      <label>
        New password (min. 8 characters)
        <input type="password" value={f.password} onChange={set('password')} autoComplete="new-password" />
      </label>
      <label>
        Confirm new password
        <input type="password" value={f.confirm} onChange={set('confirm')} autoComplete="new-password" />
      </label>
      {error && <div className="danger" role="alert">{error}</div>}
      <div className="row">
        <button className="primary" type="submit" disabled={busy}>Change password</button>
        {onCancel && <button type="button" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

export function UserManagement({ me, onClose }: { me: AuthUser; onClose: () => void }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const r = await window.api!.adminList();
    if (r.ok) setUsers(r.users || []);
    else setError(r.error || 'Could not load users.');
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (email: string, action: string, role?: string) => {
    if (action === 'delete' && !window.confirm(`Delete ${email}?`)) return;
    setError('');
    setMsg('');
    const r = await window.api!.adminAction({ email, action, role });
    if (!r.ok) setError(r.error || 'Action failed.');
    else if (r.tempPassword) setMsg(`Temporary password for ${email}: ${r.tempPassword} (shown once; the user must change it at next login).`);
    await load();
  };

  const pending = users.filter((u) => u.status === 'pending');
  const row = (u: ManagedUser) => {
    const self = u.email === me.email;
    return (
      <tr key={u.email}>
        <td>{u.name}</td>
        <td>{u.email}</td>
        <td>{u.discipline}</td>
        <td>{u.status}</td>
        <td>
          <select value={u.role} disabled={self} onChange={(e) => act(u.email, 'role', e.target.value)}>
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
        </td>
        <td className="acts">
          {u.status === 'pending' && <button onClick={() => act(u.email, 'approve')}>Approve</button>}
          {u.status === 'pending' && <button onClick={() => act(u.email, 'reject')}>Reject</button>}
          {u.status === 'rejected' && <button onClick={() => act(u.email, 'approve')}>Approve</button>}
          {u.status === 'active' && !self && <button onClick={() => act(u.email, 'disable')}>Disable</button>}
          {u.status === 'disabled' && <button onClick={() => act(u.email, 'enable')}>Enable</button>}
          <button onClick={() => act(u.email, 'reset')}>Reset password</button>
          {!self && <button onClick={() => act(u.email, 'delete')}>Delete</button>}
        </td>
      </tr>
    );
  };

  return (
    <div className="usermgmt">
      <div className="row between">
        <h2>User management</h2>
        <button onClick={onClose}>Close</button>
      </div>
      {error && <div className="danger" role="alert">{error}</div>}
      {msg && <div className="ok" role="status">{msg}</div>}
      <h3>Pending approval ({pending.length})</h3>
      {pending.length === 0 ? (
        <p className="muted">No registrations are waiting.</p>
      ) : (
        <table>
          <tbody>{pending.map(row)}</tbody>
        </table>
      )}
      <h3>All users ({users.length})</h3>
      <table>
        <thead>
          <tr><th>Name</th><th>Email</th><th>Discipline</th><th>Status</th><th>Role</th><th>Actions</th></tr>
        </thead>
        <tbody>{users.map(row)}</tbody>
      </table>
    </div>
  );
}
