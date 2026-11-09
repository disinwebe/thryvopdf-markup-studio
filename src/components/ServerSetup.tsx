import { useEffect, useState } from 'react';

export function ServerSetup({ onClose, onUseLocal }: { onClose(): void; onUseLocal?(url: string): void }) {
  const [status, setStatus] = useState<ServerControlStatus | null>(null);
  const [port, setPort] = useState('8787');
  const [dataDir, setDataDir] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    window.api!.serverControlStatus().then((s) => {
      if (!active) return;
      setStatus(s);
      setPort(String(s.config.port));
      setDataDir(s.config.dataDir);
    }).catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : 'Could not load server settings.'); });
    return () => { active = false; };
  }, []);

  const run = async (action: 'start' | 'stop' | 'restart') => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const s = await window.api!.serverControlRun(action, { port: Number(port), dataDir });
      setStatus(s);
      if (s.error) setError(s.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Server operation failed.');
    } finally { setBusy(false); }
  };
  const pick = async () => {
    try {
      const folder = await window.api!.serverControlFolder();
      if (folder) setDataDir(folder);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not choose a folder.'); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Server setup">
      <div className="usermgmt server-setup">
        <div className="row"><h2>Server setup and control</h2><span className="grow" /><button onClick={onClose}>Close</button></div>
        <p>Run a shared-document server on this PC. It stops when this application closes; keep this PC awake and the application open.</p>
        <p role="status"><b>Status: {status?.running ? 'Running' : status ? 'Stopped' : 'Loading...'}</b></p>
        <label>Listen port <input type="number" min={1} max={65535} value={port} onChange={(e) => setPort(e.target.value)} /></label>
        <label>Server data folder <input value={dataDir} readOnly /></label>
        <button type="button" disabled={busy || !status} onClick={() => void pick()}>Choose folder...</button>
        <p className="muted small">Changing the data folder selects a different set of accounts and documents; it does not move existing data. Back up this folder regularly.</p>
        <div className="row">
          <button className="primary" disabled={busy || !status || status.running} onClick={() => void run('start')}>Start</button>
          <button disabled={busy || !status?.running} onClick={() => void run('stop')}>Stop</button>
          <button disabled={busy || !status?.running} onClick={() => void run('restart')}>Restart and apply settings</button>
        </div>
        {status?.running && <>
          <p>Connection addresses for other PCs on your network:</p>
          {status.addresses.length ? status.addresses.map((address) => (
            <div className="row" key={address}><code>{address}</code><button onClick={() => void window.api!.serverControlCopy(address).then(() => setMessage('Address copied.')).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not copy address.'))}>Copy</button></div>
          )) : <p className="danger">No LAN IPv4 address was found. Check this PC's network connection.</p>}
          {onUseLocal && <button onClick={() => onUseLocal(`http://127.0.0.1:${status.config.port}`)}>Connect this PC to its server</button>}
        </>}
        {status?.initialPasswordFile && <p>Initial administrator account: <b>admin</b>. The initial password is stored in <code>{status.initialPasswordFile}</code>. Open it privately, change the password on first login, and delete the file.</p>}
        <p>Clients must reach this PC on the selected TCP port. Windows Firewall or network policy may block connections; an administrator may need to allow the port on a trusted private network. No firewall rules are changed automatically.</p>
        <p><b>Security:</b> This setup uses unencrypted HTTP. Use it only on a trusted network; for sensitive data, configure TLS using the standalone server instructions.</p>
        <button onClick={() => void window.api!.serverControlFirewallHelp().catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not open firewall help.'))}>Windows Firewall help</button>
        {(error || status?.error) && <p className="danger" role="alert">{error || status?.error}</p>}
        {message && <p role="status">{message}</p>}
      </div>
    </div>
  );
}
