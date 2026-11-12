const { contextBridge, ipcRenderer } = require('electron');
const localUserName = process.env.USERNAME || process.env.USER || 'Local user';

contextBridge.exposeInMainWorld('api', {
  localUserName,
  startupFiles: () => ipcRenderer.invoke('startup-files'),
  consumeOpenFiles: () => ipcRenderer.invoke('consume-open-files'),
  onOpenFiles: (fn) => {
    const handler = () => {
      ipcRenderer.invoke('consume-open-files')
        .then((files) => { if (files.length) fn(files); })
        .catch((error) => fn([], error instanceof Error ? error.message : String(error)));
    };
    ipcRenderer.on('open-files-pending', handler);
    return () => ipcRenderer.removeListener('open-files-pending', handler);
  },
  setMenuState: (state) => ipcRenderer.send('menu-state', state),
  spellCheckerLanguage: () => ipcRenderer.invoke('spellchecker-language'),
  setSpellCheckerLanguage: (language) => ipcRenderer.invoke('spellchecker-set-language', language),
  checkSpellWords: (words) => ipcRenderer.invoke('spellchecker-check-words', words),
  addSpellCheckerWord: (word) => ipcRenderer.invoke('spellchecker-add-word', word),
  setNativeTheme: (theme) => ipcRenderer.send('theme', theme),
  onMenuAction: (fn) => {
    const handler = (_event, action) => fn(action);
    ipcRenderer.on('menu-action', handler);
    return () => ipcRenderer.removeListener('menu-action', handler);
  },
  quitApp: () => ipcRenderer.invoke('quit-app'),
  onAppCloseRequested: (fn) => {
    const handler = () => fn();
    ipcRenderer.on('app-close-requested', handler);
    return () => ipcRenderer.removeListener('app-close-requested', handler);
  },
  markCloseGuardReady: () => ipcRenderer.send('close-guard-ready'),
  respondToAppClose: (allow) => ipcRenderer.send('close-guard-response', allow),
  appVersion: () => ipcRenderer.invoke('app-version'),
  showAbout: () => ipcRenderer.invoke('show-about'),
  openFiles: (opts) => ipcRenderer.invoke('open-files', opts),
  renameFile: (args) => ipcRenderer.invoke('rename-file', args),
  pickStamp: () => ipcRenderer.invoke('pick-stamp'),
  saveFile: (args) => ipcRenderer.invoke('save-file', args),
  openSavedPdf: (path) => ipcRenderer.invoke('open-saved-pdf', path),
  saveMany: (args) => ipcRenderer.invoke('save-many', args),
  authStatus: () => ipcRenderer.invoke('auth-status'),
  licenseStatus: () => ipcRenderer.invoke('license-status'),
  importLicense: () => ipcRenderer.invoke('license-import'),
  register: (args) => ipcRenderer.invoke('auth-register', args),
  login: (args) => ipcRenderer.invoke('auth-login', args),
  logout: () => ipcRenderer.invoke('auth-logout'),
  pickUploads: (kind) => ipcRenderer.invoke('pick-uploads', kind),
  sharedDocs: (args) => ipcRenderer.invoke('shared-docs', args),
  changePassword: (args) => ipcRenderer.invoke('auth-change-password', args),
  notifications: (args) => ipcRenderer.invoke('auth-notifications', args),
  onNotifications: (callback) => {
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on('notifications-update', listener);
    return () => ipcRenderer.removeListener('notifications-update', listener);
  },
  adminList: () => ipcRenderer.invoke('auth-admin-list'),
  adminAction: (args) => ipcRenderer.invoke('auth-admin-action', args),
  testServer: (url) => ipcRenderer.invoke('auth-test', url),
  configureAuth: (args) => ipcRenderer.invoke('auth-configure', args),
});
