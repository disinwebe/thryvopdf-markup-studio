import { useEffect, useRef } from 'react';
import { uid } from '../core/types';
import { Doc } from './model';
import { applyOps, diffMarkups, syncedOf } from './shared';

type UpdateDoc = (id: string, fn: (d: Doc) => Partial<Doc>) => void;

const PUSH_DELAY = 300;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Keeps tabs that hold a server-hosted document in sync: pushes local markup changes (debounced) and applies
 * server-authoritative changes and presence received through a long-poll loop.
 */
export function useSharedSync(docs: Doc[], docsRef: { current: Doc[] }, updateDoc: UpdateDoc) {
  const cid = useRef(uid()).current;
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const inflight = useRef(new Set<string>());
  const retryAt = useRef(new Map<string, number>());
  const loops = useRef(new Map<string, { alive: boolean; sid: string }>());

  const setStatus = (id: string, status: 'live' | 'offline' | 'expired', error?: string) =>
    updateDoc(id, (cur) => (cur.shared ? { shared: { ...cur.shared, status, error } } : {}));

  const flush = async (id: string) => {
    timers.current.delete(id);
    const d = docsRef.current.find((x) => x.id === id);
    if (!d?.shared || inflight.current.has(id)) return;
    const { upserts, deletes } = diffMarkups(d.markups, d.shared.synced);
    if (!upserts.length && !deletes.length) return;
    const base = d.shared.synced;
    inflight.current.add(id);
    const r = await window.api!.sharedDocs({ op: 'ops', id: d.shared.id, upserts, deletes, cid });
    inflight.current.delete(id);
    if (r.ok) {
      retryAt.current.delete(id);
      updateDoc(id, (cur) => {
        if (!cur.shared) return {};
        const synced = { ...cur.shared.synced };
        // Only advance entries that a remote op did not change while the request was in flight.
        for (const m of upserts) if (synced[m.id] === base[m.id]) synced[m.id] = JSON.stringify(m);
        for (const x of deletes) if (synced[x] === base[x]) delete synced[x];
        return { dirty: false, shared: { ...cur.shared, synced, status: 'live', error: undefined } };
      });
    } else {
      retryAt.current.set(id, Date.now() + (r.offline ? 3000 : 10000));
      setStatus(id, r.expired ? 'expired' : 'offline', r.expired ? 'Session expired. Log out and sign in again; unsynced changes stay in this tab.' : r.error);
    }
  };

  useEffect(() => {
    for (const d of docs) {
      const s = d.shared;
      if (!s || s.status === 'expired' || timers.current.has(d.id) || inflight.current.has(d.id)) continue;
      const { upserts, deletes } = diffMarkups(d.markups, s.synced);
      if (!upserts.length && !deletes.length) continue;
      const wait = Math.max(PUSH_DELAY, (retryAt.current.get(d.id) ?? 0) - Date.now());
      timers.current.set(d.id, setTimeout(() => void flush(d.id), wait));
    }
  });

  const poll = async (id: string, l: { alive: boolean; sid: string }) => {
    while (l.alive) {
      const d = docsRef.current.find((x) => x.id === id);
      if (!d?.shared) return;
      const r = await window.api!.sharedDocs({ op: 'poll', id: l.sid, since: d.shared.version, pr: d.shared.pr });
      if (!l.alive) return;
      if (!r.ok) {
        if (r.expired) return setStatus(id, 'expired', 'Session expired. Log out and sign in again; unsynced changes stay in this tab.');
        setStatus(id, 'offline', r.error);
        if (/not found/i.test(r.error || '')) return setStatus(id, 'offline', 'This shared document was deleted on the server.');
        await sleep(4000);
        continue;
      }
      updateDoc(id, (cur) => {
        const s = cur.shared;
        if (!s) return {};
        const res = r.reset ? { markups: r.markups, synced: syncedOf(r.markups) } : applyOps(cur.markups, s.synced, r.ops || [], cid);
        return { markups: res.markups, shared: { ...s, synced: res.synced, version: r.version, pr: r.pr, collaborators: r.presence || [], status: 'live', error: undefined } };
      });
    }
  };

  useEffect(() => {
    for (const d of docs) {
      if (d.shared && !loops.current.has(d.id)) {
        const l = { alive: true, sid: d.shared.id };
        loops.current.set(d.id, l);
        void poll(d.id, l);
      }
    }
    for (const [id, l] of loops.current) {
      if (!docs.some((d) => d.id === id)) {
        l.alive = false;
        loops.current.delete(id);
        void window.api?.sharedDocs({ op: 'leave', id: l.sid });
      }
    }
  }, [docs]);

  const leaveAll = async () => {
    const ls = [...loops.current.values()];
    ls.forEach((l) => (l.alive = false));
    loops.current.clear();
    await Promise.all(ls.map((l) => window.api?.sharedDocs({ op: 'leave', id: l.sid })));
  };

  useEffect(() => () => { void leaveAll(); }, []);

  return { cid, leaveAll };
}
