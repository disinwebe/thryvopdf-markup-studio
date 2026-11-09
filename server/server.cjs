// ThryvoPDF Markup Studio central auth server. Zero dependencies (Node >= 18).
// Run:  node server/server.cjs      (config via environment variables, see README)
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { createDocs } = require('./docs.cjs');
const { createNotifier } = require('./notify.cjs');

const MIN_PASSWORD = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const KEY_LEN = 64;
const SCRYPT = { N: 16384, r: 8, p: 1 };
const ADMIN_EMAIL = 'admin';
const normEmail = (e) => String(e || '').trim().toLowerCase();
const hashPassword = (pw, salt) => crypto.scryptSync(pw, salt, KEY_LEN, SCRYPT);
const randomPassword = () => crypto.randomBytes(12).toString('base64url');

const STATUS_MSG = {
  pending: 'Your account is awaiting administrator approval.',
  rejected: 'Your registration was rejected. Contact an administrator.',
  disabled: 'This account is disabled. Contact an administrator.',
};

function createApp(opts = {}) {
  const file = opts.file || path.join(process.cwd(), 'pms-users.json');
  const sessionTtlMs = opts.sessionTtlMs ?? 8 * 3600 * 1000;
  const maxFails = opts.maxFails ?? 5;
  const lockMs = opts.lockMs ?? 15 * 60 * 1000;
  const regLimit = opts.regLimit ?? 20; // registrations per IP per hour
  const now = opts.now || Date.now;

  let users = [];
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(j.users)) users = j.users;
  } catch {
    /* new store */
  }
  for (const u of users) {
    u.role ||= 'user';
    u.status ||= 'active'; // accounts created before approval existed
  }
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ version: 2, users }, null, 2));
    fs.renameSync(tmp, file);
  };
  const setPassword = (u, pw) => {
    const salt = crypto.randomBytes(16);
    u.salt = salt.toString('hex');
    u.hash = hashPassword(pw, salt).toString('hex');
  };
  const view = (u) => ({ name: u.name, email: u.email, discipline: u.discipline, role: u.role, status: u.status, mustChange: !!u.mustChange });
  const find = (email) => users.find((u) => u.email === normEmail(email));

  // Seed the default administrator when none exists.
  let seeded = null;
  if (!users.some((u) => u.role === 'admin')) {
    let pw = opts.adminPassword;
    const generated = !pw;
    if (pw && pw.length < MIN_PASSWORD) throw new Error(`PMS_ADMIN_PASSWORD must be at least ${MIN_PASSWORD} characters.`);
    if (!pw) pw = randomPassword();
    const admin = { name: 'Administrator', email: ADMIN_EMAIL, discipline: 'General', role: 'admin', status: 'active', mustChange: true, created: new Date().toISOString() };
    setPassword(admin, pw);
    users = users.filter((u) => u.email !== ADMIN_EMAIL).concat(admin);
    save();
    seeded = { email: ADMIN_EMAIL, password: generated ? pw : null, generated };
    if (generated) {
      seeded.file = path.join(path.dirname(file), 'ADMIN-INITIAL-PASSWORD.txt');
      fs.writeFileSync(seeded.file, `ThryvoPDF Markup Studio initial administrator login\r\nUser: ${ADMIN_EMAIL}\r\nPassword: ${pw}\r\nYou must change this password at first login. Delete this file afterwards.\r\n`);
    }
  }

  const sessions = new Map(); // sha256(token) -> { email, expires }
  const fails = new Map(); // email|ip -> { n, until }
  const regs = new Map(); // ip -> { n, reset }
  const th = (t) => crypto.createHash('sha256').update(t).digest('hex');
  const bearer = (req) => (/^Bearer (.+)$/.exec(req.headers.authorization || '') || [])[1];
  const dropSessions = (email, exceptHash) => {
    for (const [k, s] of sessions) if (s.email === email && k !== exceptHash) sessions.delete(k);
  };

  const newSession = (u) => {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = now() + sessionTtlMs;
    sessions.set(th(token), { email: u.email, expires });
    return { token, expiresAt: expires };
  };
  // Resolves the live user so role/status changes apply immediately.
  const sessionOf = (req) => {
    const t = bearer(req);
    const s = t && sessions.get(th(t));
    if (!s) return null;
    const u = find(s.email);
    if (s.expires <= now() || !u || u.status !== 'active') {
      sessions.delete(th(t));
      return null;
    }
    return { user: u, expires: s.expires, hash: th(t) };
  };
  const NO_SESSION = [401, { ok: false, error: 'Session expired. Sign in again.' }];
  const authed = (fn) => (req, b, ip, ...rest) => {
    const s = sessionOf(req);
    return s ? fn(s, b, ip, ...rest) : NO_SESSION;
  };
  const adminOnly = (fn) =>
    authed((s, b, ip) => {
      if (s.user.role !== 'admin') return [403, { ok: false, error: 'Administrator access required.' }];
      if (s.user.mustChange) return [403, { ok: false, error: 'Change your password first.' }];
      return fn(s, b, ip);
    });
  const activeAdmins = () => users.filter((u) => u.role === 'admin' && u.status === 'active').length;

  const handlers = {
    'GET /api/health': () => [200, { ok: true, hasUsers: users.length > 0, docs: true, docsAccess: true, notifications: true }],

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
      if (find(email)) return [409, { ok: false, error: 'An account with this email already exists.' }];
      const user = { name, email, discipline, role: 'user', status: 'pending', mustChange: false, created: new Date().toISOString() };
      setPassword(user, password);
      users.push(user);
      save();
      notifier.registered(user, users.filter((u) => u.role === 'admin' && u.status === 'active'));
      return [201, { ok: true, pending: true, message: STATUS_MSG.pending }];
    },

    'POST /api/login': (req, b, ip) => {
      const email = normEmail(b.email);
      const key = email + '|' + ip;
      const f = fails.get(key);
      if (f && f.until > now()) return [429, { ok: false, error: 'Too many failed attempts. Try again later.' }];
      const u = find(email);
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
      if (u.status !== 'active') return [403, { ok: false, status: u.status, error: STATUS_MSG[u.status] }];
      return [200, { ok: true, user: view(u), ...newSession(u) }];
    },

    'GET /api/session': authed((s) => [200, { ok: true, user: view(s.user), expiresAt: s.expires }]),

    'POST /api/logout': (req) => {
      const t = bearer(req);
      if (t) sessions.delete(th(t));
      return [200, { ok: true }];
    },

    'POST /api/change-password': authed((s, b) => {
      const u = s.user;
      const got = hashPassword(String(b.current ?? ''), Buffer.from(u.salt, 'hex'));
      if (!crypto.timingSafeEqual(got, Buffer.from(u.hash, 'hex'))) return [401, { ok: false, error: 'Current password is incorrect.' }];
      const pw = String(b.password ?? '');
      if (pw.length < MIN_PASSWORD) return [400, { ok: false, error: `Password must be at least ${MIN_PASSWORD} characters.` }];
      if (pw === String(b.current)) return [400, { ok: false, error: 'Choose a different password.' }];
      setPassword(u, pw);
      u.mustChange = false;
      save();
      dropSessions(u.email, s.hash);
      return [200, { ok: true, user: view(u) }];
    }),

    'GET /api/admin/users': adminOnly(() => [200, { ok: true, users: users.map((u) => ({ ...view(u), created: u.created })) }]),

    'POST /api/admin/update': adminOnly((s, b) => {
      const u = find(b.email);
      if (!u) return [404, { ok: false, error: 'User not found.' }];
      const self = u === s.user;
      const wasActiveAdmin = u.role === 'admin' && u.status === 'active';
      const lastAdmin = wasActiveAdmin && activeAdmins() <= 1;
      const bad = (m) => [400, { ok: false, error: m }];
      switch (b.action) {
        case 'approve':
          if (u.status !== 'pending' && u.status !== 'rejected') return bad('Only pending or rejected users can be approved.');
          u.status = 'active';
          break;
        case 'reject':
          if (u.status !== 'pending') return bad('Only pending users can be rejected.');
          u.status = 'rejected';
          break;
        case 'disable':
          if (self || lastAdmin) return bad('You cannot disable yourself or the last administrator.');
          if (u.status !== 'active') return bad('User is not active.');
          u.status = 'disabled';
          dropSessions(u.email);
          break;
        case 'enable':
          if (u.status !== 'disabled') return bad('User is not disabled.');
          u.status = 'active';
          break;
        case 'role':
          if (b.role !== 'admin' && b.role !== 'user') return bad('Role must be admin or user.');
          if (b.role !== 'admin' && (self || lastAdmin)) return bad('You cannot remove your own or the last administrator role.');
          u.role = b.role;
          break;
        case 'reset': {
          const temp = randomPassword();
          setPassword(u, temp);
          u.mustChange = true;
          dropSessions(u.email);
          save();
          return [200, { ok: true, tempPassword: temp }];
        }
        case 'delete':
          if (self || lastAdmin) return bad('You cannot delete yourself or the last administrator.');
          users = users.filter((x) => x !== u);
          notifier.dropUser(u.email);
          dropSessions(u.email);
          break;
        default:
          return bad('Unknown action.');
      }
      save();
      return [200, { ok: true }];
    }),
  };

  const notifier = createNotifier({ dir: path.dirname(file), now, send: opts.sendMail, log: (m) => console.error(m) });
  const onAssign = (doc, by, emails) => {
    const recipients = emails.map(find).filter((u) => u && u.status === 'active').map((u) => ({ name: u.name, email: u.email }));
    if (recipients.length) notifier.assigned(doc, { name: by.name, email: by.email }, recipients).catch(() => {});
  };
  const onReview = (doc, by, done) => {
    const recipients = doc.members.map(find).filter((u) => u && u.status === 'active').map((u) => ({ name: u.name, email: u.email }));
    return notifier.reviewed(doc, { name: by.name, email: by.email }, recipients, done);
  };
  const docs = createDocs({ onAssign, onReview, dir: opts.docsDir || path.join(path.dirname(file), 'docs'), now, pollMs: opts.pollMs, presenceTtlMs: opts.presenceTtlMs, maxUpload: opts.maxUpload, fs: opts.docsFs });
  const ready = (fn) =>
    authed((s, b, ip, req, url, m) => {
      if (s.user.status !== 'active') return [403, { ok: false, error: 'Account not active.' }];
      if (s.user.mustChange) return [403, { ok: false, error: 'Change your password first.' }];
      if (!docs.isAvailable()) return [503, { ok: false, error: 'Shared library unavailable. Restart the server to recover the group operation.' }];
      return fn(s.user, b, req, url, m);
    });
  const validateMembers = (members) => Array.isArray(members) && members.length <= 500 &&
    members.every((email) => typeof email === 'string' && email === normEmail(email) && find(email)?.status === 'active');
  const invalidMembers = [400, { ok: false, error: 'Select valid active users for document access.' }];
  handlers['GET /api/notifications'] = authed((s) => [200, { ok: true, ...notifier.list(s.user.email) }]);
  handlers['POST /api/notifications/read'] = authed((s, b) => {
    const ids = b.all === true ? 'all' : Array.isArray(b.ids) ? b.ids.filter((i) => typeof i === 'string').slice(0, 500) : [];
    notifier.markRead(s.user.email, ids);
    return [200, { ok: true, ...notifier.list(s.user.email) }];
  });
  const docRoutes = [
    ['GET', /^\/api\/docs$/, ready((u) => docs.list(u))],
    ['GET', /^\/api\/docs\/users$/, ready(() => [200, { ok: true, users: users.filter((u) => u.status === 'active').map((u) => ({ name: u.name, email: u.email, discipline: u.discipline })) }])],
    ['POST', /^\/api\/docs$/, ready((u, b, req, url) => {
      const members = url.searchParams.getAll('member');
      if (!validateMembers(members)) return invalidMembers;
      return docs.upload(u, url.searchParams.get('name') || 'document.pdf', b, { project: url.searchParams.get('project'), rel: url.searchParams.get('rel'), description: url.searchParams.get('description'), members: [...new Set(members)] });
    })],
    ['POST', /^\/api\/docs\/groups\/rename$/, ready((u, b) => docs.renameGroup(u, b))],
    ['POST', /^\/api\/docs\/groups\/delete$/, ready((u, b) => docs.deleteGroup(u, b))],
    ['GET', /^\/api\/docs\/([\w-]+)\/file$/, ready((u, b, req, url, m) => docs.file(m[1], u))],
    ['GET', /^\/api\/docs\/([\w-]+)\/state$/, ready((u, b, req, url, m) => docs.state(m[1], u))],
    ['POST', /^\/api\/docs\/([\w-]+)\/ops$/, ready((u, b, req, url, m) => docs.ops(m[1], u, b))],
    ['POST', /^\/api\/docs\/([\w-]+)\/review$/, ready((u, b, req, url, m) => docs.review(m[1], u, b))],
    ['GET', /^\/api\/docs\/([\w-]+)\/events$/, ready((u, b, req, url, m) => docs.events(m[1], u, Number(url.searchParams.get('since')), Number(url.searchParams.get('pr') || 0)))],
    ['POST', /^\/api\/docs\/([\w-]+)\/leave$/, ready((u, b, req, url, m) => docs.leave(m[1], u))],
    ['POST', /^\/api\/docs\/([\w-]+)\/meta$/, ready((u, b, req, url, m) => docs.meta(m[1], u, b))],
    ['POST', /^\/api\/docs\/([\w-]+)\/members$/, ready((u, b, req, url, m) => validateMembers(b.members) ? docs.setMembers(m[1], u, [...new Set(b.members)]) : invalidMembers)],
  ['DELETE', /^\/api\/docs\/([\w-]+)$/, ready((u, b, req, url, m) => docs.remove(m[1], u))],
  ];

  const listener = (req, res) => {
    const send = (code, body, headers) => {
      if (Buffer.isBuffer(body)) {
        res.writeHead(code, { 'Cache-Control': 'no-store', ...headers });
        return res.end(body);
      }
      res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url || '/', 'http://x');
    let h = handlers[`${req.method} ${url.pathname}`];
    let m = null;
    let raw = false;
    if (!h) {
      for (const [meth, re, fn] of docRoutes) {
        const mm = meth === req.method && re.exec(url.pathname);
        if (mm) {
          h = (rq, b, ip) => fn(rq, b, ip, rq, url, mm);
          raw = meth === 'POST' && url.pathname === '/api/docs';
          m = mm;
          break;
        }
      }
    }
    if (!h) return send(404, { ok: false, error: 'Not found.' });
    const limit = raw ? docs.maxUpload : /^\/api\/docs\/[\w-]+\/ops$/.test(url.pathname) ? 16 * 1024 * 1024 : 16384;
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        tooBig = true;
        return;
      }
      chunks.push(c);
    });
    req.on('end', async () => {
      if (tooBig) return send(413, { ok: false, error: 'Request too large.' });
      const buf = Buffer.concat(chunks);
      let body = {};
      if (raw) body = buf;
      else if (buf.length) {
        try {
          body = JSON.parse(buf.toString('utf8'));
        } catch {
          return send(400, { ok: false, error: 'Invalid JSON.' });
        }
      }
      try {
        const [code, out, headers] = await h(req, body || {}, req.socket.remoteAddress || '');
        send(code, out, headers);
      } catch {
        send(500, { ok: false, error: 'Server error.' });
      }
    });
  };  return { listener, seeded };
}

