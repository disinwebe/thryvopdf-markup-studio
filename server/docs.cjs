// Shared document library: stores PDFs + their markups on the server, serializes edits, tracks presence.
const crypto = require('crypto');
const defaultFs = require('fs');
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
  if (m.cloudArc !== undefined && (m.type !== 'cloud' || !Number.isFinite(m.cloudArc) || m.cloudArc < 4 || m.cloudArc > 80)) return 'Invalid cloud arc diameter.';
  if (m.stampLockAspectRatio !== undefined && (m.type !== 'stamp' || typeof m.stampLockAspectRatio !== 'boolean')) return 'Invalid stamp aspect ratio setting.';
  if (typeof m.author !== 'string' || typeof m.date !== 'string' || typeof m.status !== 'string') return 'Missing author, date or status.';
  if (!Array.isArray(m.comments)) return 'Invalid comments.';
  if (m.type === 'line' && m.comments.length) return 'Plain line drawings cannot have comments.';
  const seen = new Set();
  for (const c of m.comments) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) return 'Invalid comment.';
    if (typeof c.id !== 'string' || !ID_RE.test(c.id) || seen.has(c.id)) return 'Invalid comment id.';
    seen.add(c.id);
    if (typeof c.text !== 'string' || c.text.length > 5000 || typeof c.date !== 'string') return 'Invalid comment text.';
    if (c.fontSize !== undefined && (!Number.isInteger(c.fontSize) || c.fontSize < 7 || c.fontSize > 18)) return 'Invalid comment text size.';
  }
  if (m.callout !== undefined && (!m.callout || !Number.isFinite(m.callout.x) || !Number.isFinite(m.callout.y))) return 'Invalid comment box position.';
  if (m.calloutHidden !== undefined && typeof m.calloutHidden !== 'boolean') return 'Invalid comment box visibility.';
  if (m.calloutSize !== undefined && (!m.calloutSize || !Number.isFinite(m.calloutSize.width) || !Number.isFinite(m.calloutSize.height) || m.calloutSize.width < 80 || m.calloutSize.width > 4000 || m.calloutSize.height < 45 || m.calloutSize.height > 4000)) return 'Invalid comment box size.';
  if (m.stampImage !== undefined) {
    const i = m.stampImage;
    if (m.type !== 'stamp' || !i || typeof i !== 'object' ||
        !Number.isInteger(i.width) || i.width < 1 || i.width > 800 ||
        !Number.isInteger(i.height) || i.height < 1 || i.height > 800 ||
        typeof i.data !== 'string' || i.data.length > 180000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(i.data)) return 'Invalid stamp image.';
  }
  if (JSON.stringify(m).length > 262144) return 'Markup too large.';
  return null;
}

const isAdmin = (u) => u.role === 'admin';
// Comment ownership: by e-mail when stamped, by name for older comments.
const ownsMarkup = (m, u) => (m.authorEmail ? m.authorEmail === u.email : m.author === u.name);
const ownsComment = (c, u) => (c.authorEmail ? c.authorEmail === u.email : c.author === u.name);

/** Edit/delete rules for comments: only the author edits; only the author (or an administrator) deletes. */
function commentError(prev, m, user) {
  const old = new Map(((prev && prev.comments) || []).map((c) => [c.id, c]));
  const incoming = new Set(m.comments.map((c) => c.id));
  if (prev && (JSON.stringify(prev.callout) !== JSON.stringify(m.callout) || prev.calloutHidden !== m.calloutHidden)
    && [...old.values()].some((c) => !ownsComment(c, user))) return 'Only the authors of comments in this callout can change its position or visibility.';
  for (const c of m.comments) {
    const o = old.get(c.id);
    if (o && (o.text !== c.text || o.fontSize !== c.fontSize) && !ownsComment(o, user)) return 'Only the author of a comment can edit it.';
  }
  for (const o of old.values()) if (!incoming.has(o.id) && !ownsComment(o, user)) return 'Only the author of a comment can delete it.';
  return null;
}

const cleanName = (n) => {
  let s = path.basename(String(n || 'document.pdf')).replace(/[^\w .()\-+]/g, '_').slice(0, 120).trim() || 'document';
  if (!/\.pdf$/i.test(s)) s += '.pdf';
  return s;
};

// Project names and relative folder paths come from the client; keep them printable, short and traversal-free.
const cleanDescription = (n) => String(n || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, 500);
const cleanProject = (n) => String(n || '').replace(/[^\w .()\-+]/g, '_').replace(/^[ .]+|[ .]+$/g, '').slice(0, 80);
const cleanRel = (r) =>
  String(r || '')
    .split(/[\\/]+/)
    .map((s) => s.replace(/[^\w .()\-+]/g, '_').replace(/^\.+/, '').trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 12)
    .join('/');

