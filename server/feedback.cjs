const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CATEGORIES = new Set(['bug', 'suggestion', 'usability']);
const STATUSES = new Set(['new', 'reviewed', 'closed']);
const text = (value) => typeof value === 'string' ? value.trim() : '';

function createFeedback({ file, now = Date.now } = {}) {
  const storeFile = file || path.join(process.cwd(), 'feedback.json');
  let submissions = [];
  try {
    submissions = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
    if (!Array.isArray(submissions)) throw new Error('Feedback store must contain an array.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const save = (next) => {
    fs.mkdirSync(path.dirname(storeFile), { recursive: true });
    const temporary = `${storeFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, storeFile);
  };

  return {
    submit(user, body) {
      const category = text(body.category);
      const subject = text(body.subject);
      const message = text(body.message);
      const steps = text(body.steps);
      const version = text(body.appVersion);
      const platform = text(body.platform);
      if (!CATEGORIES.has(category)) return [400, { ok: false, error: 'Choose a feedback category.' }];
      if (!subject || subject.length > 120) return [400, { ok: false, error: 'Enter a subject between 1 and 120 characters.' }];
      if (!message || message.length > 5000) return [400, { ok: false, error: 'Enter details between 1 and 5000 characters.' }];
      if (steps.length > 5000) return [400, { ok: false, error: 'Steps to reproduce must be 5000 characters or fewer.' }];
      if (version.length > 40 || platform.length > 120) return [400, { ok: false, error: 'App information is invalid.' }];

      const submission = {
        id: crypto.randomUUID(),
        category,
        subject,
        message,
        steps,
        created: new Date(now()).toISOString(),
        status: 'new',
        user: { name: text(user.name), email: text(user.email) },
        app: { version, platform },
      };
      const next = [submission, ...submissions];
      save(next);
      submissions = next;
      return [201, { ok: true, id: submission.id }];
    },
    list() {
      return submissions.map((submission) => ({ ...submission, user: { ...submission.user }, app: { ...submission.app } }));
    },
    setStatus(id, status) {
      if (!STATUSES.has(status)) return [400, { ok: false, error: 'Choose a valid feedback status.' }];
      const submission = submissions.find((item) => item.id === id);
      if (!submission) return [404, { ok: false, error: 'Feedback submission not found.' }];
      const next = submissions.map((item) => item.id === id ? { ...item, status } : item);
      save(next);
      submissions = next;
      return [200, { ok: true }];
    },
    remove(id) {
      const remaining = submissions.filter((item) => item.id !== id);
      if (remaining.length === submissions.length) return [404, { ok: false, error: 'Feedback submission not found.' }];
      save(remaining);
      submissions = remaining;
      return [200, { ok: true }];
    },
  };
}

module.exports = { createFeedback };
