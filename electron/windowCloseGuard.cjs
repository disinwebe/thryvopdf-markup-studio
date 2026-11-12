function createWindowCloseGuard(win) {
  let rendererReady = false;
  let requestPending = false;
  let closeApproved = false;

  return {
    markReady() {
      rendererReady = true;
    },
    onClose(event) {
      if (closeApproved || !rendererReady || win.isDestroyed()) return;
      event.preventDefault();
      if (requestPending) return;
      requestPending = true;
      win.webContents.send('app-close-requested');
    },
    respond(allow) {
      if (!requestPending || typeof allow !== 'boolean') return false;
      requestPending = false;
      if (!allow) return true;
      closeApproved = true;
      win.close();
      return true;
    },
  };
}

module.exports = { createWindowCloseGuard };