function createDocs({ dir, now = Date.now, pollMs = 20000, presenceTtlMs = 45000, maxUpload = 150 * 1024 * 1024, fs = defaultFs, onAssign = () => {}, onReview = () => {} }) {
  fs.mkdirSync(dir, { recursive: true });
  const docs = new Map();
  const journal = path.join(dir, '.group-rename-journal');
  const deleteJournal = path.join(dir, '.group-delete-journal');
  let unavailable = false;

  const replayDelete = () => {
    const tx = JSON.parse(fs.readFileSync(deleteJournal, 'utf8'));
    if (!tx || !Array.isArray(tx.ids) || !tx.ids.length || !tx.ids.every((id) => typeof id === 'string' && ID_RE.test(id)) ||
        new Set(tx.ids).size !== tx.ids.length || typeof tx.project !== 'string' || !tx.project || cleanProject(tx.project) !== tx.project) throw new Error('Invalid group delete journal.');
    for (const id of tx.ids) {
      for (const ext of ['.pdf', '.json']) fs.rmSync(path.join(dir, id + ext), { force: true });
    }
    fs.unlinkSync(deleteJournal);
  };

  // The committed journal is replayed before serving requests, including after a partial write.
  const replayRename = () => {
    const tx = JSON.parse(fs.readFileSync(journal, 'utf8'));
    if (!tx || !Array.isArray(tx.ids) || !tx.ids.length || !tx.ids.every((id) => typeof id === 'string' && ID_RE.test(id)) ||
        typeof tx.project !== 'string' || !tx.project || cleanProject(tx.project) !== tx.project) throw new Error('Invalid group rename journal.');
    for (const id of tx.ids) {
      const file = path.join(dir, id + '.json');
      const record = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (record.id !== id) throw new Error('Invalid document in group rename journal.');
      record.project = tx.project;
      fs.writeFileSync(file + '.tmp', JSON.stringify(record));
      fs.renameSync(file + '.tmp', file);
    }
    fs.unlinkSync(journal);
  };
  if (fs.existsSync(journal)) replayRename();
  if (fs.existsSync(deleteJournal)) replayDelete();

  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (!ID_RE.test(j.id) || !fs.existsSync(path.join(dir, j.id + '.pdf'))) continue;
      docs.set(j.id, {
        id: j.id, name: j.name, owner: j.owner, ownerName: j.ownerName, created: j.created, size: j.size, project: j.project || '', description: j.description || '', rel: j.rel || '',
        members: Array.isArray(j.members) && j.members.every((m) => typeof m === 'string') ? j.members : [],
        reviews: new Map((Array.isArray(j.reviews) ? j.reviews : []).filter((r) =>
          r && typeof r.email === 'string' && Number.isInteger(r.doneVersion) && typeof r.updated === 'string',
        ).map((r) => [r.email, { doneVersion: r.doneVersion, updated: r.updated }])),
        version: j.version || 0, markups: new Map((j.markups || []).map((m) => [m.id, m])),
        log: [], logStart: j.version || 0, presence: new Map(), presenceRev: 0, waiters: [],
      });
    } catch {
      /* skip unreadable record */
    }
  }

  const persist = (d) => {
    const f = path.join(dir, d.id + '.json');
    const body = { id: d.id, name: d.name, owner: d.owner, ownerName: d.ownerName, created: d.created, size: d.size, project: d.project, description: d.description, rel: d.rel, ...(d.members === null ? {} : { members: d.members }), version: d.version, markups: [...d.markups.values()], reviews: [...d.reviews].map(([email, review]) => ({ email, ...review })) };
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
  const canAccess = (d, user) => d.owner === user.email || d.members.includes(user.email);
  const groupRevision = (group) => crypto.createHash('sha256').update(JSON.stringify(group.map((d) => d.id).sort())).digest('hex');
  const info = (d, user, ownedProjects) => ({ id: d.id, name: d.name, owner: d.ownerName, ownerEmail: d.owner, size: d.size, created: d.created, project: d.project, description: d.description || '', rel: d.rel, version: d.version, markups: d.markups.size, users: live(d).map((p) => p.name), reviews: d.members.map((email) => ({ email, done: d.reviews.get(email)?.doneVersion === d.version, updated: d.reviews.get(email)?.updated || null })), ...(d.owner === user.email ? { members: d.members } : {}), canRenameGroup: !!d.project && (isAdmin(user) || (ownedProjects ? ownedProjects.has(d.project) : [...docs.values()].some((other) => other.project === d.project && other.owner === user.email))) });
  const get = (id) => docs.get(id) || null;
  const NOT_FOUND = [404, { ok: false, error: 'Shared document not found.' }];
  const FORBIDDEN = [403, { ok: false, error: 'You do not have access to this shared document.' }];

  return {
    list: (user) => {
      const ownedProjects = new Set([...docs.values()].filter((d) => d.owner === user.email).map((d) => d.project));
      const groups = new Map();
      for (const d of docs.values()) if (d.project) {
        if (!groups.has(d.project)) groups.set(d.project, []);
        groups.get(d.project).push(d);
      }
      const permissions = new Map([...groups].map(([project, group]) => {
        const allowed = group.every((d) => canAccess(d, user)) && (isAdmin(user) || group.every((d) => d.owner === user.email));
        return [project, allowed ? groupRevision(group) : null];
      }));
      return [200, { ok: true, docs: [...docs.values()].filter((d) => canAccess(d, user)).map((d) => {
        const revision = permissions.get(d.project);
        return { ...info(d, user, ownedProjects), canDeleteGroup: !!revision, ...(revision ? { deleteGroupRevision: revision } : {}) };
      }).sort((a, b) => b.created.localeCompare(a.created)) }];
    },
    maxUpload,
    isAvailable: () => !unavailable,

    deleteGroup(user, b) {
      if (!b || typeof b.project !== 'string' || !b.project || cleanProject(b.project) !== b.project || typeof b.revision !== 'string' || !/^[a-f0-9]{64}$/.test(b.revision)) return [400, { ok: false, error: 'A group and its current revision are required.' }];
      const affected = [...docs.values()].filter((d) => d.project === b.project);
      if (!affected.length) return [404, { ok: false, error: 'Group not found.' }];
      if (affected.some((d) => !canAccess(d, user))) return FORBIDDEN;
      if (!isAdmin(user) && !affected.every((d) => d.owner === user.email)) return [403, { ok: false, error: 'Only an administrator or the uploader of every document can delete this group.' }];
      if (groupRevision(affected) !== b.revision) return [409, { ok: false, error: 'The group changed. Refresh and confirm deletion again.' }];
      const temp = deleteJournal + '.tmp';
      try {
        fs.writeFileSync(temp, JSON.stringify({ ids: affected.map((d) => d.id), project: b.project }));
        fs.renameSync(temp, deleteJournal);
      } catch (err) {
        try { fs.rmSync(temp, { force: true }); } catch { /* uncommitted temp is ignored */ }
        if (!fs.existsSync(deleteJournal)) throw err;
        unavailable = true;
        for (const d of docs.values()) for (const w of d.waiters.splice(0)) w.fail([503, { ok: false, error: 'Shared library unavailable. Restart the server to recover the group deletion.' }]);
        return [503, { ok: false, error: 'Shared library unavailable. Restart the server to recover the group deletion.' }];
      }
      try {
        replayDelete();
      } catch {
        unavailable = true;
        for (const d of docs.values()) for (const w of d.waiters.splice(0)) w.fail([503, { ok: false, error: 'Shared library unavailable. Restart the server to recover the group deletion.' }]);
        return [503, { ok: false, error: 'Shared library unavailable. Restart the server to recover the group deletion.' }];
      }
      for (const d of affected) {
        docs.delete(d.id);
        for (const w of d.waiters.splice(0)) w.fail(NOT_FOUND);
      }
      return [200, { ok: true, project: b.project, count: affected.length }];
    },

    renameGroup(user, b) {
      if (!b || typeof b.project !== 'string' || !b.project || typeof b.newProject !== 'string') return [400, { ok: false, error: 'Source and new group name are required.' }];
      const name = b.newProject.trim();
      if (!name || name.length > 80 || cleanProject(name) !== name) return [400, { ok: false, error: 'Invalid group name.' }];
      const affected = [...docs.values()].filter((d) => d.project === b.project);
      if (!affected.length) return [404, { ok: false, error: 'Group not found.' }];
      if (affected.some((d) => !canAccess(d, user))) return FORBIDDEN;
      if (!isAdmin(user) && !affected.some((d) => d.owner === user.email)) return [403, { ok: false, error: 'Only an administrator or an uploader in the group can rename it.' }];
      if (name === b.project) return [400, { ok: false, error: 'Choose a different group name.' }];
      if ([...docs.values()].some((d) => d.project !== b.project && d.project.toLowerCase() === name.toLowerCase())) return [409, { ok: false, error: 'A group with that name already exists.' }];
      const temp = journal + '.tmp';
      try {
        fs.writeFileSync(temp, JSON.stringify({ ids: affected.map((d) => d.id), project: name }));
        fs.renameSync(temp, journal);
      } catch (err) {
        try { fs.rmSync(temp, { force: true }); } catch { /* leave uncommitted temp for cleanup */ }
        throw err;
      }
      try {
        replayRename();
      } catch {
        // Do not serve a partially persisted library; restart replays the committed journal.
        unavailable = true;
        return [503, { ok: false, error: 'Shared library unavailable. Restart the server to recover the group rename.' }];
      }
      for (const d of affected) d.project = name;
      return [200, { ok: true, project: b.project, newProject: name, count: affected.length }];
    },

    upload(user, name, bytes, meta = {}) {
      if (!Buffer.isBuffer(bytes) || bytes.length < 8 || !bytes.subarray(0, 1024).includes('%PDF-')) return [400, { ok: false, error: 'The file is not a PDF.' }];
      const id = crypto.randomBytes(12).toString('base64url');
      const d = { id, name: cleanName(name), owner: user.email, ownerName: user.name, created: new Date(now()).toISOString(), size: bytes.length, project: cleanProject(meta.project), description: cleanDescription(meta.description), rel: cleanRel(meta.rel), members: meta.members || [], reviews: new Map(), version: 0, markups: new Map(), log: [], logStart: 0, presence: new Map(), presenceRev: 0, waiters: [] };
      fs.writeFileSync(path.join(dir, id + '.pdf'), bytes);
      persist(d);
      docs.set(id, d);
      onAssign(d, user, d.members);
      return [201, { ok: true, doc: info(d, user) }];
    },

    file(id, user) {
      const d = get(id);
      if (!d) return NOT_FOUND;
      if (!canAccess(d, user)) return FORBIDDEN;
      return [200, fs.readFileSync(path.join(dir, d.id + '.pdf')), { 'X-Doc-Name': encodeURIComponent(d.name) }];
    },

    state(id, user) {
      const d = get(id);
      if (!d) return NOT_FOUND;
      if (!canAccess(d, user)) return FORBIDDEN;
      touch(d, user);
      return [200, snapshot(d, { name: d.name, markups: [...d.markups.values()] })];
    },

    ops(id, user, b) {
      const d = get(id);
      if (!d) return NOT_FOUND;
      if (!canAccess(d, user)) return FORBIDDEN;
      const ups = Array.isArray(b.upserts) ? b.upserts : [];
      const dels = Array.isArray(b.deletes) ? b.deletes : [];
      if (ups.length > MAX_BATCH || dels.length > MAX_BATCH) return [413, { ok: false, error: 'Too many changes in one request.' }];
      for (const m of ups) {
        const err = validMarkup(m);
        if (err) return [400, { ok: false, error: err }];
      }
      for (const x of dels) if (typeof x !== 'string' || !ID_RE.test(x)) return [400, { ok: false, error: 'Invalid markup id.' }];
      const denied = new Set();
      let deniedMsg = '';
      for (const m of ups) {
        const prev = d.markups.get(m.id);
        const e = prev && !ownsMarkup(prev, user) && JSON.stringify(prev) !== JSON.stringify(m)
          ? 'Only the author of a markup can edit it.'
          : commentError(prev, m, user);
        if (e) { denied.add(m.id); deniedMsg = deniedMsg || e; }
      }
      for (const x of dels) {
        const prev = d.markups.get(x);
        if (prev && !ownsMarkup(prev, user)) {
          denied.add(x);
          deniedMsg = deniedMsg || 'Only the author of a markup can delete it.';
        }
      }
      if (denied.size) {
        return [403, { ok: false, forbidden: true, error: deniedMsg, current: [...denied].map((id) => d.markups.get(id)).filter(Boolean), gone: [...denied].filter((id) => !d.markups.has(id)) }];
      }
      const fresh = ups.filter((m) => !d.markups.has(m.id)).length;
      if (d.markups.size + fresh > MAX_MARKUPS) return [413, { ok: false, error: 'This document has reached the markup limit.' }];
      const real = dels.filter((x) => d.markups.has(x));
      if (!ups.length && !real.length) return [200, snapshot(d)];
      // Authorship is server-controlled: new markups/comments get the session user's name; existing ones keep theirs.
      for (const m of ups) {
        const prev = d.markups.get(m.id);
        const known = new Map(((prev && prev.comments) || []).map((c) => [c.id, c]));
        m.author = prev ? prev.author : user.name;
        if (prev && prev.authorEmail) m.authorEmail = prev.authorEmail;
        else if (!prev) m.authorEmail = user.email;
        else delete m.authorEmail;
        for (const c of m.comments) {
          const o = known.get(c.id);
          if (o) {
            c.author = o.author;
            c.date = o.date;
            if (o.authorEmail) c.authorEmail = o.authorEmail; else delete c.authorEmail;
            if (o.text !== c.text) c.edited = new Date(now()).toISOString();
            else if (o.edited) c.edited = o.edited; else delete c.edited;
          } else {
            c.author = user.name;
            c.authorEmail = user.email;
            delete c.edited;
          }
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
      if (!canAccess(d, user)) return FORBIDDEN;
      touch(d, user);
      const build = () => {
        if (since < d.logStart || since > d.version) return snapshot(d, { reset: true, markups: [...d.markups.values()] });
        return snapshot(d, { ops: d.log.filter((o) => o.v > since).map((o) => ({ v: o.v, by: o.by, byEmail: o.byEmail, cid: o.cid, upserts: o.upserts, deletes: o.deletes })) });
      };
      if (since !== d.version || pr !== d.presenceRev) return [200, build()];
      return new Promise((resolve) => {
        const w = { since, pr, done: () => { clearTimeout(timer); resolve(unavailable ? [503, { ok: false, error: 'Shared library unavailable. Restart the server to recover.' }] : !docs.has(id) ? NOT_FOUND : canAccess(d, user) ? [200, build()] : FORBIDDEN); }, fail: (result) => { clearTimeout(timer); resolve(result); } };
        const timer = setTimeout(() => {
          d.waiters = d.waiters.filter((x) => x !== w);
          if (canAccess(d, user)) touch(d, user);
          w.done();
        }, pollMs);
        d.waiters.push(w);
      });
    },

    leave(id, user) {
      const d = get(id);
      if (!d) return NOT_FOUND;
      if (!canAccess(d, user)) return FORBIDDEN;
      if (d && d.presence.delete(user.email)) {
        d.presenceRev++;
        wake(d);
      }
      return [200, { ok: true }];
    },

    /** Moves a document to another group and/or edits its description (uploader or administrator). */
    meta(id, user, b) {
      const d = get(id);
      if (!d) return NOT_FOUND;
      if (!canAccess(d, user)) return FORBIDDEN;
      if (d.owner !== user.email && user.role !== 'admin') return [403, { ok: false, error: 'Only the uploader or an administrator can change a shared document\'s group or description.' }];
      if (b && typeof b.project === 'string') d.project = cleanProject(b.project);
      if (b && typeof b.description === 'string') d.description = cleanDescription(b.description);
      persist(d);
      return [200, { ok: true, doc: info(d, user) }];
    },
    remove(id, user) {
      const d = get(id);
      if (!d) return NOT_FOUND;
      if (!canAccess(d, user)) return FORBIDDEN;
      if (d.owner !== user.email && user.role !== 'admin') return [403, { ok: false, error: 'Only the uploader or an administrator can delete a shared document.' }];
      docs.delete(id);
      for (const ext of ['.pdf', '.json']) fs.rmSync(path.join(dir, id + ext), { force: true });
      for (const w of d.waiters) w.done();
      return [200, { ok: true }];
    },
    setMembers(id, user, members) {
      const d = get(id);
      if (!d) return NOT_FOUND;
      if (d.owner !== user.email) return [403, { ok: false, error: 'Only the uploader can change document access.' }];
      const added = members.filter((m) => !d.members.includes(m));
      d.members = members;
      for (const email of d.reviews.keys()) if (!members.includes(email)) d.reviews.delete(email);
      for (const email of d.presence.keys()) if (!canAccess(d, { email })) d.presence.delete(email);
      d.presenceRev++;
      persist(d);
      wake(d);
      onAssign(d, user, added);
      return [200, { ok: true, doc: info(d, user) }];
    },
    review(id, user, b) {
      const d = get(id);
      if (!d) return NOT_FOUND;
      if (!canAccess(d, user)) return FORBIDDEN;
      if (!d.members.includes(user.email)) return [403, { ok: false, error: 'Only assigned users can update review status.' }];
      if (!b || typeof b.done !== 'boolean') return [400, { ok: false, error: 'Review status must be done or reopened.' }];
      if (b.done) d.reviews.set(user.email, { doneVersion: d.version, updated: new Date(now()).toISOString() });
      else d.reviews.delete(user.email);
      persist(d);
      onReview(d, user, b.done);
      return [200, { ok: true, reviews: info(d, user).reviews }];
    },
  };
}

module.exports = { createDocs, validMarkup, cleanProject, cleanRel, cleanDescription };
