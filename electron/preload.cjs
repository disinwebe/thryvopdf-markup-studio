const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  startupFiles: () => ipcRenderer.invoke('startup-files'),
  openFiles: (opts) => ipcRenderer.invoke('open-files', opts),
  saveFile: (args) => ipcRenderer.invoke('save-file', args),
  saveMany: (args) => ipcRenderer.invoke('save-many', args),
  authStatus: () => ipcRenderer.invoke('auth-status'),
  register: (args) => ipcRenderer.invoke('auth-register', args),
  login: (args) => ipcRenderer.invoke('auth-login', args),
  logout: () => ipcRenderer.invoke('auth-logout'),
  sharedDocs: (args) => ipcRenderer.invoke('shared-docs', args),
  changePassword: (args) => ipcRenderer.invoke('auth-change-password', args),
  adminList: () => ipcRenderer.invoke('auth-admin-list'),
  adminAction: (args) => ipcRenderer.invoke('auth-admin-action', args),
  testServer: (url) => ipcRenderer.invoke('auth-test', url),
  configureAuth: (args) => ipcRenderer.invoke('auth-configure', args),
});
