import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import AuthGate from './components/AuthGate';
import LicenseGate from './components/LicenseGate';
import { applyTheme, loadTheme } from './app/theme';
import './styles.css';

applyTheme(loadTheme());

createRoot(document.getElementById('root')!).render(<LicenseGate><AuthGate>{(user, actions) => <App user={user} actions={actions} />}</AuthGate></LicenseGate>);
