// Menu actions are dispatched to the authenticated renderer; file access remains in guarded IPC handlers.
const actionIcons = {
  open: 'open', shared: 'open', save: 'save', saveAs: 'saveAs', csv: 'export',
  close: 'close', logout: 'key', quit: 'exit', undo: 'undo', redo: 'redo',
  select: 'select', pan: 'pan', delete: 'delete', users: 'users', password: 'license',
  theme: 'settings', toolDefaults: 'settings',
  zoomIn: 'zoomIn', zoomOut: 'zoomOut', fitWidth: 'page', fitPage: 'page',
  organizePanel: 'page', toggleLeftPanel: 'page', toggleRightPanel: 'page',
  shortcuts: 'help', about: 'help', license: 'license',
};

function menuTemplate(state, send, platform = process.platform, iconForAction = () => undefined) {
  const { signedIn = false, licensed = true, documentOpen = false, viewerActive = false, canUndo = false, canRedo = false, selected = false, canFlattenSelected = false, canFlattenAll = false, serverMode = false, admin = false, passwordAvailable = false, blocked = false, viewOnly = false } = state;
  const usable = (signedIn || viewOnly) && !blocked;
  const doc = usable && documentOpen;
  const writable = licensed && !viewOnly;
  const item = (label, action, enabled, accelerator) => ({
    label, enabled, ...(accelerator ? { accelerator } : {}), ...(actionIcons[action] ? { icon: iconForAction(actionIcons[action]) } : {}), click: () => send(action),
  });
  const menu = [
    { label: '&File', submenu: [
      item('&Open PDF...', 'open', usable, 'CmdOrCtrl+O'),
      item('&Save', 'save', doc && writable, 'CmdOrCtrl+S'),
      item('Save &As...', 'saveAs', doc && writable, 'CmdOrCtrl+Shift+S'),
      item('&Export markup CSV...', 'csv', doc && writable),
      { type: 'separator' },
      item('Open S&hared...', 'shared', usable && serverMode),
      item('&Close Document', 'close', doc, 'CmdOrCtrl+W'),
      { type: 'separator' },
      item('&Logout', 'logout', usable && !viewOnly),
      item('&Quit', 'quit', true, 'CmdOrCtrl+Q'),
    ] },
    { label: '&Edit', submenu: [
      item('&Undo markup (Ctrl+Z)', 'undo', doc && writable && canUndo),
      item('&Redo markup (Ctrl+Y / Ctrl+Shift+Z)', 'redo', doc && writable && canRedo),
      { type: 'separator' },
      { role: 'cut', label: 'Cu&t' }, { role: 'copy', label: '&Copy' }, { role: 'paste', label: '&Paste' },
      { type: 'separator' },
      item('&Select tool (V)', 'select', doc && licensed),
      item('Pa&n tool (H; hold Space)', 'pan', doc),
      item('&Delete selected markup', 'delete', doc && writable && selected),
      { label: '&Flatten', enabled: doc && writable, submenu: [
        item('Flatten &selected markup', 'flatten', doc && writable && canFlattenSelected),
        item('Flatten &All', 'flattenAll', doc && writable && canFlattenAll),
      ] },
    ] },
    { label: '&Option', submenu: [
      { ...item('&Users...', 'users', usable && admin), visible: admin },
      item('&Password...', 'password', usable && passwordAvailable),
      item('&Theme: toggle light / dark', 'theme', usable),
      item('Tool &defaults...', 'toolDefaults', doc && writable),
    ] },
    { label: '&View', submenu: [
      item('Zoom &In', 'zoomIn', doc && viewerActive, 'CmdOrCtrl+='),
      item('Zoom &Out', 'zoomOut', doc && viewerActive, 'CmdOrCtrl+-'),
      { type: 'separator' },
      item('Fit &Width', 'fitWidth', doc && viewerActive),
      item('Fit &Page', 'fitPage', doc && viewerActive),
      { type: 'separator' },
      { label: '&Measurements', enabled: doc && viewerActive && writable, submenu: [
        item('&Open measurements panel...', 'measurePanel', doc && viewerActive && writable),
        { type: 'separator' },
        item('&Length', 'measureLength', doc && viewerActive && writable),
        item('&Polylength', 'measurePolylength', doc && viewerActive && writable),
        item('&Area', 'measureArea', doc && viewerActive && writable),
        item('Peri&meter', 'measurePerimeter', doc && viewerActive && writable),
        item('An&gle', 'measureAngle', doc && viewerActive && writable),
        item('&Count', 'measureCount', doc && viewerActive && writable),
      ] },
      { type: 'separator' },
      item('Or&ganize pages...', 'organizePanel', doc && viewerActive && writable),
      item('&Search text in open PDFs...', 'searchPanel', doc && viewerActive, 'CmdOrCtrl+Shift+F'),
      item('Toggle &left panel', 'toggleLeftPanel', doc && viewerActive, 'CmdOrCtrl+Alt+L'),
      item('Toggle &right panel', 'toggleRightPanel', doc && viewerActive, 'CmdOrCtrl+Alt+R'),
    ] },
    { label: '&Help', submenu: [
      item('&Keyboard shortcuts', 'shortcuts', usable),
      item('&About this software', 'about', usable),
      item('&License...', 'license', usable),
    ] },
  ];
  if (platform === 'darwin') menu.unshift({ label: 'ThryvoPDF Markup Studio', submenu: [{ role: 'about' }, { role: 'hide' }, item('Quit', 'quit', true, 'CmdOrCtrl+Q')] });
  return menu;
}

function applyNativeTheme(nativeTheme, theme) {
  if (theme !== 'light' && theme !== 'dark') return false;
  nativeTheme.themeSource = theme;
  return true;
}

module.exports = { menuTemplate, applyNativeTheme };
