const fs = require('fs');
const path = require('path');
const os = require('os');
const { start } = require('../server/server.cjs');

function createServerControl({ configFile, defaultDir, startServer = start, interfaces = os.networkInterfaces }) {
  let config = { port: 8787, dataDir: defaultDir };
  let server = null;
  let error = '';
  let initialPasswordFile = null;
  let busy = false;
  try {
    if (fs.existsSync(configFile)) {
      const saved = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      validate(saved);
      config = saved;
    }
  } catch (e) {
    error = 'Could not load server configuration: ' + e.message;
  }
  function validate(value) {
    if (!value || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535) throw new Error('Enter a port between 1 and 65535.');
    if (typeof value.dataDir !== 'string' || !path.isAbsolute(value.dataDir)) throw new Error('Choose an absolute server data folder.');
  }
  function status() {
    const addresses = [];
    for (const list of Object.values(interfaces())) for (const item of list || []) {
      if (item.family === 'IPv4' && !item.internal) addresses.push(`http://${item.address}:${config.port}`);
    }
    return { config, running: !!server, addresses: [...new Set(addresses)], error, initialPasswordFile };
  }
  async function stop() {
    if (!server) return;
    const active = server;
    server = null;
    active.closeAllConnections?.();
    await new Promise((resolve, reject) => active.close((e) => e ? reject(e) : resolve()));
  }
  async function perform(action, value) {
    if (busy) throw new Error('A server operation is already in progress.');
    busy = true;
    try {
      error = '';
      if (action === 'stop') {
        await stop();
      } else if (action === 'start' || action === 'restart') {
        validate(value);
        if (server && action === 'start') throw new Error('Server is already running. Use Restart to apply changes.');
        const usersFile = path.join(value.dataDir, 'users.json');
        if (fs.existsSync(usersFile)) {
          const users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
          if (!Array.isArray(users.users)) throw new Error('The existing users.json file is invalid. Restore it from backup.');
        }
        fs.mkdirSync(path.dirname(configFile), { recursive: true });
        fs.mkdirSync(value.dataDir, { recursive: true });
        const temp = configFile + '.tmp';
        fs.writeFileSync(temp, JSON.stringify(value, null, 2));
        fs.renameSync(temp, configFile);
        if (server) await stop();
        config = { port: value.port, dataDir: value.dataDir };
        const result = await startServer({ port: config.port, host: '0.0.0.0', file: usersFile });
        server = result.server;
        const passwordFile = path.join(config.dataDir, 'ADMIN-INITIAL-PASSWORD.txt');
        initialPasswordFile = fs.existsSync(passwordFile) ? passwordFile : null;
        server.on('error', (e) => { error = 'Server error: ' + e.message; });
        server.once('close', () => { if (server === result.server) server = null; });
      } else throw new Error('Unknown server operation.');
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
    return status();
  }
  return { status, perform, stop };
}

module.exports = { createServerControl };
