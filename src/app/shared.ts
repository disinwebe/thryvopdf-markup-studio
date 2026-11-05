import { Markup } from '../core/types';

export type Synced = Record<string, string>;

export interface RemoteOp {
  v: number;
  cid?: string;
  upserts: Markup[];
  deletes: string[];
}

export const syncedOf = (markups: Markup[]): Synced => Object.fromEntries(markups.map((m) => [m.id, JSON.stringify(m)]));

/** Local changes not yet known to the server. */
export function diffMarkups(markups: Markup[], synced: Synced) {
  const upserts = markups.filter((m) => synced[m.id] !== JSON.stringify(m));
  const ids = new Set(markups.map((m) => m.id));
  const deletes = Object.keys(synced).filter((id) => !ids.has(id));
  return { upserts, deletes };
}

/**
 * Applies server-authoritative ops. Ops from this client (same cid) only update the synced baseline so that
 * newer local edits of the same markup are not clobbered; ops from others win (last writer wins).
 */
export function applyOps(markups: Markup[], synced: Synced, ops: RemoteOp[], cid: string) {
  let list = markups;
  const next = { ...synced };
  for (const op of ops) {
    const mine = op.cid === cid;
    for (const m of op.upserts) {
      next[m.id] = JSON.stringify(m);
      if (mine) continue;
      list = list.some((x) => x.id === m.id) ? list.map((x) => (x.id === m.id ? m : x)) : [...list, m];
    }
    for (const id of op.deletes) {
      delete next[id];
      if (!mine) list = list.filter((x) => x.id !== id);
    }
  }
  return { markups: list, synced: next };
}
