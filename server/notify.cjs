// Assignment notifications: persistent in-app inbox plus optional SMTP email.
// SMTP settings live in <data folder>/notify.json (edited by ThryvoPDF Server Manager).
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');
const tls = require('tls');

const MAX_PER_USER = 200;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const clean = (s, n) => String(s ?? '').replace(/[\r\n\0]+/g, ' ').trim().slice(0, n);

function normalizeSmtp(c = {}) {
  const port = Number(c.port);
  return {
    enabled: c.enabled === true,
    host: clean(c.host, 255),
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 587,
    secure: c.secure === true, // implicit TLS (typically 465); otherwise STARTTLS when offered
    user: clean(c.user, 255),
    password: typeof c.password === 'string' ? c.password.slice(0, 512) : '',
    from: clean(c.from, 255),
    provider: c.provider === 'graph' ? 'graph' : 'smtp',
    tenantId: clean(c.tenantId, 100),
    clientId: clean(c.clientId, 100),
    clientSecret: typeof c.clientSecret === 'string' ? c.clientSecret.trim().slice(0, 512) : '',
  };
}

// Microsoft Graph sender (OAuth client credentials). Works when basic SMTP sign-in is blocked.
const tokens = new Map();
async function graphFetch(url, init, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: ctl.signal }); }
  catch (e) { throw new Error(e.name === 'AbortError' ? 'Microsoft Graph timed out.' : 'Could not reach Microsoft (' + (e.cause?.code || e.message) + ').'); }
  finally { clearTimeout(timer); }
}
async function graphToken(cfg, timeoutMs) {
  const key = [cfg.tenantId, cfg.clientId, cfg.clientSecret].join('|');
  const hit = tokens.get(key);
  if (hit && hit.expires > Date.now() + 60000) return hit.token;
  const body = new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' });
  const res = await graphFetch('https://login.microsoftonline.com/' + encodeURIComponent(cfg.tenantId) + '/oauth2/v2.0/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }, timeoutMs);
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error('Microsoft sign-in failed: ' + clean(j.error_description || j.error || res.status, 300));
  tokens.set(key, { token: j.access_token, expires: Date.now() + (Number(j.expires_in) || 3600) * 1000 });
  return j.access_token;
}
async function sendGraph(cfg, to, subject, text, timeoutMs, cc = []) {
  const sender = (/<([^>]+)>/.exec(cfg.from) || [null, cfg.from])[1];
  if (!cfg.tenantId || !cfg.clientId || !cfg.clientSecret || !EMAIL_RE.test(sender) || !EMAIL_RE.test(to) || !cc.every((email) => EMAIL_RE.test(email))) throw new Error('Invalid Microsoft Graph settings, sender or recipient.');
  const token = await graphToken(cfg, timeoutMs);
  const res = await graphFetch('https://graph.microsoft.com/v1.0/users/' + encodeURIComponent(sender) + '/sendMail', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { subject, body: { contentType: 'Text', content: text }, toRecipients: [{ emailAddress: { address: to } }], ...(cc.length ? { ccRecipients: cc.map((address) => ({ emailAddress: { address } })) } : {}) }, saveToSentItems: false }),
  }, timeoutMs);
  if (res.status !== 202) {
    if (res.status === 401) tokens.clear();
    const j = await res.json().catch(() => ({}));
    throw new Error('Microsoft Graph error ' + res.status + ': ' + clean(j.error?.message || j.error?.code || '', 300));
  }
}

