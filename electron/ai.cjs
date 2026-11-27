// Gemini client for the Electron main process. The API key never reaches the renderer:
// it comes from GEMINI_API_KEY or is saved on this PC encrypted with Electron safeStorage.
const fs = require('fs');
const path = require('path');

const DEFAULT_MODEL = 'gemini-3.8-flash';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
const TIMEOUT_MS = 120000;
const MAX_PARTS = 40;
const MAX_TEXT_CHARS = 400000;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_TOTAL_BYTES = 18 * 1024 * 1024; // the Gemini inline request limit is 20 MB
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MODEL_RE = /^[a-z0-9][a-z0-9.\-]{1,79}$/i;

function createAi({ configFile, keyFile, safeStorage, fetch: f = globalThis.fetch, env = process.env }) {
  let cfg = { model: DEFAULT_MODEL };
  try {
    cfg = { ...cfg, ...JSON.parse(fs.readFileSync(configFile, 'utf8')) };
  } catch {
    /* first run */
  }
  if (!MODEL_RE.test(String(cfg.model || ''))) cfg.model = DEFAULT_MODEL;

  const envKey = () => String(env.GEMINI_API_KEY || '').trim();
  const canEncrypt = () => !!safeStorage?.isEncryptionAvailable?.();

  const savedKey = () => {
    if (!keyFile || !fs.existsSync(keyFile) || !canEncrypt()) return '';
    try {
      return safeStorage.decryptString(fs.readFileSync(keyFile)).trim();
    } catch {
      return '';
    }
  };

  const apiKey = () => envKey() || savedKey();

  const writeCfg = () => {
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify({ model: cfg.model }, null, 2));
  };

  function status() {
    const source = envKey() ? 'env' : savedKey() ? 'saved' : null;
    return { configured: !!source, source, model: cfg.model, defaultModel: DEFAULT_MODEL, canSaveKey: canEncrypt() };
  }

  function configure(args = {}) {
    if (args.model !== undefined) {
      const model = String(args.model || '').trim() || DEFAULT_MODEL;
      if (!MODEL_RE.test(model)) return { ok: false, error: 'The model name is not valid.' };
      cfg.model = model;
      writeCfg();
    }
    if (args.clearKey) {
      try {
        if (keyFile && fs.existsSync(keyFile)) fs.unlinkSync(keyFile);
      } catch (error) {
        return { ok: false, error: 'Could not remove the saved key: ' + error.message };
      }
    } else if (args.apiKey !== undefined) {
      const key = String(args.apiKey || '').trim();
      if (!/^[\w\-]{20,200}$/.test(key)) return { ok: false, error: 'That does not look like a Gemini API key.' };
      if (!canEncrypt()) return { ok: false, error: 'Secure key storage is unavailable on this PC. Set the GEMINI_API_KEY environment variable instead.' };
      try {
        fs.mkdirSync(path.dirname(keyFile), { recursive: true });
        const temp = keyFile + '.tmp';
        fs.writeFileSync(temp, safeStorage.encryptString(key));
        fs.renameSync(temp, keyFile);
      } catch (error) {
        return { ok: false, error: 'Could not save the key: ' + error.message };
      }
    }
    return { ok: true, status: status() };
  }

  /** Converts the renderer's request into Gemini parts after checking types and sizes. */
  function toParts(parts) {
    if (!Array.isArray(parts) || !parts.length || parts.length > MAX_PARTS) throw new Error('The AI request has no content or too many parts.');
    let total = 0;
    const out = parts.map((p) => {
      if (p && typeof p.text === 'string') {
        if (p.text.length > MAX_TEXT_CHARS) throw new Error('The AI request text is too long.');
        total += p.text.length;
        return { text: p.text };
      }
      if (p && p.image && typeof p.image.data === 'string' && IMAGE_TYPES.has(p.image.mimeType)) {
        const bytes = Math.floor((p.image.data.length * 3) / 4);
        if (bytes > MAX_IMAGE_BYTES) throw new Error('A page image is too large to send.');
        total += bytes;
        return { inlineData: { mimeType: p.image.mimeType, data: p.image.data } };
      }
      throw new Error('The AI request contains an unsupported part.');
    });
    if (total > MAX_TOTAL_BYTES) throw new Error('The AI request is larger than the 20 MB limit. Send fewer pages.');
    return out;
  }

  async function generate(args = {}) {
    const key = apiKey();
    if (!key) return { ok: false, notConfigured: true, error: 'Add a Gemini API key in AI Assistant > Settings first.' };
    let parts;
    try {
      parts = toParts(args.parts);
    } catch (error) {
      return { ok: false, error: error.message };
    }
    const body = {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: typeof args.temperature === 'number' ? Math.max(0, Math.min(1, args.temperature)) : 0.2,
        ...(args.json ? { responseMimeType: 'application/json' } : {}),
      },
    };
    if (typeof args.system === 'string' && args.system.trim()) body.systemInstruction = { parts: [{ text: args.system.slice(0, 20000) }] };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const r = await f(API_BASE + encodeURIComponent(cfg.model) + ':generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      let data = null;
      try {
        data = await r.json();
      } catch {
        /* non-JSON error page */
      }
      if (!r.ok) {
        const message = data?.error?.message || `HTTP ${r.status}`;
        if (r.status === 400 && /api key/i.test(message)) return { ok: false, error: 'Gemini rejected the API key. Check it in AI Assistant > Settings.' };
        if (r.status === 404) return { ok: false, error: `Model "${cfg.model}" was not found. Choose another model in AI Assistant > Settings.` };
        if (r.status === 429) return { ok: false, error: 'Gemini rate limit or quota reached. Wait a moment and try again.' };
        return { ok: false, error: 'Gemini error: ' + message };
      }
      const candidate = data?.candidates?.[0];
      const text = (candidate?.content?.parts || []).map((p) => (typeof p.text === 'string' ? p.text : '')).join('');
      if (!text) {
        const reason = data?.promptFeedback?.blockReason || candidate?.finishReason || 'no text returned';
        return { ok: false, error: 'Gemini returned no answer (' + reason + ').' };
      }
      return { ok: true, text, model: cfg.model, usage: data?.usageMetadata || null };
    } catch (error) {
      if (error && error.name === 'AbortError') return { ok: false, error: 'Gemini did not answer within 2 minutes.' };
      return { ok: false, error: 'Could not reach Gemini: ' + (error?.message || String(error)) };
    } finally {
      clearTimeout(timer);
    }
  }

  return { status, configure, generate };
}

module.exports = { createAi, DEFAULT_MODEL };
