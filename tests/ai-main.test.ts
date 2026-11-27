import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const req = createRequire(import.meta.url);
const { createAi, DEFAULT_MODEL } = req('../electron/ai.cjs');

const dir = mkdtempSync(join(tmpdir(), 'pms-ai-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from('enc:' + Buffer.from(s).toString('base64')),
  decryptString: (b: Buffer) => Buffer.from(b.toString().slice(4), 'base64').toString(),
};
const KEY = 'AIzaTestKey_0123456789abcdef';

const reply = (body: unknown, status = 200) => async () => ({ ok: status < 400, status, json: async () => body });

function make(fetch: any, env: Record<string, string> = {}, name = String(Math.random())) {
  return createAi({ configFile: join(dir, name + '.json'), keyFile: join(dir, name + '.bin'), safeStorage, fetch, env });
}

describe('Gemini main-process client', () => {
  it('starts unconfigured and saves the key encrypted', () => {
    const ai = make(reply({}), {}, 'save');
    expect(ai.status()).toMatchObject({ configured: false, model: DEFAULT_MODEL });
    expect(ai.configure({ apiKey: 'short' }).ok).toBe(false);
    expect(ai.configure({ apiKey: KEY })).toMatchObject({ ok: true, status: { configured: true, source: 'saved' } });
    expect(readFileSync(join(dir, 'save.bin'), 'utf8')).not.toContain(KEY);
    expect(ai.configure({ clearKey: true }).status.configured).toBe(false);
  });

  it('prefers the environment key and validates model names', () => {
    const ai = make(reply({}), { GEMINI_API_KEY: KEY }, 'env');
    expect(ai.status().source).toBe('env');
    expect(ai.configure({ model: 'bad model!' }).ok).toBe(false);
    expect(ai.configure({ model: 'gemini-4-argon' }).status.model).toBe('gemini-4-argon');
  });

  it('sends the key in a header, not the URL, and returns text', async () => {
    let seen: any;
    const fetch = async (url: string, init: any) => {
      seen = { url, init };
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }] }) };
    };
    const ai = make(fetch, { GEMINI_API_KEY: KEY });
    const r = await ai.generate({ system: 'sys', json: true, parts: [{ text: 'hi' }, { image: { mimeType: 'image/jpeg', data: 'AAAA' } }] });
    expect(r).toMatchObject({ ok: true, text: '{"a":1}' });
    expect(seen.url).toContain(DEFAULT_MODEL + ':generateContent');
    expect(seen.url).not.toContain(KEY);
    expect(seen.init.headers['x-goog-api-key']).toBe(KEY);
    const body = JSON.parse(seen.init.body);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.contents[0].parts[1]).toEqual({ inlineData: { mimeType: 'image/jpeg', data: 'AAAA' } });
    expect(body.systemInstruction.parts[0].text).toBe('sys');
  });

  it('rejects bad parts and reports API errors clearly', async () => {
    const ai = make(reply({ error: { message: 'quota' } }, 429), { GEMINI_API_KEY: KEY });
    expect((await ai.generate({ parts: [{ image: { mimeType: 'image/gif', data: 'x' } }] })).ok).toBe(false);
    expect((await ai.generate({ parts: [] })).ok).toBe(false);
    const r = await ai.generate({ parts: [{ text: 'x' }] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/rate limit|quota/i);
    const none = make(reply({}));
    expect(await none.generate({ parts: [{ text: 'x' }] })).toMatchObject({ ok: false, notConfigured: true });
  });
});
