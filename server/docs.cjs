// Shared document library: stores PDFs + their markups on the server, serializes edits, tracks presence.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TYPES = new Set([
  'highlight', 'text', 'callout', 'cloud', 'rect', 'ellipse', 'line', 'arrow', 'polyline', 'pen', 'stamp', 'note',
  'm-length', 'm-polylength', 'm-area', 'm-perimeter', 'm-angle', 'm-count',
]);
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_MARKUPS = 20000;
const MAX_BATCH = 2000;
const LOG_KEEP = 1000;

function validMarkup(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return 'Markup must be an object.';
  if (typeof m.id !== 'string' || !ID_RE.test(m.id)) return 'Invalid markup id.';
  if (!Number.isInteger(m.page) || m.page < 0 || m.page > 100000) return 'Invalid page.';
  if (!TYPES.has(m.type)) return 'Unknown markup type.';
  if (!Array.isArray(m.points) || m.points.length > 50000) return 'Invalid points.';
  for (const p of m.points) if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return 'Invalid point.';
  if (typeof m.color !== 'string' || m.color.length > 40) return 'Invalid color.';
  if (!Number.isFinite(m.width) || !Number.isFinite(m.opacity)) return 'Invalid width or opacity.';
  if (typeof m.author !== 'string' || typeof m.date !== 'string' || typeof m.status !== 'string') return 'Missing author, date or status.';
  if (!Array.isArray(m.comments)) return 'Invalid comments.';
  if (JSON.stringify(m).length > 262144) return 'Markup too large.';
  return null;
}

const cleanName = (n) => {
  let s = path.basename(String(n || 'document.pdf')).replace(/[^\w .()\-+]/g, '_').slice(0, 120).trim() || 'document';
  if (!/\.pdf$/i.test(s)) s += '.pdf';
  return s;
};

// Project names and relative folder paths come from the client; keep them printable, short and traversal-free.
const cleanProject = (n) => String(n || '').replace(/[^\w .()\-+]/g, '_').replace(/^[ .]+|[ .]+$/g, '').slice(0, 80);
const cleanRel = (r) =>
  String(r || '')
    .split(/[\\/]+/)
    .map((s) => s.replace(/[^\w .()\-+]/g, '_').replace(/^\.+/, '').trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 12)
    .join('/');

