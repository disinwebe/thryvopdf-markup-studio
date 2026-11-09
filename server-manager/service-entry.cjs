const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { start } = require('../server/server.cjs');

async function main() {
  const dir = process.env.PMS_SERVICE_DATA;
  const port = Number(process.env.PMS_SERVICE_PORT);
  if (!dir || !path.isAbsolute(dir) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid service configuration.');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'users.json');
  if (fs.existsSync(file)) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(data.users)) throw new Error('Invalid users.json; restore it from backup.');
  }
  const { server, seeded } = await start({ port, host: '0.0.0.0', file });
  const passwordFile = path.join(dir, 'ADMIN-INITIAL-PASSWORD.txt');
  if (!seeded && fs.existsSync(passwordFile) && fs.statSync(passwordFile).size === 0) fs.unlinkSync(passwordFile);
  const input = readline.createInterface({ input: process.stdin });
  input.on('line', (line) => {
    if (line !== 'stop') return;
    input.close();
    server.closeAllConnections?.();
    server.close(() => process.exit(0));
  });
  input.on('close', () => {
    server.closeAllConnections?.();
    server.close(() => process.exit(0));
  });
}

if (require.main === module) main().catch(() => {
  console.error('Server failed to start. Check the port, data folder permissions, and users.json.');
  process.exitCode = 1;
});

module.exports = { main };
