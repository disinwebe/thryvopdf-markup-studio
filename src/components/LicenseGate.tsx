import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { LicenseInfoStatus } from './LicenseInfo';

export interface LicenseGateState {
  licensed: boolean;
  status: LicenseInfoStatus;
  importLicense(): Promise<void>;
}

export default function LicenseGate({ children }: { children: (state: LicenseGateState) => ReactNode }) {
  const [status, setStatus] = useState<LicenseInfoStatus | null>(null);

  useEffect(() => {
    if (!window.api) {
      setStatus({ ok: false, error: 'Licensing requires the Windows desktop application.' });
      return;
    }
    window.api.licenseStatus().then(setStatus).catch(() => setStatus({ ok: false, error: 'Could not check the device license.' }));
  }, []);

  const importLicense = useCallback(async () => {
    if (!window.api) {
      setStatus((current) => ({ ok: false, device: current?.device, error: 'Licensing requires the Windows desktop application.' }));
      return;
    }
    try {
      const result = await window.api.importLicense();
      if (result.ok) setStatus(await window.api.licenseStatus());
      else if (!result.cancelled) setStatus((current) => ({ ok: false, device: current?.device, error: result.error || 'Activation failed.' }));
    } catch {
      setStatus((current) => ({ ok: false, device: current?.device, error: 'Could not import or verify the license file.' }));
    }
  }, []);

  if (!status) return <div className="auth">Checking device license...</div>;
  return <>{children({ licensed: status.ok, status, importLicense })}</>;
}