function createDocs({ dir, now = Date.now, pollMs = 20000, presenceTtlMs = 45000, maxUpload = 150 * 1024 * 1024 }) {
  fs.mkdirSync(dir, { recursive: true });
  const docs = new Map();

  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (!ID_RE.test(j.id) || !fs.existsSync(path.join(dir, j.id + '.pdf'))) continue;
      docs.set(j.id, {
        id: j.id, name: j.name, owner: j.owner, ownerName: j.ownerName, created: j.created, size: j.size, project: j.project || '', rel: j.rel || '',
        version: j.version || 0, markups: new Map((j.markups || []).map((m) => [m.id, m])),
        log: [], logStart: j.version || 0, presence: new Map(), presenceRev: 0, waiters: [],
      });
    } catch {
      /* skip unreadable record */
    }
  }

  const persist = (d) => {
    const f = path.join(dir, d.id + '.json');
    const body = { id: d.id, name: d.name, owner: d.owner, ownerName: d.ownerName, created: d.created, size: d.size, project: d.project, rel: d.rel, version: d.version, markups: [...d.markups.values()] };
    fs.writeFileSync(f + '.tmp', JSON.stringify(body));
    fs.renameSync(f + '.tmp', f);
  };

  const live = (d) => {
    const t = now();
    let changed = false;
    for (const [k, p] of d.presence) if (t - p.last > presenceTtlMs) { d.presence.delete(k); changed = true; }
    if (changed) d.presenceRev++;
    return [...d.presence.values()].map((p) => ({ name: p.name, email: p.email, discipline: p.discipline }));
  };
  const touch = (d, user) => {
    live(d);
    if (!d.presence.has(user.email)) d.presenceRev++;
    d.presence.set(user.email, { name: user.name, email: user.email, discipline: user.discipline, last: now() });
  };

  const snapshot = (d, extra = {}) => ({ ok: true, version: d.version, pr: d.presenceRev, presence: live(d), ...extra });
  const wake = (d) => {
    const pending = d.waiters;
    d.waiters = [];
    for (const w of pending) {
      if (d.version > w.since || d.presenceRev !== w.pr) w.done();
      else d.waiters.push(w);
    }
  };
  const info = (d) => ({ id: d.id, name: d.name, owner: d.ownerName, size: d.size, created: d.created, project: d.project, rel: d.rel, version: d.version, markups: d.markups.size, users: live(d).map((p) => p.name) });
  const get = (id) => docs.get(id) || null;
  const NOT_FOUND = [404, { ok: false, error: 'Shared document not found.' }];

  return {
    list: () => [200, { ok: true, docs: [...docs.values()].map(info).sort((a, b) => b.created.localeCompare(a.created)) }],
    maxUpload,

    upload(user, name, bytes, meta = {}) {
      if (!Buffer.isBuffer(bytes) || bytes.length < 8 || !bytes.subarray(0, 1024).includes('%PDF-')) return [400, { ok: false, error: 'The file is not a PDF.' }];
      const id = crypto.randomBytes(12).toString('base64url');
      const d = { id, name: cleanName(name), owner: user.email, ownerName: user.name, created: new Date(now()).toISOString(), size: bytes.length, project: cleanProject(meta.project), rel: cleanRel(meta.rel), version: 0, markups: new Map(), log: [], logStart: 0, presence: new Map(), presenceRev: 0, waiters: [] };
      fs.writeFileSync(path.join(dir, id + '.pdf'), bytes);
      persist(d);
      docs.set(id, d);
      return [201, { ok: true, doc: info(d) }];
    },

    file(id) {
      const d = get(id);
      if (!d) return NOT_FOUND;
      return [200, fs.readFileSync(path.join(dir, d.id + '.pdf')), { 'X-Doc-Name': encodeURIComponent(d.name) }];
    },

    state(id, user) {
      const d = get(id);
      if (!d) return NOT_FOUND;
      touch(d, user);
      return [200, snapshot(d, { name: d.name, markups: [...d.markups.values()] })];
    },

    ops(id, user, b) {
      const d = get(id);
      if (!d) return NOT_FOUND;
      const ups = Array.isArray(b.upserts) ? b.upserts : [];
      const dels = Array.isArray(b.deletes) ? b.deletes : [];
      if (ups.length > MAX_BATCH || dels.length > MAX_BATCH) return [413, { ok: false, error: 'Too many changes in one request.' }];
      for (const m of ups) {
        const err = validMarkup(m);
        if (err) return [400, { ok: false, error: err }];
      }
      for (const x of dels) if (typeof x !== 'string' || !ID_RE.test(x)) return [400, { ok: false, error: 'Invalid markup id.' }];
      const fresh = ups.filter((m) => !d.markups.has(m.id)).length;
      if (d.markups.size + fresh > MAX_MARKUPS) return [413, { ok: false, error: 'This document has reached the markup limit.' }];
      const real = dels.filter((x) => d.markups.has(x));
      if (!ups.length && !real.length) return [200, snapshot(d)];
      // Authorship is server-controlled: new markups/comments get the session user's name; existing ones keep theirs.
      for (const m of ups) {
        const prev = d.markups.get(m.id);
        const known = new Map(((prev && prev.comments) || []).map((c) => [c.id, c.author]));
        m.author = prev ? prev.author : user.name;
        if (Array.isArray(m.comments)) {
          for (const c of m.comments) if (c && typeof c === 'object') c.author = known.has(c.id) ? known.get(c.id) : user.name;
        }
        d.markups.set(m.id, m);
      }
      for (const x of real) d.markups.delete(x);
      d.version++;
      d.log.push({ v: d.version, by: user.name, byEmail: user.email, cid: String(b.cid || '').slice(0, 40), upserts: ups, deletes: real });
      if (d.log.length > LOG_KEEP) {
        d.log.splice(0, d.log.length - LOG_KEEP);
        d.logStart = d.log[0].v - 1;
      }
      touch(d, user);
      persist(d);
      wake(d);
      return [200, snapshot(d)];
    },

    // Long poll: returns when newer ops exist, presence changed, or the wait elapses. Also the presence heartbeat.
    events(id, user, since, pr) {
      const d = get(id);
      if (!d) return NOT_FOUND;
      touch(d, user);
      const build = () => {
        if (since < d.logStart || since > d.version) return snapshot(d, { reset: true, markups: [...d.markups.values()] });
        return snapshot(d, { ops: d.log.filter((o) => o.v > since).map((o) => ({ v: o.v, by: o.by, byEmail: o.byEmail, cid: o.cid, upserts: o.upserts, deletes: o.deletes })) });
      };
      if (since !== d.version || pr !== d.presenceRev) return [200, build()];
      return new Promise((resolve) => {
        const w = { since, pr, done: () => { clearTimeout(timer); resolve([200, build()]); } };
        const timer = setTimeout(() => {
          d.waiters = d.waiters.filter((x) => x !== w);
          touch(d, user);
          w.done();
        }, pollMs);
        d.waiters.push(w);
      });
    },

    leave(id, user) {
      const d = get(id);
      if (d && d.presence.delete(user.email)) {
        d.presenceRev++;
        wake(d);
      }
      return [200, { ok: true }];
    },

    remove(id, user) {
      const d = get(id);
      if (!d) return NOT_FOUND;
      if (d.owner !== user.email && user.role !== 'admin') return [403, { ok: false, error: 'Only the uploader or an administrator can delete a shared document.' }];
      docs.delete(id);
      for (const ext of ['.pdf', '.json']) fs.rmSync(path.join(dir, id + ext), { force: true });
      for (const w of d.waiters) w.done();
      return [200, { ok: true }];
    },
  };
}

module.exports = { createDocs, validMarkup, cleanProject, cleanRel };
