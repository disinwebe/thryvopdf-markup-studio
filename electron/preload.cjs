const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  startupFiles: () => ipcRenderer.invoke('startup-files'),
  setMenuState: (state) => ipcRenderer.send('menu-state', state),
  setNativeTheme: (theme) => ipcRenderer.send('theme', theme),
  serverControlStatus: () => ipcRenderer.invoke('server-control-status'),
  serverControlRun: (action, config) => ipcRenderer.invoke('server-control-run', action, config),
  serverControlFolder: () => ipcRenderer.invoke('server-control-folder'),
  serverControlCopy: (address) => ipcRenderer.invoke('server-control-copy', address),
  serverControlFirewallHelp: () => ipcRenderer.invoke('server-control-firewall-help'),
  onMenuAction: (fn) => {
    const handler = (_event, action) => fn(action);
    ipcRenderer.on('menu-action', handler);
    return () => ipcRenderer.removeListener('menu-action', handler);
  },
  quitApp: () => ipcRenderer.invoke('quit-app'),
  appVersion: () => ipcRenderer.invoke('app-version'),
  showAbout: () => ipcRenderer.invoke('show-about'),
  openFiles: (opts) => ipcRenderer.invoke('open-files', opts),
  renameFile: (args) => ipcRenderer.invoke('rename-file', args),
  pickStamp: () => ipcRenderer.invoke('pick-stamp'),
  saveFile: (args) => ipcRenderer.invoke('save-file', args),
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
  adminList: () => ipcRenderer.invoke('auth-admin-list'),
  adminAction: (args) => ipcRenderer.invoke('auth-admin-action', args),
  testServer: (url) => ipcRenderer.invoke('auth-test', url),
  configureAuth: (args) => ipcRenderer.invoke('auth-configure', args),
});