// Minimal SMTP client (AUTH PLAIN/LOGIN, STARTTLS). Resolves on success, rejects on any failure.
function sendMail(cfg, to, subject, text, timeoutMs = 20000, cc = []) {
  const ccList = [...new Set(cc)].filter((email) => email !== to);
  if (cfg.provider === 'graph') return sendGraph(cfg, to, subject, text, timeoutMs, ccList);
  return new Promise((resolve, reject) => {
    const fromAddr = (/<([^>]+)>/.exec(cfg.from) || [null, cfg.from])[1];
    if (!cfg.host || !EMAIL_RE.test(fromAddr) || !EMAIL_RE.test(to) || !ccList.every((email) => EMAIL_RE.test(email))) return reject(new Error('Invalid SMTP sender or recipient.'));
    let sock;
    let buf = '';
    let waiter = null;
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { sock.destroy(); } catch { /* ignore */ }
      err ? reject(err) : resolve();
    };
    const timer = setTimeout(() => finish(new Error('SMTP timed out.')), timeoutMs);
    const pump = () => {
      if (!waiter) return;
      const lines = buf.split('\r\n');
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i])) {
          const text = lines.slice(0, i + 1).join('\n');
          buf = lines.slice(i + 1).join('\r\n');
          const w = waiter;
          waiter = null;
          return w({ code: Number(lines[i].slice(0, 3)), text });
        }
      }
    };
    const attach = (s) => {
      sock = s;
      s.setEncoding('utf8');
      s.on('data', (d) => { buf += d; pump(); });
      s.on('error', finish);
      s.on('close', () => finish(new Error('SMTP connection closed.')));
    };
    const reply = () => new Promise((r) => { waiter = r; pump(); });
    const cmd = async (line, ok) => {
      if (line !== null) sock.write(line + '\r\n');
      const r = await reply();
      if (!ok.includes(r.code)) throw new Error('SMTP error: ' + r.text.slice(0, 200));
      return r;
    };
    const run = async () => {
      await cmd(null, [220]);
      let ehlo = await cmd('EHLO thryvopdf', [250]);
      if (!cfg.secure && /STARTTLS/i.test(ehlo.text)) {
        await cmd('STARTTLS', [220]);
        const plain = sock;
        plain.removeAllListeners();
        buf = '';
        attach(tls.connect({ socket: plain, servername: cfg.host }));
        ehlo = await cmd('EHLO thryvopdf', [250]);
      }
      if (cfg.user) {
        const auth = Buffer.from(`\0${cfg.user}\0${cfg.password}`).toString('base64');
        const methods = /AUTH[ =](.*)/i.exec(ehlo.text)?.[1] || 'PLAIN';
        if (/PLAIN/i.test(methods) || !/LOGIN/i.test(methods)) await cmd('AUTH PLAIN ' + auth, [235]);
        else {
          await cmd('AUTH LOGIN', [334]);
          await cmd(Buffer.from(cfg.user).toString('base64'), [334]);
          await cmd(Buffer.from(cfg.password).toString('base64'), [235]);
        }
      }
      await cmd(`MAIL FROM:<${fromAddr}>`, [250]);
      await cmd(`RCPT TO:<${to}>`, [250, 251]);
      for (const address of ccList) await cmd(`RCPT TO:<${address}>`, [250, 251]);
      await cmd('DATA', [354]);
      const body = text.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
      const head = [`From: ${cfg.from}`, `To: ${to}`, ...(ccList.length ? [`Cc: ${ccList.join(', ')}`] : []), `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`, `Date: ${new Date().toUTCString()}`, `Message-ID: <${crypto.randomBytes(12).toString('hex')}@thryvopdf>`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64'].join('\r\n');
      const b64 = Buffer.from(body).toString('base64').replace(/(.{76})/g, '$1\r\n');
      await cmd(`${head}\r\n\r\n${b64}\r\n.`, [250]);
      await cmd('QUIT', [221]).catch(() => {});
    };
    const onConnect = () => run().then(() => finish(), finish);
    const opts = { host: cfg.host, port: cfg.port };
    if (cfg.secure) {
      const s = tls.connect({ ...opts, servername: cfg.host }, onConnect);
      attach(s);
    } else {
      const s = net.connect(opts, onConnect);
      attach(s);
    }
  });
}

