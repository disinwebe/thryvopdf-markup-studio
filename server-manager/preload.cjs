const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('manager', {
  status: () => ipcRenderer.invoke('manager:status'),
  choose: () => ipcRenderer.invoke('manager:choose'),
  action: (action, config) => ipcRenderer.invoke('manager:action', action, config),
  firewall: () => ipcRenderer.invoke('manager:firewall'),
  logs: () => ipcRenderer.invoke('manager:logs'),
  notifyGet: () => ipcRenderer.invoke('manager:notify-get'),
  notifySave: (settings) => ipcRenderer.invoke('manager:notify-save', settings),
  notifyTest: (to) => ipcRenderer.invoke('manager:notify-test', to),
  copy: (address) => ipcRenderer.invoke('manager:copy', address),
});
