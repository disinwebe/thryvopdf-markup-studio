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
const PROVIDERS = {
  custom: { hint: 'Enter the host, port and credentials supplied by your mail administrator.' },
  m365: { host: 'smtp.office365.com', port: 587, secure: false, hint: 'Use the mailbox sign-in as SMTP user and From address. An administrator must enable Authenticated SMTP (SMTP AUTH) for that mailbox in Microsoft 365, and Security Defaults/MFA may require an app password. OAuth sign-in is not supported.' },
  outlook: { host: 'smtp-mail.outlook.com', port: 587, secure: false, hint: 'Use your full Outlook.com address as SMTP user and From address. With two-step verification, create an app password in your Microsoft account security settings. Microsoft may block basic SMTP sign-in for some personal accounts.' },
  gmail: { host: 'smtp.gmail.com', port: 587, secure: false, hint: 'Use your full Gmail address as SMTP user and From address. Turn on 2-Step Verification, then create a 16-character App Password at myaccount.google.com/apppasswords and paste it as the password (your normal password will not work).' },
};
function providerOf(host) { return Object.keys(PROVIDERS).find((k) => PROVIDERS[k].host === host.trim().toLowerCase()) || 'custom'; }
function applyProvider(key, fill) {
  const p = PROVIDERS[key];
  $('smtp-hint').textContent = p.hint;
  const locked = key !== 'custom';
  if (fill && locked) { $('smtp-host').value = p.host; $('smtp-port').value = p.port; $('smtp-secure').checked = p.secure; }
  $('smtp-host').readOnly = locked; $('smtp-port').readOnly = locked; $('smtp-secure').disabled = locked;
}
$('smtp-provider').addEventListener('change', () => {
  const key = $('smtp-provider').value;
  applyProvider(key, true);
  if (key !== 'custom') $('smtp-user').placeholder = 'you@example.com';
});
$('smtp-user').addEventListener('blur', () => {
  if (!$('smtp-from').value && $('smtp-provider').value !== 'custom') $('smtp-from').value = $('smtp-user').value.trim();
});
async function loadNotify() {
  const c = await window.manager.notifyGet();
  $('smtp-enabled').checked = c.enabled;
  $('smtp-host').value = c.host;
  $('smtp-port').value = c.port;
  $('smtp-secure').checked = c.secure;
  $('smtp-provider').value = providerOf(c.host);
  applyProvider($('smtp-provider').value, false);
  $('smtp-user').value = c.user;
  $('smtp-password').value = '';
  $('smtp-password').placeholder = c.hasPassword ? 'Saved. Leave blank to keep it' : '';
  $('smtp-from').value = c.from;
}
$('smtp-save').addEventListener('click', () => handle(async () => {
  $('smtp-status').textContent = '';
  await window.manager.notifySave({ enabled: $('smtp-enabled').checked, host: $('smtp-host').value, port: Number($('smtp-port').value), secure: $('smtp-secure').checked, user: $('smtp-user').value, password: $('smtp-password').value, from: $('smtp-from').value });
  await loadNotify();
  $('smtp-status').textContent = 'Email settings saved.';
}));
$('smtp-test').addEventListener('click', () => handle(async () => {
  $('smtp-status').textContent = 'Sending test email...';
  try { await window.manager.notifyTest($('smtp-test-to').value); $('smtp-status').textContent = 'Test email sent.'; }
  catch (e) { $('smtp-status').textContent = ''; throw e; }
}));
handle(async () => { await refresh(); await loadNotify(); });
