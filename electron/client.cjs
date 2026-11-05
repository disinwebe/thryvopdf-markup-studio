// Auth client used by the Electron main process: talks to the central server, or (explicit fallback) local accounts.
const fs = require('fs');
const path = require('path');
const { createAuth } = require('./auth.cjs');

const TIMEOUT_MS = 6000;

function normalizeUrl(u) {
  let s = String(u || '').trim().replace(/\/+$/, '');
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  try {
    const x = new URL(s);
    return x.origin;
  } catch {
    return '';
  }
}

function createClient({ configFile, localFile, fetch: f = globalThis.fetch }) {
  let cfg = { mode: null, serverUrl: '' };
  try {
    cfg = { ...cfg, ...JSON.parse(fs.readFileSync(configFile, 'utf8')) };
  } catch {
    /* first run */
  }
  const local = createAuth(localFile);
  let session = null; // { user, token, expiresAt }

  const saveCfg = () => {
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2));
  };

  async function call(base, method, url, body, token, o = {}) {
    const headers = o.bytes ? { 'Content-Type': 'application/octet-stream' } : { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    let res;
    try {
      res = await f(base + url, { method, headers, body: o.bytes ? Buffer.from(body) : body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(o.timeout || TIMEOUT_MS) });
    } catch (e) {
      return { ok: false, offline: true, error: `Cannot reach the server at ${base}. Check the address, that the server is running, and the firewall/network.` };
    }
    if (o.download && res.ok) return { ok: true, bytes: new Uint8Array(await res.arrayBuffer()), name: decodeURIComponent(res.headers.get('x-doc-name') || '') };
    try {
      const j = await res.json();
      if (res.status === 401 && token) j.expired = true;
      if (res.status === 404 && j.error === 'Not found.') return { ok: false, error: `The server at ${base} does not support this feature (). It is probably running an older server version: update and restart the server on the server PC.` };
      return j;
    } catch {
      return { ok: false, error: `Unexpected response from ${base}. Is this a ThryvoPDF Markup Studio server?` };
    }
  }

  const current = () => {
    if (cfg.mode === 'local') return local.current();
    if (session && session.expiresAt <= Date.now()) session = null;
    return session && !session.user.mustChange ? session.user : null;
  };

  const adopt = (r) => {
    if (r.ok && r.token) {
      session = { user: r.user, token: r.token, expiresAt: r.expiresAt };
      return { ok: true, user: r.user };
    }
    if (r.ok && r.pending) return { ok: true, pending: true, message: r.message };
    return { ok: false, error: r.error || 'Request failed.' };
  };

  return {
    current,
    normalizeUrl,

    async status() {
      const base = { mode: cfg.mode, serverUrl: cfg.serverUrl, configured: cfg.mode === 'local' || (cfg.mode === 'server' && !!cfg.serverUrl) };
      if (cfg.mode === 'local') return { ...base, online: true, ...local.status() };
      if (!base.configured) return { ...base, online: false, hasUsers: false, user: null };
      const h = await call(cfg.serverUrl, 'GET', '/api/health');
      if (!h.ok) return { ...base, online: false, hasUsers: false, user: null, error: h.error };
      return { ...base, online: true, hasUsers: !!h.hasUsers, user: current() };
    },

    async test(url) {
      const u = normalizeUrl(url);
      if (!u) return { ok: false, error: 'Enter a valid server address, e.g. 192.168.1.10:8787' };
      const h = await call(u, 'GET', '/api/health');
      return h.ok ? { ok: true, url: u, hasUsers: !!h.hasUsers } : { ok: false, error: h.error };
    },

    async configure({ mode, serverUrl }) {
      if (mode === 'local') {
        cfg = { mode: 'local', serverUrl: cfg.serverUrl };
      } else {
        const t = await this.test(serverUrl);
        if (!t.ok) return t;
        cfg = { mode: 'server', serverUrl: t.url };
      }
      session = null;
      local.logout();
      saveCfg();
      return { ok: true };
    },

    async register(a) {
      if (String(a.password ?? '') !== String(a.confirm ?? '')) return { ok: false, error: 'Passwords do not match.' };
      if (cfg.mode === 'local') return local.register(a);
      return adopt(await call(cfg.serverUrl, 'POST', '/api/register', a));
    },

    async login(a) {
      if (cfg.mode === 'local') return local.login(a);
      return adopt(await call(cfg.serverUrl, 'POST', '/api/login', { email: a.email, password: a.password }));
    },

    async changePassword({ current, password, confirm }) {
      if (cfg.mode !== 'server' || !session) return { ok: false, error: 'Not signed in to a server.' };
      if (String(password ?? '') !== String(confirm ?? '')) return { ok: false, error: 'Passwords do not match.' };
      const r = await call(cfg.serverUrl, 'POST', '/api/change-password', { current, password }, session.token);
      if (r.ok) session.user = r.user;
      return r.ok ? { ok: true, user: r.user } : { ok: false, error: r.error };
    },

    async adminList() {
      if (!session) return { ok: false, error: 'Not signed in.' };
      return call(cfg.serverUrl, 'GET', '/api/admin/users', null, session.token);
    },

    async adminAction(a) {
      if (!session) return { ok: false, error: 'Not signed in.' };
      return call(cfg.serverUrl, 'POST', '/api/admin/update', a, session.token);
    },

    async docs(a = {}) {
      if (cfg.mode !== 'server' || !session) return { ok: false, error: 'Shared documents need a signed-in server connection.' };
      const t = session.token;
      const u = cfg.serverUrl;
      const id = encodeURIComponent(a.id || '');
      switch (a.op) {
        case 'list': return call(u, 'GET', '/api/docs', null, t);
        case 'upload': return call(u, 'POST', '/api/docs?name=' + encodeURIComponent(a.name || 'document.pdf') + '&project=' + encodeURIComponent(a.project || '') + '&rel=' + encodeURIComponent(a.rel || ''), a.bytes, t, { bytes: true, timeout: 120000 });
        case 'open': {
          const file = await call(u, 'GET', '/api/docs/' + id + '/file', null, t, { download: true, timeout: 120000 });
          if (!file.ok) return file;
          const st = await call(u, 'GET', '/api/docs/' + id + '/state', null, t);
          return st.ok ? { ...st, bytes: file.bytes } : st;
        }
        case 'ops': return call(u, 'POST', '/api/docs/' + id + '/ops', { upserts: a.upserts || [], deletes: a.deletes || [], cid: a.cid }, t);
        case 'poll': return call(u, 'GET', '/api/docs/' + id + '/events?since=' + Number(a.since) + '&pr=' + Number(a.pr || 0), null, t, { timeout: 40000 });
        case 'leave': return call(u, 'POST', '/api/docs/' + id + '/leave', {}, t);
        case 'delete': return call(u, 'DELETE', '/api/docs/' + id, null, t);
        default: return { ok: false, error: 'Unknown operation.' };
      }
    },

    async logout() {
      if (cfg.mode === 'local') return local.logout();
      const s = session;
      session = null;
      if (s) await call(cfg.serverUrl, 'POST', '/api/logout', null, s.token);
      return { ok: true };
    },
  };
}

module.exports = { createClient, normalizeUrl };
