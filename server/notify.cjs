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
  };
}

// Minimal SMTP client (AUTH PLAIN/LOGIN, STARTTLS). Resolves on success, rejects on any failure.
function sendMail(cfg, to, subject, text, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const fromAddr = (/<([^>]+)>/.exec(cfg.from) || [null, cfg.from])[1];
    if (!cfg.host || !EMAIL_RE.test(fromAddr) || !EMAIL_RE.test(to)) return reject(new Error('Invalid SMTP sender or recipient.'));
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
        await cmd('AUTH PLAIN ' + auth, [235]);
      }
      await cmd(`MAIL FROM:<${fromAddr}>`, [250]);
      await cmd(`RCPT TO:<${to}>`, [250, 251]);
      await cmd('DATA', [354]);
      const body = text.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
      const head = [`From: ${cfg.from}`, `To: ${to}`, `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`, `Date: ${new Date().toUTCString()}`, `Message-ID: <${crypto.randomBytes(12).toString('hex')}@thryvopdf>`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64'].join('\r\n');
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
