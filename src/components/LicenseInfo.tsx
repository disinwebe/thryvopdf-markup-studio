export interface LicenseInfoStatus {
  ok: boolean;
  device?: string;
  id?: string;
  error?: string;
}

export function LicenseInfo({ status, onClose, onImport }: { status: LicenseInfoStatus; onClose(): void; onImport?: () => void }) {
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="License information">
      <div className="usermgmt tool-dialog">
        <div className="row between"><h3>License information</h3><button onClick={onClose}>Close</button></div>
        <p>Status: <b>{status.ok ? 'Activated' : 'Not activated'}</b></p>
        {status.ok && <><p>License type: Perpetual, one device</p><p>Verification key: Configured (Ed25519)</p><p>License ID: {status.id}</p></>}
        <label>Device request<textarea readOnly rows={3} value={status.device || 'Unavailable'} /></label>
        {status.error && <p className="danger" role="alert">{status.error}</p>}
        {onImport && <button className="primary" onClick={onImport}>Import license file...</button>}
      </div>
    </div>
  );
}
