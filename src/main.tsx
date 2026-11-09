import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import AuthGate from './components/AuthGate';
import LicenseGate from './components/LicenseGate';
import { applyTheme, loadTheme } from './app/theme';
import './styles.css';

applyTheme(loadTheme());

const guest: AuthUser = { name: 'Guest viewer', email: '', discipline: '', role: 'user' };
const guestActions = { logout: () => {}, changePassword: () => {} };

createRoot(document.getElementById('root')!).render(
  <LicenseGate>
    {({ licensed, status, importLicense }) =>
      licensed ? (
        <AuthGate>{(user, actions) => <App user={user} actions={actions} />}</AuthGate>
      ) : (
        <App user={guest} actions={guestActions} viewOnly licenseStatus={status} onImportLicense={importLicense} />
      )
    }
  </LicenseGate>,
);
