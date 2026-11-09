const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('manager', {
  status: () => ipcRenderer.invoke('manager:status'),
  choose: () => ipcRenderer.invoke('manager:choose'),
  action: (action, config) => ipcRenderer.invoke('manager:action', action, config),
  firewall: () => ipcRenderer.invoke('manager:firewall'),
  logs: () => ipcRenderer.invoke('manager:logs'),
  copy: (address) => ipcRenderer.invoke('manager:copy', address),
});
