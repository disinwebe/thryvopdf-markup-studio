import { useEffect, useState } from 'react';

const POLL_INTERVAL_MS = 60_000;

type AdminListResult = {
  ok: boolean;
  users?: ManagedUser[];
  error?: string;
  expired?: boolean;
};

export type PendingRegistrationState =
  | { status: 'loading'; count: null }
  | { status: 'ready'; count: number }
  | { status: 'error' | 'unauthorized'; count: null };

const loading: PendingRegistrationState = { status: 'loading', count: null };

/**
 * Poll after each request completes, so a slow server never accumulates requests.
 * The returned cleanup also suppresses responses from an obsolete session.
 */
export function watchPendingRegistrations(
  list: () => Promise<AdminListResult>,
  publish: (state: PendingRegistrationState) => void,
  intervalMs = POLL_INTERVAL_MS,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const poll = async () => {
    let terminal = false;
    try {
      const result = await list();
      if (stopped) return;
      if (!result.ok) {
        terminal = !!result.expired || result.error === 'Not signed in.' || result.error === 'Administrator access required.';
        publish({ status: terminal ? 'unauthorized' : 'error', count: null });
      } else if (!Array.isArray(result.users)) {
        publish({ status: 'error', count: null });
      } else {
        publish({ status: 'ready', count: result.users.filter((user) => user.status === 'pending').length });
      }
    } catch {
      if (stopped) return;
      publish({ status: 'error', count: null });
    }
    if (!stopped && !terminal) timer = setTimeout(poll, intervalMs);
  };

  void poll();
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}

/**
 * Only server administrators can query this endpoint. Call from a component that
 * unmounts on logout; changing user or mode also invalidates the previous result.
 */
export function usePendingRegistrations(user: AuthUser | null, serverMode: boolean): PendingRegistrationState | null {
  const scope = serverMode && user?.role === 'admin' && !user.mustChange ? user.email : null;
  const [snapshot, setSnapshot] = useState<{ scope: string; state: PendingRegistrationState } | null>(null);

  useEffect(() => {
    setSnapshot(null);
    if (scope === null) return;
    return watchPendingRegistrations(
      () => window.api ? window.api.adminList() : Promise.reject(new Error('API unavailable')),
      (state) => setSnapshot({ scope, state }),
    );
  }, [scope]);

  if (scope === null) return null;
  return snapshot?.scope === scope ? snapshot.state : loading;
}

export function PendingRegistrationsNotice({
  state,
  onManageUsers,
}: {
  state: PendingRegistrationState | null;
  onManageUsers: () => void;
}) {
  if (!state || state.status === 'loading' || (state.status === 'ready' && state.count === 0)) return null;
  return (
    <aside className="pending-registrations" role="status" aria-live="polite">
      {state.status === 'ready' ? (
        <button type="button" onClick={onManageUsers} aria-label={`${state.count} pending registrations. Open user management`}>
          Pending registrations <span className="badge">{state.count}</span>
        </button>
      ) : (
        <span>
          {state.status === 'unauthorized'
            ? 'Cannot check registrations: sign in again or check administrator access.'
            : 'Could not check pending registrations. Retrying shortly.'}
        </span>
      )}
    </aside>
  );
}
