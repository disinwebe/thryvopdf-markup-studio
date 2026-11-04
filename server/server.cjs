// Plan Markup Studio central auth server. Zero dependencies (Node >= 18).
// Run:  node server/server.cjs      (config via environment variables, see README)
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const MIN_PASSWORD = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const KEY_LEN = 64;
const SCRYPT = { N: 16384, r: 8, p: 1 };
const normEmail = (e) => String(e || '').trim().toLowerCase();
const hashPassword = (pw, salt) => crypto.scryptSync(pw, salt, KEY_LEN, SCRYPT);

function createApp(opts = {}) {
  const file = opts.file || path.join(process.cwd(), 'pms-users.json');
  const sessionTtlMs = opts.sessionTtlMs ?? 8 * 3600 * 1000;
  const maxFails = opts.maxFails ?? 5;
  const lockMs = opts.lockMs ?? 15 * 60 * 1000;
  const regLimit = opts.regLimit ?? 20; // registrations per IP per hour
  const adminToken = opts.adminToken || '';
  const now = opts.now || Date.now;

  let users = [];
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(j.users)) users = j.users;
  } catch {
    /* new store */
  }
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, users }, null, 2));
    fs.renameSync(tmp, file);
  };
  const pub = (u) => ({ name: u.name, email: u.email, discipline: u.discipline });

  const sessions = new Map(); // sha256(token) -> { user, expires }
  const fails = new Map(); // email|ip -> { n, until }
  const regs = new Map(); // ip -> { n, reset }
  const th = (t) => crypto.createHash('sha256').update(t).digest('hex');
  const bearer = (req) => (/^Bearer (.+)$/.exec(req.headers.authorization || '') || [])[1];

  const newSession = (u) => {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = now() + sessionTtlMs;
    sessions.set(th(token), { user: pub(u), expires });
    return { token, expiresAt: expires };
  };
  const sessionOf = (req) => {
    const t = bearer(req);
    const s = t && sessions.get(th(t));
    if (!s) return null;
    if (s.expires <= now()) {
      sessions.delete(th(t));
      return null;
    }
    return s;
  };

  const handlers = {
    'GET /api/health': () => [200, { ok: true, hasUsers: users.length > 0 }],

    'POST /api/register': (req, b, ip) => {
      const r = regs.get(ip);
      if (!r || r.reset <= now()) regs.set(ip, { n: 1, reset: now() + 3600e3 });
      else if (++r.n > regLimit) return [429, { ok: false, error: 'Too many registrations from this computer. Try later.' }];
      const name = String(b.name || '').trim();
      const email = normEmail(b.email);
      const discipline = String(b.discipline || '').trim();
      const password = String(b.password ?? '');
      if (!name) return [400, { ok: false, error: 'Name is required.' }];
      if (!EMAIL_RE.test(email)) return [400, { ok: false, error: 'Enter a valid email address.' }];
      if (!discipline) return [400, { ok: false, error: 'Select a discipline.' }];
      if (password.length < MIN_PASSWORD) return [400, { ok: false, error: `Password must be at least ${MIN_PASSWORD} characters.` }];
      if (users.some((u) => u.email === email)) return [409, { ok: false, error: 'An account with this email already exists.' }];
      const salt = crypto.randomBytes(16);
      const user = { name, email, discipline, salt: salt.toString('hex'), hash: hashPassword(password, salt).toString('hex'), created: new Date().toISOString() };
      users.push(user);
      save();
      return [201, { ok: true, user: pub(user), ...newSession(user) }];
    },

    'POST /api/login': (req, b, ip) => {
      const email = normEmail(b.email);
      const key = email + '|' + ip;
      const f = fails.get(key);
      if (f && f.until > now()) return [429, { ok: false, error: 'Too many failed attempts. Try again later.' }];
      const u = users.find((x) => x.email === email);
      const salt = Buffer.from(u ? u.salt : '00'.repeat(16), 'hex');
      const got = hashPassword(String(b.password ?? ''), salt);
      const want = Buffer.from(u ? u.hash : '00'.repeat(KEY_LEN), 'hex');
      if (!u || !crypto.timingSafeEqual(got, want)) {
        const prev = f && !(f.until && f.until <= now()) ? f.n : 0;
        const n = prev + 1;
        fails.set(key, { n, until: n >= maxFails ? now() + lockMs : 0 });
        return [401, { ok: false, error: 'Incorrect email or password.' }];
      }
      fails.delete(key);
      return [200, { ok: true, user: pub(u), ...newSession(u) }];
    },

    'GET /api/session': (req) => {
      const s = sessionOf(req);
      return s ? [200, { ok: true, user: s.user, expiresAt: s.expires }] : [401, { ok: false, error: 'Session expired. Sign in again.' }];
    },

    'POST /api/logout': (req) => {
      const t = bearer(req);
      if (t) sessions.delete(th(t));
      return [200, { ok: true }];
    },

    'GET /api/users': (req) => {
      if (!adminToken) return [403, { ok: false, error: 'Admin access is disabled (set PMS_ADMIN_TOKEN).' }];
      const given = Buffer.from(String(req.headers['x-admin-token'] || ''));
      const want = Buffer.from(adminToken);
      if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return [401, { ok: false, error: 'Bad admin token.' }];
      return [200, { ok: true, users: users.map((u) => ({ ...pub(u), created: u.created })) }];
    },
  };

  const listener = (req, res) => {
    const send = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    const h = handlers[`${req.method} ${(req.url || '').split('?')[0]}`];
    if (!h) return send(404, { ok: false, error: 'Not found.' });
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 16384) req.destroy();
    });
    req.on('end', () => {
      let body = {};
      try {
        if (data) body = JSON.parse(data);
      } catch {
        return send(400, { ok: false, error: 'Invalid JSON.' });
      }
      try {
        const [code, out] = h(req, body || {}, req.socket.remoteAddress || '');
        send(code, out);
      } catch {
        send(500, { ok: false, error: 'Server error.' });
      }
    });
  };
  return { listener, userCount: () => users.length };
}

function start(opts = {}) {
  const { listener } = createApp(opts);
  const tls = opts.tlsKey && opts.tlsCert ? { key: fs.readFileSync(opts.tlsKey), cert: fs.readFileSync(opts.tlsCert) } : null;
  const srv = tls ? https.createServer(tls, listener) : http.createServer(listener);
  return new Promise((resolve) => srv.listen(opts.port ?? 8787, opts.host || '0.0.0.0', () => resolve({ server: srv, port: srv.address().port, tls: !!tls })));
}

module.exports = { createApp, start, MIN_PASSWORD, EMAIL_RE };

if (require.main === module) {
  const e = process.env;
  start({
    port: Number(e.PMS_PORT || 8787),
    host: e.PMS_HOST || '0.0.0.0',
    file: e.PMS_USERS_FILE || path.join(__dirname, 'data', 'users.json'),
    adminToken: e.PMS_ADMIN_TOKEN,
    tlsKey: e.PMS_TLS_KEY,
    tlsCert: e.PMS_TLS_CERT,
    sessionTtlMs: e.PMS_SESSION_HOURS ? Number(e.PMS_SESSION_HOURS) * 3600e3 : undefined,
  }).then((r) => console.log(`Plan Markup Studio server listening on ${r.tls ? 'https' : 'http'}://0.0.0.0:${r.port}`));
}
