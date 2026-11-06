// Menu actions are dispatched to the authenticated renderer; file access remains in guarded IPC handlers.
function menuTemplate(state, send, platform = process.platform) {
  const { signedIn = false, documentOpen = false, canUndo = false, canRedo = false, selected = false, serverMode = false, blocked = false } = state;
  const usable = signedIn && !blocked;
  const doc = usable && documentOpen;
  const item = (label, action, enabled, accelerator) => ({
    label, enabled, ...(accelerator ? { accelerator } : {}), click: () => send(action),
  });
  const menu = [
    { label: 'File', submenu: [
      item('Open PDF...', 'open', usable, 'CmdOrCtrl+O'),
      item('Save', 'save', doc, 'CmdOrCtrl+S'),
      item('Save As...', 'saveAs', doc, 'CmdOrCtrl+Shift+S'),
      item('Export markup CSV...', 'csv', doc),
      { type: 'separator' },
      item('Shared Documents...', 'shared', usable && serverMode),
      item('Close Document', 'close', doc, 'CmdOrCtrl+W'),
      { type: 'separator' },
      item('Quit', 'quit', true, 'CmdOrCtrl+Q'),
    ] },
    { label: 'Edit', submenu: [
      item('Undo markup (Ctrl+Z)', 'undo', doc && canUndo),
      item('Redo markup (Ctrl+Shift+Z)', 'redo', doc && canRedo),
      { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
      { type: 'separator' },
      item('Select tool (V)', 'select', doc),
      item('Pan tool (H; hold Space)', 'pan', doc),
      item('Delete selected markup', 'delete', doc && selected),
      item('Toggle light / dark theme', 'theme', usable),
    ] },
    { label: 'Help', submenu: [
      item('Keyboard shortcuts', 'shortcuts', usable),
      item('About ThryvoPDF Markup Studio', 'about', usable),
      item('Server connection and deployment', 'serverHelp', usable),
    ] },
  ];
  if (platform === 'darwin') menu.unshift({ label: 'ThryvoPDF Markup Studio', submenu: [{ role: 'about' }, { role: 'hide' }, item('Quit', 'quit', true, 'CmdOrCtrl+Q')] });
  return menu;
}

module.exports = { menuTemplate };
