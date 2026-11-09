// Interactive wrapper; the issuer remains responsible for signing and exclusive file creation.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { spawnSync } = require('node:child_process');

async function main() {
  const issuer = process.argv[2];
  if (!issuer || !fs.existsSync(issuer)) throw new Error('License issuer script was not found.');
  if (!process.env.PMS_LICENSE_PRIVATE_KEY || !fs.existsSync(process.env.PMS_LICENSE_PRIVATE_KEY)) throw new Error('The configured signing key was not found.');
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const lines = input[Symbol.asyncIterator]();
  async function ask(prompt) {
    process.stdout.write(prompt);
    const result = await lines.next();
    if (result.done) throw new Error('Input ended; no license was created.');
    return result.value.trim();
  }
  let device, fallback, entered;
  try {
    device = await ask('Device request (64 lowercase hexadecimal characters): ');
    if (!/^[a-f0-9]{64}$/.test(device)) throw new Error('The device request must be exactly 64 lowercase hexadecimal characters.');
    fallback = path.join(os.homedir(), `thryvo-license-${device.slice(0, 12)}.json`);
    entered = await ask(`Output license filename [${fallback}]: `);
  } finally { input.close(); }
  const out = path.resolve(entered || fallback);
  if (fs.existsSync(out)) throw new Error('That output path already exists. Choose a different filename; existing files are never overwritten.');
  const result = spawnSync(process.execPath, [issuer, 'issue', device, out], { stdio: 'inherit' });
  if (result.error) throw new Error('Could not launch the license issuer: ' + result.error.message);
  if (result.status !== 0) throw new Error('The license issuer failed; no license was issued by this command.');
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; });
