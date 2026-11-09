const path = require('node:path');

function writeSavedFile(file, data, fsImpl = require('node:fs')) {
  try {
    fsImpl.writeFileSync(file, typeof data === 'string' ? data : Buffer.from(data));
  } catch (error) {
    if (error && error.code === 'EBUSY') {
      throw new Error('The file is locked or in use. Close it in other applications or preview windows, then try Save again, or use Save As to save a copy.');
    }
    throw error;
  }
}

function renamePdfFile(source, name, allowed, fsImpl = require('node:fs')) {
  const safeName = path.basename(String(name || ''))
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 120);
  const stem = safeName.replace(/\.pdf$/i, '');
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem);
  if (typeof source !== 'string' || !allowed.has(source) || path.extname(source).toLowerCase() !== '.pdf' || !stem || reserved || !/\.pdf$/i.test(safeName)) {
    return { ok: false, error: 'Choose a valid PDF filename.' };
  }
  const target = path.join(path.dirname(source), safeName);
  if (target !== source && fsImpl.existsSync(target)) return { ok: false, error: 'A file with that name already exists in this folder.' };
  try {
    if (target !== source) fsImpl.renameSync(source, target);
    allowed.delete(source);
    allowed.add(target);
    return { ok: true, path: target };
  } catch {
    return { ok: false, error: 'Could not rename the PDF. Check that the file is not in use.' };
  }
}

module.exports = { renamePdfFile, writeSavedFile };
