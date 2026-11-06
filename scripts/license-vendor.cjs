// Run on a trusted vendor machine; never put the private key in the repository.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DEVICE_RE } = require('../electron/license.cjs');

function writeNew(file, content, mode) {
  fs.writeFileSync(file, content, { flag: 'wx', mode });
}
function main(args) {
  const [command, ...argv] = args;
  if (command === 'keygen' && argv.length === 2) {
    const [privateFile, publicFile] = argv.map((p) => path.resolve(p));
    const repo = path.resolve(__dirname, '..');
    if (privateFile === repo || privateFile.startsWith(repo + path.sep)) throw new Error('Keep the private key outside the repository.');
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    writeNew(privateFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), 0o600);
    try { writeNew(publicFile, publicKey.export({ type: 'spki', format: 'pem' }), 0o644); }
    catch (e) { fs.unlinkSync(privateFile); throw e; }
    console.log('Created keypair. Securely back up the private key; configure the public key for the build.');
  } else if (command === 'issue' && argv.length === 2) {
    const [device, outFile] = argv;
    if (!DEVICE_RE.test(device)) throw new Error('Device request must be the 64-character fingerprint shown by the app.');
    if (!process.env.PMS_LICENSE_PRIVATE_KEY) throw new Error('Set PMS_LICENSE_PRIVATE_KEY to the external private key path.');
    const key = crypto.createPrivateKey(fs.readFileSync(process.env.PMS_LICENSE_PRIVATE_KEY));
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('Private key must be Ed25519.');
    const payload = Buffer.from(JSON.stringify({ version: 1, product: 'ThryvoPDF Markup Studio', kind: 'perpetual', device, id: crypto.randomBytes(16).toString('hex'), issuedAt: new Date().toISOString() }));
    const license = JSON.stringify({ payload: payload.toString('base64url'), signature: crypto.sign(null, payload, key).toString('base64url') }, null, 2);
    writeNew(outFile, license, 0o600);
    console.log('License written to ' + outFile);
  } else {
    throw new Error('Usage: node scripts/license-vendor.cjs keygen <private.pem> <public.pem> | issue <device-fingerprint> <license.json>');
  }
}
try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; }
