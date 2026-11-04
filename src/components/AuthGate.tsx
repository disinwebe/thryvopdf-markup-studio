import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { DISCIPLINE_LIST } from '../core/types';

type Mode = 'register' | 'login';

export default function AuthGate({ children }: { children: (user: AuthUser, logout: () => void) => ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [error, setError] = useState('');
  const [f, setF] = useState({ name: '', email: '', discipline: DISCIPLINE_LIST[0], password: '', confirm: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  useEffect(() => {
    if (!window.api) return setUser({ name: 'User', email: '', discipline: '' }); // plain browser/dev preview
    window.api.authStatus().then((s) => {
      if (s.user) setUser(s.user);
      else setMode(s.hasUsers ? 'login' : 'register');
    });
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const r = mode === 'register' ? await window.api!.register(f) : await window.api!.login(f);
    if (r.ok) {
      setUser(r.user);
      setF((s) => ({ ...s, password: '', confirm: '' }));
    } else setError(r.error);
  };

  const logout = async () => {
    await window.api?.logout();
    setUser(null);
    setMode('login');
    setError('');
  };

  if (user) return <>{children(user, logout)}</>;
  if (!mode) return null;

  const reg = mode === 'register';
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
        <button className="primary big" type="submit">{reg ? 'Register' : 'Sign in'}</button>
        <button type="button" className="link" onClick={() => { setMode(reg ? 'login' : 'register'); setError(''); }}>
          {reg ? 'Already have an account? Sign in' : 'Register another user'}
        </button>
        <p className="muted small">Accounts are stored only on this computer.</p>
      </form>
    </div>
  );
}
