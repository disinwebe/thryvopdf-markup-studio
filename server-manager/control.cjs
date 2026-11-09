const path = require('node:path');
const os = require('node:os');

const SERVICE = 'ThryvoPDFServer';
function validate(config) {
  if (!Number.isInteger(config?.port) || config.port < 1 || config.port > 65535) throw new Error('Port must be between 1 and 65535.');
  if (typeof config.dataDir !== 'string' || !path.win32.isAbsolute(config.dataDir) || config.dataDir.startsWith('\\\\')) throw new Error('Choose an absolute local data folder, not a network share.');
}
function encode(value) { return Buffer.from(value, 'utf8').toString('base64'); }
function decode(value) { return Buffer.from(value, 'base64').toString('utf8'); }
function serviceArgs(action, config, appPath) {
  if (!['install', 'uninstall', 'start', 'stop', 'restart'].includes(action)) throw new Error('Unsupported service action.');
  validate(config);
  if (!path.win32.isAbsolute(appPath)) throw new Error('Invalid manager executable path.');
  return ['manage', action, encode(config.dataDir), String(config.port), encode(appPath)];
}
function parseImage(image, host) {
  const m = /^"([^"]+)" service (\d{1,5}) ([A-Za-z0-9+/=]+) ([A-Za-z0-9+/=]+)$/i.exec(image.trim());
  if (!m || path.win32.normalize(m[1]).toLowerCase() !== path.win32.normalize(host).toLowerCase()) return null;
  const config = { port: Number(m[2]), dataDir: decode(m[3]) };
  validate(config);
  return { config, appPath: decode(m[4]) };
}
function addresses(port, interfaces = os.networkInterfaces()) {
  const out = [];
  for (const list of Object.values(interfaces)) for (const item of list || []) {
    if (item.family === 'IPv4' && !item.internal) out.push(`http://${item.address}:${port}`);
  }
  return [...new Set(out)];
}
module.exports = { SERVICE, validate, serviceArgs, parseImage, addresses };