async function start(opts = {}) {
  const { listener, seeded } = createApp(opts);
  const tls = opts.tlsKey && opts.tlsCert ? { key: fs.readFileSync(opts.tlsKey), cert: fs.readFileSync(opts.tlsCert) } : null;
  const srv = tls ? https.createServer(tls, listener) : http.createServer(listener);
  return new Promise((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(opts.port ?? 8787, opts.host || '0.0.0.0', () => {
      srv.removeListener('error', reject);
      resolve({ server: srv, port: srv.address().port, tls: !!tls, seeded });
    });
  });
}

module.exports = { createApp, start, MIN_PASSWORD, EMAIL_RE };

if (require.main === module) {
  const e = process.env;
  start({
    port: Number(e.PMS_PORT || 8787),
    host: e.PMS_HOST || '0.0.0.0',
    file: e.PMS_USERS_FILE || path.join(__dirname, 'data', 'users.json'),
    adminPassword: e.PMS_ADMIN_PASSWORD,
    tlsKey: e.PMS_TLS_KEY,
    tlsCert: e.PMS_TLS_CERT,
    sessionTtlMs: e.PMS_SESSION_HOURS ? Number(e.PMS_SESSION_HOURS) * 3600e3 : undefined,
  }).then((r) => {
    console.log(`ThryvoPDF Markup Studio server listening on ${r.tls ? 'https' : 'http'}://0.0.0.0:${r.port}`);
    if (r.seeded) {
      console.log(`Default administrator created: user "${r.seeded.email}".`);
      if (r.seeded.generated) console.log(`Initial password (shown once): ${r.seeded.password}\nAlso saved to ${r.seeded.file}`);
      else console.log('Initial password: the value of PMS_ADMIN_PASSWORD.');
      console.log('The administrator must change the password at first login.');
    }
  }).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
