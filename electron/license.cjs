const crypto = require('crypto');
const fs = require('fs');
const { execFileSync } = require('child_process');

const DEVICE_RE = /^[a-f0-9]{64}$/;
const MAX_LICENSE_BYTES = 16384;

function machineFingerprint() {
  if (process.platform !== 'win32') throw new Error('Device licensing is supported on Windows only.');
  const result = execFileSync('reg.exe', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64'], { encoding: 'utf8', windowsHide: true });
  const match = /^\s*MachineGuid\s+REG_SZ\s+([0-9a-f-]+)\s*$/im.exec(result);
  if (!match) throw new Error('Could not read the Windows device identifier.');
  return crypto.createHash('sha256').update('ThryvoPDF-device-v1:' + match[1].toLowerCase()).digest('hex');
}

function publicKey(pem) {
  const key = crypto.createPublicKey(pem);
  if (key.asymmetricKeyType !== 'ed25519' || /PRIVATE KEY/.test(String(pem))) throw new Error('The verification key must be an Ed25519 public key.');
  return key;
}

function verifyLicense(raw, pem, device) {
  try {
    if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > MAX_LICENSE_BYTES) return { ok: false, error: 'License file is too large or invalid.' };
    const key = publicKey(pem);
    const envelope = JSON.parse(raw);
    if (!envelope || typeof envelope.payload !== 'string' || typeof envelope.signature !== 'string' ||
        !/^[A-Za-z0-9_-]+$/.test(envelope.payload) || !/^[A-Za-z0-9_-]+$/.test(envelope.signature)) return { ok: false, error: 'Invalid license format.' };
    const payloadBytes = Buffer.from(envelope.payload, 'base64url');
    const sig = Buffer.from(envelope.signature, 'base64url');
    if (sig.length !== 64 || !crypto.verify(null, payloadBytes, key, sig)) return { ok: false, error: 'License signature is invalid.' };
    const payload = JSON.parse(payloadBytes.toString('utf8'));
    if (payload.version !== 1 || payload.product !== 'ThryvoPDF Markup Studio' || payload.kind !== 'perpetual' ||
        !DEVICE_RE.test(payload.device) || typeof payload.id !== 'string' || !/^[a-f0-9]{32}$/.test(payload.id) ||
        typeof payload.issuedAt !== 'string' || !Number.isFinite(Date.parse(payload.issuedAt)) ||
        'expiresAt' in payload) return { ok: false, error: 'Invalid perpetual license details.' };
    if (!DEVICE_RE.test(device) || payload.device !== device) return { ok: false, error: 'This license belongs to a different device.' };
    return { ok: true, id: payload.id };
  } catch {
    return { ok: false, error: 'License or verification key is invalid.' };
  }
}

function createLicenseStore({ file, publicKeyFile, getDevice = machineFingerprint }) {
  const device = () => {
    try { return { device: getDevice() }; } catch { return { error: 'Could not identify this Windows device. Verify access to its MachineGuid and try again.' }; }
  };
  const check = (raw) => {
    const d = device();
    if (!d.device) return { ok: false, error: d.error };
    let key;
    try { key = fs.readFileSync(publicKeyFile, 'utf8'); }
    catch { return { ok: false, error: 'This build has no license verification key. Contact the software owner for a configured installer.' }; }
    return verifyLicense(raw, key, d.device);
  };
  return {
    status() {
      const d = device();
      if (!d.device) return { ok: false, error: d.error };
      try { return { ...check(fs.readFileSync(file, 'utf8')), device: d.device }; }
      catch {
        if (!fs.existsSync(publicKeyFile)) return { ok: false, device: d.device, error: 'This build has no license verification key. Contact the software owner for a configured installer.' };
        return { ok: false, device: d.device, error: 'Activate this device with a license file.' };
      }
    },
    activate(raw) {
      const result = check(raw);
      if (!result.ok) return result;
      try {
        fs.writeFileSync(file + '.tmp', raw, { mode: 0o600 });
        fs.renameSync(file + '.tmp', file);
        return result;
      } catch {
        return { ok: false, error: 'Could not save the license in the application data folder.' };
      }
    },
  };
}

module.exports = { createLicenseStore, verifyLicense, publicKey, machineFingerprint, DEVICE_RE, MAX_LICENSE_BYTES };
