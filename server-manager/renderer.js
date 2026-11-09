const $ = (id) => document.getElementById(id);
let state;
let busy = false;
let initialized = false;
async function refresh(updateFields = false) {
  state = await window.manager.status();
  $('service-status').textContent = `Windows service: ${state.state}. ${state.state === 'running' ? 'The service continues when this manager closes.' : ''}`;
  $('health-status').textContent = state.health
    ? 'Local health endpoint responds. This alone does not prove which process owns the port.'
    : 'Local health endpoint is not responding with the expected server capabilities.';
  if (!initialized || updateFields || state.state !== 'not installed') {
    $('port').value = state.config.port;
    $('data').value = state.config.dataDir;
    initialized = true;
  }
  const installed = ['stopped', 'running', 'starting', 'stopping', 'unknown'].includes(state.state);
  $('port').disabled = installed || state.state === 'foreign';
  $('choose').disabled = busy || installed || state.state === 'foreign';
  $('install').disabled = busy || state.state !== 'not installed';
  $('uninstall').disabled = busy || !installed;
  $('start').disabled = busy || state.state !== 'stopped';
  $('stop').disabled = busy || state.state !== 'running';
  $('restart').disabled = busy || !['running', 'stopped'].includes(state.state);
  $('logs').disabled = busy || !installed;
  $('addresses').replaceChildren();
  for (const address of state.addresses) {
    const row = document.createElement('p');
    const code = document.createElement('code');
    code.textContent = address;
    const button = document.createElement('button');
    button.textContent = 'Copy';
    button.addEventListener('click', () => handle(() => window.manager.copy(address)));
    row.append(code, ' ', button);
    $('addresses').append(row);
  }
  if (!state.addresses.length) $('addresses').textContent = 'No LAN IPv4 addresses found.';
  if (state.state === 'foreign') $('error').textContent = 'A different service uses this name. The manager will not modify it.';
}
async function handle(fn) {
  $('error').textContent = '';
  try { await fn(); } catch (e) { $('error').textContent = e.message || String(e); }
}
for (const action of ['install', 'uninstall', 'start', 'stop', 'restart']) {
  $(action).addEventListener('click', () => handle(async () => {
    busy = true;
    try {
      state = await window.manager.action(action, { port: Number($('port').value), dataDir: $('data').value });
      await refresh(true);
    } finally { busy = false; await refresh(); }
  }));
}
$('choose').addEventListener('click', () => handle(async () => { const dir = await window.manager.choose(); if (dir) $('data').value = dir; }));
$('refresh').addEventListener('click', () => handle(() => refresh()));
$('logs').addEventListener('click', () => handle(() => window.manager.logs()));
$('firewall').addEventListener('click', () => handle(() => window.manager.firewall()));
handle(() => refresh());
