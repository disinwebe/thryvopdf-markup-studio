import { FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { DISCIPLINE_LIST } from '../core/types';
import { ChangePassword, UserManagement } from './AccountPanels';
import { useNotifications, type NotificationsApi } from './Notifications';

type View = 'setup' | 'register' | 'login' | 'awaiting';
type Actions = {
  serverMode: boolean;
  signedIn: boolean;
  uiBlocked?: boolean;
  logout: () => void;
  changePassword: () => void;
  manageUsers?: () => void;
  requestSignIn: (onSignedIn?: () => void) => void;
  notifications?: NotificationsApi | null;
};

const LOCAL_USER: AuthUser = { name: 'Local user', email: '', discipline: '', role: 'user' };
const viewForStatus = (status: AuthStatus): View =>
  status.mode === 'server' && status.configured && status.online ? (status.hasUsers ? 'login' : 'register') : 'setup';

export default function AuthGate({ children }: { children: (user: AuthUser, actions: Actions) => ReactNode }) {
  const [localUser] = useState<AuthUser>(() => ({
    ...LOCAL_USER,
    name: (typeof window !== 'undefined' && window.api?.localUserName?.trim()) || LOCAL_USER.name,
  }));
  const [user, setUser] = useState<AuthUser>(localUser);
  const [st, setSt] = useState<AuthStatus | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<'password' | 'users' | null>(null);
  const pendingSignIn = useRef<(() => void) | null>(null);
  const [url, setUrl] = useState('');
  const [f, setF] = useState({ name: '', email: '', discipline: DISCIPLINE_LIST[0], password: '', confirm: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const notifications = useNotifications(user.email ? user : null, st?.mode === 'server');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  const refresh = useCallback(async () => {
    if (!window.api) return null;
    const status = await window.api.authStatus();
    setSt(status);
    setUrl((value) => value || status.serverUrl);
    setUser(status.mode === 'server' ? status.user || localUser : localUser);
    return status;
  }, [localUser]);

  useEffect(() => {
    void refresh().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [refresh]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setInfo('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const continueLocally = async () => {
    pendingSignIn.current = null;
    if (user.mustChange) {
      try {
        const result = await window.api?.logout();
        if (result?.warning) window.alert(result.warning);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
      setUser(localUser);
    }
    setAuthOpen(false);
    setPanel(null);
    setError('');
  };

  const requestSignIn = (onSignedIn?: () => void) => {
    pendingSignIn.current = onSignedIn || null;
    setAuthOpen(true);
    setError('');
    setInfo('');
    if (!window.api) {
      setView('setup');
      setError('Server sign-in is available in the ThryvoPDF desktop application.');
      return;
    }
    if (st) {
      setView(viewForStatus(st));
      return;
    }
    setBusy(true);
    void refresh().then((status) => {
      if (status?.user && !status.user.mustChange) {
        setAuthOpen(false);
        pendingSignIn.current?.();
        pendingSignIn.current = null;
      } else if (status) setView(viewForStatus(status));
    }).catch((e) => {
      setView('setup');
      setError(e instanceof Error ? e.message : String(e));
    }).finally(() => setBusy(false));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const result = view === 'register' ? await window.api!.register(f) : await window.api!.login(f);
      if (result.ok && result.pending) {
        setView('awaiting');
        setInfo(result.message);
      } else if (result.ok) {
        setUser(result.user);
        setF((s) => ({ ...s, password: '', confirm: '' }));
        if (result.rememberError) setInfo(result.rememberError);
        else if (result.remembered) setInfo('Signed in. Your session is saved securely on this device.');
        if (!result.user.mustChange) {
          setAuthOpen(false);
          pendingSignIn.current?.();
          pendingSignIn.current = null;
        }
      } else setError(result.error);
    });
  };

  const logout = async () => {
    const result = await window.api?.logout();
    setUser(localUser);
    setPanel(null);
    setAuthOpen(false);
    if (result?.warning) window.alert(result.warning);
    await refresh();
  };

  const test = () =>
    run(async () => {
      const result = await window.api!.testServer(url);
      if (result.ok) setInfo(`Connected to ${result.url}${result.hasUsers ? '' : ' (no users yet: the first registration creates the first account)'}.`);
      else setError(result.error || 'Connection failed.');
    });

  const connect = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const result = await window.api!.configureAuth({ mode: 'server', serverUrl: url });
      if (!result.ok) return setError(result.error || 'Connection failed.');
      const status = await refresh();
      if (status) setView(viewForStatus(status));
    });
  };

  const signedIn = st?.mode === 'server' && !!user.email && !user.mustChange;
  const actions: Actions = {
    serverMode: st?.mode === 'server' && st.configured,
    signedIn,
    uiBlocked: !!panel || authOpen,
    logout,
    changePassword: () => setPanel('password'),
    manageUsers: signedIn && user.role === 'admin' ? () => setPanel('users') : undefined,
    requestSignIn,
    notifications,
  };
  const reg = view === 'register';

  return (
    <>
      {children(user, actions)}
      {panel && (
        <div className="modal">
          {panel === 'password'
            ? <ChangePassword onDone={(nextUser) => { setUser(nextUser); setPanel(null); }} onCancel={() => setPanel(null)} />
            : <UserManagement me={user} onClose={() => setPanel(null)} />}
        </div>
      )}
      {authOpen && (
        <div className="modal">
          {user.mustChange ? (
            <div className="auth-card">
              <ChangePassword forced onDone={(nextUser) => {
                setUser(nextUser);
                setAuthOpen(false);
                pendingSignIn.current?.();
                pendingSignIn.current = null;
              }} />
              <button type="button" className="link" onClick={() => void continueLocally()}>Continue locally</button>
            </div>
          ) : view === 'awaiting' ? (
            <div className="auth-card">
              <h1>ThryvoPDF Markup Studio</h1>
              <h2>Awaiting admin approval</h2>
              <p>{info || 'Your registration was submitted.'} You can sign in once an administrator approves your account.</p>
              <button className="primary" onClick={() => { setView('login'); setInfo(''); }}>Back to sign in</button>
              <button type="button" className="link" onClick={() => void continueLocally()}>Continue locally</button>
            </div>
          ) : view === 'setup' || !view ? (
            <form className="auth-card" onSubmit={connect}>
              <h1>ThryvoPDF Markup Studio</h1>
              <h2>Connect to your company server</h2>
              <p className="muted small">PDFs and locally licensed features work without an account. Sign in only for shared documents and collaboration.</p>
              <label>
                Server address
                <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="192.168.1.10:8787 or https://pms-server:8787" />
              </label>
              {error && <div className="danger" role="alert">{error}</div>}
              {info && <div className="ok" role="status">{info}</div>}
              {st?.sessionError && <div className="danger" role="status">Saved sign-in could not be restored: {st.sessionError}</div>}
              {st?.error && <p className="muted small">{st.error}</p>}
              <div className="row">
                <button type="button" disabled={busy} onClick={test}>Test connection</button>
                <button className="primary" type="submit" disabled={busy}>Connect</button>
              </div>
              {st?.configured && st.mode === 'server' && <button type="button" className="link" disabled={busy} onClick={() => { setError(''); void refresh().then((status) => status && setView(viewForStatus(status))); }}>Retry current server ({st.serverUrl})</button>}
              <p className="muted small">Server accounts are shared by every PC that connects to it.</p>
              <button type="button" className="link" onClick={() => void continueLocally()}>Continue locally</button>
            </form>
          ) : (
            <form className="auth-card" onSubmit={submit}>
              <h1>ThryvoPDF Markup Studio</h1>
              <h2>{reg ? 'Create your account' : 'Sign in to collaborate'}</h2>
              {reg && st?.mode === 'server' && <p className="muted small">New accounts must be approved by an administrator before you can sign in.</p>}
              {reg && (
                <label>
                  Name
                  <input autoFocus value={f.name} onChange={set('name')} autoComplete="name" />
                </label>
              )}
              <label>
                Email address
                <input autoFocus={!reg} type="text" value={f.email} onChange={set('email')} autoComplete="email" />
              </label>
              {reg && (
                <label>
                  Discipline
                  <select value={f.discipline} onChange={set('discipline')}>
                    {[...DISCIPLINE_LIST, 'Other'].map((discipline) => <option key={discipline}>{discipline}</option>)}
                  </select>
                </label>
              )}
              <label>
                Password{reg ? ' (min. 8 characters)' : ''}
                <input type={showPassword ? 'text' : 'password'} value={f.password} onChange={set('password')} autoComplete={reg ? 'new-password' : 'current-password'} />
                <button type="button" className="link" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)}>
                  {showPassword ? 'Hide password' : 'Show password'}
                </button>
              </label>
              {reg && (
                <label>
                  Confirm password
                  <input type={showConfirmPassword ? 'text' : 'password'} value={f.confirm} onChange={set('confirm')} autoComplete="new-password" />
                  <button type="button" className="link" aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'} aria-pressed={showConfirmPassword} onClick={() => setShowConfirmPassword((visible) => !visible)}>
                    {showConfirmPassword ? 'Hide password' : 'Show password'}
                  </button>
                </label>
              )}
              {error && <div className="danger" role="alert">{error}</div>}
              {info && <div className="ok" role="status">{info}</div>}
              {st?.sessionError && <div className="danger" role="status">Saved sign-in could not be restored: {st.sessionError}</div>}
              {st?.error && <p className="muted small">{st.error}</p>}
              <button className="primary big" type="submit" disabled={busy}>{reg ? 'Register' : 'Sign in'}</button>
              <button type="button" className="link" onClick={() => { setView(reg ? 'login' : 'register'); setError(''); }}>
                {reg ? 'Already have an account? Sign in' : 'Register another user'}
              </button>
              <p className="muted small">Sign-in is saved securely on this device when supported.</p>
              <p className="muted small">
                Server: {st?.serverUrl}{' '}
                <button type="button" className="link" onClick={() => { setView('setup'); setError(''); }}>Change</button>
              </p>
              <button type="button" className="link" onClick={() => void continueLocally()}>Continue locally</button>
            </form>
          )}
        </div>
      )}
    </>
  );
}
