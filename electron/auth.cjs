// Local account store (no server). Users live in a JSON file in the app's userData folder.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MIN_PASSWORD = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const KEY_LEN = 64;
const SCRYPT = { N: 16384, r: 8, p: 1 };

const normEmail = (e) => String(e || '').trim().toLowerCase();

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, KEY_LEN, SCRYPT);
}

function createAuth(file) {
  let current = null;

  const load = () => {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      return Array.isArray(j.users) ? j.users : [];
    } catch {
      return [];
    }
  };
  const save = (users) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, users }, null, 2));
    fs.renameSync(tmp, file);
  };
  const pub = (u) => ({ name: u.name, email: u.email, discipline: u.discipline });

  return {
    status: () => ({ hasUsers: load().length > 0, user: current }),
    current: () => current,

    register({ name, email, discipline, password, confirm }) {
      name = String(name || '').trim();
      email = normEmail(email);
      discipline = String(discipline || '').trim();
      password = String(password ?? '');
      if (!name) return { ok: false, error: 'Name is required.' };
      if (!EMAIL_RE.test(email)) return { ok: false, error: 'Enter a valid email address.' };
      if (!discipline) return { ok: false, error: 'Select a discipline.' };
      if (password.length < MIN_PASSWORD)
        return { ok: false, error: `Password must be at least ${MIN_PASSWORD} characters.` };
      if (password !== String(confirm ?? '')) return { ok: false, error: 'Passwords do not match.' };
      const users = load();
      if (users.some((u) => u.email === email)) return { ok: false, error: 'An account with this email already exists.' };
      const salt = crypto.randomBytes(16);
      const user = {
        name,
        email,
        discipline,
        salt: salt.toString('hex'),
        hash: hashPassword(password, salt).toString('hex'),
        created: new Date().toISOString(),
      };
      save([...users, user]);
      current = pub(user);
      return { ok: true, user: current };
    },

    login({ email, password }) {
      const u = load().find((x) => x.email === normEmail(email));
      const salt = Buffer.from(u ? u.salt : '00'.repeat(16), 'hex');
      const got = hashPassword(String(password ?? ''), salt);
      const want = Buffer.from(u ? u.hash : '00'.repeat(KEY_LEN), 'hex');
      if (!u || got.length !== want.length || !crypto.timingSafeEqual(got, want))
        return { ok: false, error: 'Incorrect email or password.' };
      current = pub(u);
      return { ok: true, user: current };
    },

    logout() {
      current = null;
      return { ok: true };
    },
  };
}

module.exports = { createAuth, MIN_PASSWORD, EMAIL_RE };
