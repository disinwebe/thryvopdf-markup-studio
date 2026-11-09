const INVALID_WINDOWS_NAME = /[<>:"/\\|?*\u0000-\u001f]/g;
const RESERVED_WINDOWS_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function normalizePdfFilename(value: string): string | null {
  const cleaned = value.trim().replace(INVALID_WINDOWS_NAME, '_').replace(/[. ]+$/g, '').slice(0, 120);
  const stem = cleaned.replace(/\.pdf$/i, '').trim().replace(/[. ]+$/g, '');
  if (!stem) return null;
  const safeStem = RESERVED_WINDOWS_NAME.test(stem) ? `_${stem}` : stem;
  return `${safeStem}.pdf`;
}
