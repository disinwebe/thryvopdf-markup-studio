const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  startupFiles: () => ipcRenderer.invoke('startup-files'),
  setMenuState: (state) => ipcRenderer.send('menu-state', state),
  onMenuAction: (fn) => {
    const handler = (_event, action) => fn(action);
    ipcRenderer.on('menu-action', handler);
    return () => ipcRenderer.removeListener('menu-action', handler);
  },
  quitApp: () => ipcRenderer.invoke('quit-app'),
  appVersion: () => ipcRenderer.invoke('app-version'),
  openFiles: (opts) => ipcRenderer.invoke('open-files', opts),
  saveFile: (args) => ipcRenderer.invoke('save-file', args),
  saveMany: (args) => ipcRenderer.invoke('save-many', args),
  authStatus: () => ipcRenderer.invoke('auth-status'),
  register: (args) => ipcRenderer.invoke('auth-register', args),
  login: (args) => ipcRenderer.invoke('auth-login', args),
  logout: () => ipcRenderer.invoke('auth-logout'),
  pickUploads: (kind) => ipcRenderer.invoke('pick-uploads', kind),
  sharedDocs: (args) => ipcRenderer.invoke('shared-docs', args),
  changePassword: (args) => ipcRenderer.invoke('auth-change-password', args),
  adminList: () => ipcRenderer.invoke('auth-admin-list'),
  adminAction: (args) => ipcRenderer.invoke('auth-admin-action', args),
  testServer: (url) => ipcRenderer.invoke('auth-test', url),
  configureAuth: (args) => ipcRenderer.invoke('auth-configure', args),
});
