module.exports = {
  appId: 'com.thryvopdf.servermanager',
  productName: 'ThryvoPDF Server Manager',
  publish: null,
  extraMetadata: { main: 'server-manager/main.cjs' },
  directories: { output: 'release-server-manager' },
  files: ['server-manager/*.cjs', 'server-manager/*.html', 'server-manager/*.css', 'server-manager/*.js', 'server/*.cjs', 'assets/icon.*', 'package.json'],
  extraResources: [{ from: 'server-manager/build/ThryvoServerHost.exe', to: 'ThryvoServerHost.exe' }],
  win: { target: ['nsis'], icon: 'assets/icon.ico' },
  nsis: { oneClick: false, perMachine: true, allowToChangeInstallationDirectory: true, installerIcon: 'assets/icon.ico', uninstallerIcon: 'assets/icon.ico', include: 'server-manager/installer.nsh' },
};
