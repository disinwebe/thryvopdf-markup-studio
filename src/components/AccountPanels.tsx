import { FormEvent, useCallback, useEffect, useState } from 'react';
import { DISCIPLINE_LIST } from '../core/types';

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

export function UserManagement({ me, onClose, onUserUpdated }: { me: AuthUser; onClose: () => void; onUserUpdated?: (user: AuthUser) => void }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [profile, setProfile] = useState({ name: '', email: '', discipline: '' });
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');

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

  const editProfile = (u: ManagedUser) => {
    setEditing(u);
    setProfile({ name: u.name, email: u.email, discipline: u.discipline });
    setError('');
    setMsg('');
  };

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    if (profile.email.trim().toLowerCase() !== editing.email && !window.confirm(`Change ${editing.name}'s sign-in email to ${profile.email.trim()}? Shared-document access, reviews and notifications will follow the new address.`)) return;
    setSaving(true);
    setError('');
    setMsg('');
    const r = await window.api!.adminAction({
      email: editing.email,
      action: 'profile',
      name: profile.name,
      profileEmail: profile.email,
      discipline: profile.discipline,
    });
    setSaving(false);
    if (!r.ok || !r.user) {
      setError(r.error || 'Could not update this profile.');
      return;
    }
    if (editing.email === me.email) onUserUpdated?.(r.user);
    setEditing(null);
    setMsg(`Updated profile for ${r.user.name}.`);
    await load();
  };

  const matchingUsers = users.filter((u) => `${u.name} ${u.email} ${u.discipline} ${u.status}`.toLowerCase().includes(query.trim().toLowerCase()));
  const pending = matchingUsers.filter((u) => u.status === 'pending');
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
          <button onClick={() => editProfile(u)}>Edit profile</button>
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
      {editing ? (
        <form className="user-profile-form" onSubmit={saveProfile}>
          <div className="row between">
            <h3>Edit user profile</h3>
            <span className="muted">{editing.status}</span>
          </div>
          <p className="muted small">Correct the user’s registration details. Their existing shared-document access and review history will be kept if the email changes.</p>
          <p className="muted small">After an email change, the user will sign in with the corrected address and their existing password.</p>
          <label>
            Full name
            <input autoFocus required maxLength={120} value={profile.name} onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))} />
          </label>
          <label>
            Email address
            <input required maxLength={254} type="text" inputMode="email" autoComplete="email" value={profile.email} onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))} />
          </label>
          <label>
            Discipline
            <select required value={profile.discipline} onChange={(e) => setProfile((p) => ({ ...p, discipline: e.target.value }))}>
              {[...new Set([...DISCIPLINE_LIST, 'Other', profile.discipline])].filter(Boolean).map((discipline) => <option key={discipline} value={discipline}>{discipline}</option>)}
            </select>
          </label>
          <div className="user-profile-summary">
            <span><strong>Role:</strong> {editing.role}</span>
            <span><strong>Account status:</strong> {editing.status}</span>
            {editing.created && <span><strong>Registered:</strong> {new Date(editing.created).toLocaleDateString()}</span>}
          </div>
          <div className="row">
            <button className="primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
            <button type="button" disabled={saving} onClick={() => { setEditing(null); setError(''); }}>Cancel</button>
          </div>
        </form>
      ) : (
        <>
          <label className="user-search">
            Search users
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, email, discipline, or status" />
          </label>
          <h3>Pending approval ({users.filter((u) => u.status === 'pending').length})</h3>
          {pending.length === 0 ? (
            <p className="muted">{users.some((u) => u.status === 'pending') ? 'No pending users match the search.' : 'No registrations are waiting.'}</p>
          ) : (
            <table>
              <thead><tr><th>Name</th><th>Email</th><th>Discipline</th><th>Status</th><th>Role</th><th>Actions</th></tr></thead>
              <tbody>{pending.map(row)}</tbody>
            </table>
          )}
          <h3>All users ({users.length})</h3>
          <table>
            <thead>
              <tr><th>Name</th><th>Email</th><th>Discipline</th><th>Status</th><th>Role</th><th>Actions</th></tr>
            </thead>
            <tbody>{matchingUsers.length ? matchingUsers.map(row) : <tr><td colSpan={6} className="muted">No users match the search.</td></tr>}</tbody>
          </table>
        </>
      )}
    </div>
  );
}
