// Copy only an explicitly supplied public key into the renderer distribution.
const fs = require('fs');
const path = require('path');
const { publicKey } = require('../electron/license.cjs');
const dest = path.join(__dirname, '..', 'dist', 'license-public.pem');
if (!process.env.PMS_LICENSE_PUBLIC_KEY) {
  if (fs.existsSync(dest)) fs.unlinkSync(dest);
  console.warn('No PMS_LICENSE_PUBLIC_KEY: this build cannot activate licenses.');
} else {
  const pem = fs.readFileSync(process.env.PMS_LICENSE_PUBLIC_KEY, 'utf8');
  publicKey(pem);
  fs.writeFileSync(dest, pem);
}
