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
  testServer: (url) => ipcRenderer.invoke('auth-test', url),
  configureAuth: (args) => ipcRenderer.invoke('auth-configure', args),
});
