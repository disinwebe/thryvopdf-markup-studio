import { useCallback, useEffect, useRef, useState } from 'react';

const POLL_INTERVAL_MS = 30_000;

export type NotificationState = { notifications: AppNotification[]; unread: number; error: string | null };

/** Polls the server inbox after each request completes; only active in server mode. */
export function useNotifications(user: AuthUser | null, serverMode: boolean) {
  const scope = serverMode && user && !user.mustChange ? user.email : null;
  const [snap, setSnap] = useState<{ scope: string; state: NotificationState } | null>(null);
  const stopRef = useRef(false);
  const inboxRevision = useRef(0);

  const apply = useCallback((scopeKey: string, r: Awaited<ReturnType<NonNullable<Window['api']>['notifications']>>) => {
    if (stopRef.current) return;
    if (r.ok && r.notifications) setSnap({ scope: scopeKey, state: { notifications: r.notifications, unread: r.unread ?? 0, error: null } });
    else setSnap((s) => ({ scope: scopeKey, state: { notifications: s?.scope === scopeKey ? s.state.notifications : [], unread: s?.scope === scopeKey ? s.state.unread : 0, error: r.error || 'Could not refresh notifications. Retrying shortly.' } }));
  }, []);

  useEffect(() => {
    setSnap(null);
    if (scope === null || !window.api) return;
    stopRef.current = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const revision = inboxRevision.current;
      try {
        const result = await window.api!.notifications();
        if (revision === inboxRevision.current) apply(scope, result);
      } catch {
        if (revision === inboxRevision.current) apply(scope, { ok: false });
      }
      if (!stopRef.current) timer = setTimeout(poll, POLL_INTERVAL_MS);
    };
    void poll();
    return () => { stopRef.current = true; if (timer !== undefined) clearTimeout(timer); };
  }, [scope, apply]);

  useEffect(() => {
    if (scope === null || !window.api?.onNotifications) return;
    return window.api.onNotifications((snapshot) => {
      inboxRevision.current += 1;
      apply(scope, { ok: true, ...snapshot });
    });
  }, [scope, apply]);

  const markRead = useCallback(async (read: string[] | 'all') => {
    if (scope === null || !window.api) return;
    const revision = ++inboxRevision.current;
    try {
      const result = await window.api.notifications({ read });
      if (revision === inboxRevision.current) apply(scope, result);
    } catch {
      if (revision === inboxRevision.current) apply(scope, { ok: false });
    }
  }, [scope, apply]);

  const clearAll = useCallback(async () => {
    if (scope === null || !window.api) return;
    const revision = ++inboxRevision.current;
    const previousState = snap?.scope === scope
      ? snap.state
      : { notifications: [], unread: 0, error: null };
    setSnap({ scope, state: { notifications: [], unread: 0, error: null } });
    try {
      const result = await window.api.notifications({ clear: true });
      if (revision !== inboxRevision.current) return;
      if (!result.ok) {
        setSnap({
          scope,
          state: {
            ...previousState,
            error: `Could not clear notifications: ${result.error || 'server request failed'}. Update ThryvoPDF Server Manager on the shared server, then try again.`,
          },
        });
        return;
      }
      if (result.ok && result.notifications?.length) {
        setSnap({
          scope,
          state: {
            notifications: result.notifications,
            unread: result.unread ?? 0,
            error: 'The server did not clear the inbox. Update ThryvoPDF Server Manager on the shared server, then try again.',
          },
        });
      } else apply(scope, result);
    } catch {
      if (revision === inboxRevision.current) {
        setSnap({
          scope,
          state: { ...previousState, error: 'Could not clear notifications. Check the server connection and retry.' },
        });
      }
    }
  }, [scope, apply, snap]);

  if (scope === null) return null;
  return { state: snap?.scope === scope ? snap.state : { notifications: [], unread: 0, error: null }, markRead, clearAll };
}

export type NotificationsApi = NonNullable<ReturnType<typeof useNotifications>>;

export function NotificationBell({ api, onSignIn, onOpenShared, onOpenNotification }: { api: NotificationsApi | null; onSignIn?: () => void; onOpenShared?: () => void; onOpenNotification?: (notification: AppNotification) => void }) {
  const [open, setOpen] = useState(false);
  if (!api) return (
    <aside className="notifications">
      <button type="button" className="bell" onClick={onSignIn} aria-label="Sign in for collaboration">Sign in for collaboration</button>
    </aside>
  );
  const { state, markRead, clearAll } = api;
  const latest = state.notifications.find((n) => !n.read);
  const openNotification = (notification: AppNotification) => {
    void markRead([notification.id]);
    if (onOpenNotification) onOpenNotification(notification);
    else if (notification.type === 'assignment') onOpenShared?.();
  };
  return (
    <aside className="notifications" aria-live="polite">
      <button type="button" className="bell" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`${state.unread} unread notifications`}>
        Notifications {state.unread > 0 && <span className="badge">{state.unread}</span>}
      </button>
      {!open && latest && (
        <div className="toast" role="status">
          <span>{latest.message}</span>
          <button type="button" onClick={() => openNotification(latest)}>Open</button>
          <button type="button" onClick={() => void markRead([latest.id])} aria-label="Dismiss">×</button>
        </div>
      )}
      {open && (
        <div className="notif-list">
          <div className="row between">
            <strong>Notifications</strong>
            <div className="row">
              <button type="button" onClick={() => void markRead('all')} disabled={state.unread === 0}>Mark all read</button>
              <button type="button" onClick={() => void clearAll()} disabled={state.notifications.length === 0}>Clear all notifications</button>
            </div>
          </div>
          {state.error && <p className="muted" role="status">{state.error}</p>}
          {state.notifications.length === 0 && <p className="muted">No notifications.</p>}
          <ul>
            {state.notifications.map((n) => (
              <li key={n.id} className={n.read ? '' : 'unread'}>
                <span>{n.message}</span>
                <time dateTime={n.created}>{new Date(n.created).toLocaleString()}</time>
                <button type="button" onClick={() => openNotification(n)}>Open</button>
                {!n.read && <button type="button" onClick={() => void markRead([n.id])}>Mark read</button>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
