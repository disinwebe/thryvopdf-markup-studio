const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  startupFiles: () => ipcRenderer.invoke('startup-files'),
  openFiles: (opts) => ipcRenderer.invoke('open-files', opts),
  saveFile: (args) => ipcRenderer.invoke('save-file', args),
  saveMany: (args) => ipcRenderer.invoke('save-many', args),
});
