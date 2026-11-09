import { useCallback, useEffect, useRef, useState } from 'react';

const POLL_INTERVAL_MS = 30_000;

export type NotificationState = { notifications: AppNotification[]; unread: number; error: boolean };

/** Polls the server inbox after each request completes; only active in server mode. */
export function useNotifications(user: AuthUser | null, serverMode: boolean) {
  const scope = serverMode && user && !user.mustChange ? user.email : null;
  const [snap, setSnap] = useState<{ scope: string; state: NotificationState } | null>(null);
  const stopRef = useRef(false);

  const apply = useCallback((scopeKey: string, r: Awaited<ReturnType<NonNullable<Window['api']>['notifications']>>) => {
    if (stopRef.current) return;
    if (r.ok && r.notifications) setSnap({ scope: scopeKey, state: { notifications: r.notifications, unread: r.unread ?? 0, error: false } });
    else setSnap((s) => ({ scope: scopeKey, state: { notifications: s?.scope === scopeKey ? s.state.notifications : [], unread: s?.scope === scopeKey ? s.state.unread : 0, error: true } }));
  }, []);

  useEffect(() => {
    setSnap(null);
    if (scope === null || !window.api) return;
    stopRef.current = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try { apply(scope, await window.api!.notifications()); } catch { apply(scope, { ok: false }); }
      if (!stopRef.current) timer = setTimeout(poll, POLL_INTERVAL_MS);
    };
    void poll();
    return () => { stopRef.current = true; if (timer !== undefined) clearTimeout(timer); };
  }, [scope, apply]);

  const markRead = useCallback(async (read: string[] | 'all') => {
    if (scope === null || !window.api) return;
    try { apply(scope, await window.api.notifications({ read })); } catch { /* next poll retries */ }
  }, [scope, apply]);

  if (scope === null) return null;
  return { state: snap?.scope === scope ? snap.state : { notifications: [], unread: 0, error: false }, markRead };
}

export type NotificationsApi = NonNullable<ReturnType<typeof useNotifications>>;

export function NotificationBell({ api, onOpenShared, onOpenNotification }: { api: NotificationsApi | null; onOpenShared?: () => void; onOpenNotification?: (notification: AppNotification) => void }) {
  const [open, setOpen] = useState(false);
  if (!api) return null;
  const { state, markRead } = api;
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
            <button type="button" onClick={() => void markRead('all')} disabled={state.unread === 0}>Mark all read</button>
          </div>
          {state.error && <p className="muted">Could not refresh notifications. Retrying shortly.</p>}
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
