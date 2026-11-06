import { useEffect, useState, type ReactNode } from 'react';

export default function LicenseGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<{ ok: boolean; device?: string; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!window.api) {
      setStatus({ ok: false, error: 'Licensing requires the Windows desktop application.' });
      return;
    }
    window.api.licenseStatus().then(setStatus).catch(() => setStatus({ ok: false, error: 'Could not check the device license.' }));
  }, []);
  const activate = async () => {
    if (!window.api) return;
    setBusy(true);
    try {
      const result = await window.api.importLicense();
      if (result.ok) setStatus(await window.api.licenseStatus());
      else if (!result.cancelled) setStatus((s) => ({ ok: false, device: s?.device, error: result.error || 'Activation failed.' }));
    } catch {
      setStatus((s) => ({ ok: false, device: s?.device, error: 'Could not import the license file.' }));
    } finally { setBusy(false); }
  };
  if (!status) return <div className="auth">Checking device license...</div>;
  if (status.ok) return <>{children}</>;
  return <div className="auth"><div className="auth-card">
    <h1>ThryvoPDF Markup Studio</h1>
    <h2>Activate this device</h2>
    <p>Send this device request to the software owner to obtain a perpetual license file.</p>
    <label>Device request
      <textarea readOnly rows={3} value={status.device || 'Unavailable'} aria-label="Device request" />
    </label>
    {status.error && <div className="danger" role="alert">{status.error}</div>}
    <button className="primary" disabled={busy || !status.device} onClick={() => void activate()}>Import license file...</button>
  </div></div>;
}
