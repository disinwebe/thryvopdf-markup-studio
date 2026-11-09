const READ_SHARED_OPS = new Set(['list', 'open', 'poll', 'leave']);

function requireAccess(auth, license, editing = false) {
  if (!auth.current()) throw new Error('Not signed in');
  if (editing) {
    const status = license.status();
    if (!status.ok) throw new Error(status.error || 'This device is not licensed.');
  }
}

function sharedOperationRequiresLicense(op) {
  return !READ_SHARED_OPS.has(op);
}

module.exports = { requireAccess, sharedOperationRequiresLicense };
