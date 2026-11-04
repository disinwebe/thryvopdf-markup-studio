import { FormEvent, ReactNode, useCallback, useEffect, useState } from 'react';
import { DISCIPLINE_LIST } from '../core/types';

type View = 'setup' | 'register' | 'login';

export default function AuthGate({ children }: { children: (user: AuthUser, logout: () => void) => ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [st, setSt] = useState<AuthStatus | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  const [f, setF] = useState({ name: '', email: '', discipline: DISCIPLINE_LIST[0], password: '', confirm: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  const refresh = useCallback(async () => {
    if (!window.api) return setUser({ name: 'User', email: '', discipline: '' }); // plain browser/dev preview
    const s = await window.api.authStatus();
    setSt(s);
    setUrl((u) => u || s.serverUrl);
    if (s.user) return setUser(s.user);
    if (!s.configured || !s.online) {
      setView('setup');
      if (s.error) setError(s.error);
    } else setView(s.hasUsers ? 'login' : 'register');
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setInfo('');
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = view === 'register' ? await window.api!.register(f) : await window.api!.login(f);
      if (r.ok) {
        setUser(r.user);
        setF((s) => ({ ...s, password: '', confirm: '' }));
      } else setError(r.error);
    });
  };

  const logout = async () => {
    await window.api?.logout();
    setUser(null);
    await refresh();
  };

  const test = () =>
    run(async () => {
      const r = await window.api!.testServer(url);
      if (r.ok) setInfo(`Connected to ${r.url}${r.hasUsers ? '' : ' (no users yet: the first registration creates the first account)'}.`);
      else setError(r.error || 'Connection failed.');
    });

  const connect = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await window.api!.configureAuth({ mode: 'server', serverUrl: url });
      if (!r.ok) return setError(r.error || 'Connection failed.');
      await refresh();
    });
  };

  const useLocal = () =>
    run(async () => {
      await window.api!.configureAuth({ mode: 'local' });
      await refresh();
    });

  if (user) return <>{children(user, logout)}</>;
  if (!view || !st) return null;

  if (view === 'setup')
    return (
      <div className="auth">
        <form className="auth-card" onSubmit={connect}>
          <h1>Plan Markup Studio</h1>
          <h2>Connect to your company server</h2>
          <label>
            Server address
            <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="192.168.1.10:8787 or https://pms-server:8787" />
          </label>
          {error && <div className="danger" role="alert">{error}</div>}
          {info && <div className="ok" role="status">{info}</div>}
          <div className="row">
            <button type="button" disabled={busy} onClick={test}>Test connection</button>
            <button className="primary" type="submit" disabled={busy}>Connect</button>
          </div>
          {st.configured && st.mode === 'server' && <button type="button" className="link" onClick={() => { setError(''); refresh(); }}>Retry current server ({st.serverUrl})</button>}
          <button type="button" className="link" disabled={busy} onClick={useLocal}>Use local accounts on this PC only</button>
          <p className="muted small">Accounts on the server are shared by every PC that connects to it.</p>
        </form>
      </div>
    );

  const reg = view === 'register';
  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <h1>Plan Markup Studio</h1>
        <h2>{reg ? 'Create your account' : 'Sign in'}</h2>
        {reg && (
          <label>
            Name
            <input autoFocus value={f.name} onChange={set('name')} autoComplete="name" />
          </label>
        )}
        <label>
          Email address
          <input autoFocus={!reg} type="email" value={f.email} onChange={set('email')} autoComplete="email" />
        </label>
        {reg && (
          <label>
            Discipline
            <select value={f.discipline} onChange={set('discipline')}>
              {[...DISCIPLINE_LIST, 'Other'].map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </label>
        )}
        <label>
          Password{reg ? ' (min. 8 characters)' : ''}
          <input type="password" value={f.password} onChange={set('password')} autoComplete={reg ? 'new-password' : 'current-password'} />
        </label>
        {reg && (
          <label>
            Confirm password
            <input type="password" value={f.confirm} onChange={set('confirm')} autoComplete="new-password" />
          </label>
        )}
        {error && <div className="danger" role="alert">{error}</div>}
        <button className="primary big" type="submit" disabled={busy}>{reg ? 'Register' : 'Sign in'}</button>
        <button type="button" className="link" onClick={() => { setView(reg ? 'login' : 'register'); setError(''); }}>
          {reg ? 'Already have an account? Sign in' : 'Register another user'}
        </button>
        <p className="muted small">
          {st.mode === 'local' ? 'Local accounts on this computer.' : `Server: ${st.serverUrl}`}{' '}
          <button type="button" className="link" onClick={() => { setView('setup'); setError(''); }}>Change</button>
        </p>
      </form>
    </div>
  );
}