function createNotifier({ dir, now = Date.now, send = sendMail, log = () => {} }) {
  const inboxFile = path.join(dir, 'notifications.json');
  const configFile = path.join(dir, 'notify.json');
  let inbox = {};
  try {
    const j = JSON.parse(fs.readFileSync(inboxFile, 'utf8'));
    if (j && typeof j.inbox === 'object' && j.inbox) inbox = j.inbox;
  } catch { /* new store */ }
  const save = () => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = inboxFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, inbox }));
      fs.renameSync(tmp, inboxFile);
    } catch (e) {
      log('Could not save notifications: ' + e.message);
    }
  };
  const smtp = () => {
    try { return normalizeSmtp(JSON.parse(fs.readFileSync(configFile, 'utf8')).smtp); } catch { return normalizeSmtp(); }
  };
  const view = (n) => ({ id: n.id, type: n.type, docId: n.docId, docName: n.docName, by: n.by, message: n.message, created: n.created, read: !!n.read });

  return {
    registered(user, admins) {
      const created = new Date(now()).toISOString();
      for (const admin of [...new Map(admins.map((a) => [a.email, a])).values()]) {
        const items = inbox[admin.email] || (inbox[admin.email] = []);
        items.unshift({
          id: crypto.randomBytes(9).toString('base64url'),
          type: 'registration',
          message: `${user.name} (${user.email}) is awaiting administrator approval.`,
          created,
          read: false,
        });
        if (items.length > MAX_PER_USER) items.length = MAX_PER_USER;
      }
      if (admins.length) save();
    },
    reviewed(doc, by, recipients, done) {
      const created = new Date(now()).toISOString();
      const list = [...new Map(recipients.map((r) => [r.email, r])).values()].filter((r) => r.email !== by.email);
      for (const recipient of list) {
        const items = inbox[recipient.email] || (inbox[recipient.email] = []);
        items.unshift({
          id: crypto.randomBytes(9).toString('base64url'),
          type: 'review',
          docId: doc.id,
          docName: doc.name,
          by: by.name,
          message: `${by.name} ${done ? 'marked the review done for' : 'reopened the review for'} "${doc.name}".`,
          created,
          read: false,
        });
        if (items.length > MAX_PER_USER) items.length = MAX_PER_USER;
      }
      if (list.length) save();
      if (!done) return Promise.resolve();
      const cfg = smtp();
      const owner = { name: doc.ownerName || doc.owner, email: doc.owner };
      if (!cfg.enabled || !EMAIL_RE.test(owner.email)) return Promise.resolve();
      const cc = [...new Set(recipients.map((recipient) => recipient.email))]
        .filter((email) => email !== owner.email && EMAIL_RE.test(email));
      const text = `${by.name} marked their review as done for "${doc.name}".\n\nUploader: ${owner.name} (${owner.email})\nDocument: ${doc.name}\n\nThis is an automated message from your ThryvoPDF server.`;
      return Promise.resolve().then(() => send(cfg, owner.email, `Review completed: ${doc.name}`.slice(0, 200), text, undefined, cc))
        .catch((e) => log(`Review completion email to ${owner.email} failed: ${e.message}`));
    },
    // Records an in-app alert and sends an email for each newly assigned user.
    assigned(doc, by, recipients, publicUrl) {
      const created = new Date(now()).toISOString();
      const list = [...new Set(recipients)].filter((r) => r.email !== by.email);
      for (const r of list) {
        const message = `${by.name} assigned you to review and mark up "${doc.name}".`;
        const items = inbox[r.email] || (inbox[r.email] = []);
        items.unshift({ id: crypto.randomBytes(9).toString('base64url'), type: 'assignment', docId: doc.id, docName: doc.name, by: by.name, message, created, read: false });
        if (items.length > MAX_PER_USER) items.length = MAX_PER_USER;
      }
      if (list.length) save();
      const cfg = smtp();
      if (!cfg.enabled) return Promise.resolve();
      return Promise.all(list.filter((r) => EMAIL_RE.test(r.email)).map((r) => {
        const text = `Hello ${r.name},\n\n${by.name} has assigned you to the shared PDF "${doc.name}" for review and markups.\n\nOpen ThryvoPDF Markup Studio, choose Shared Documents and open the document to begin.${publicUrl ? `\nServer: ${publicUrl}` : ''}\n\nThis is an automated message from your ThryvoPDF server.`;
        return send(cfg, r.email, `Markup assignment: ${doc.name}`.slice(0, 200), text).catch((e) => log(`Email to ${r.email} failed: ${e.message}`));
      }));
    },
    list(email) {
      const items = inbox[email] || [];
      return { notifications: items.map(view), unread: items.filter((n) => !n.read).length };
    },
    markRead(email, ids) {
      let changed = false;
      for (const n of inbox[email] || []) {
        if ((ids === 'all' || ids.includes(n.id)) && !n.read) { n.read = true; changed = true; }
      }
      if (changed) save();
    },
    dropUser(email) {
      if (inbox[email]) { delete inbox[email]; save(); }
    },
  };
}

module.exports = { createNotifier, sendMail, normalizeSmtp };
