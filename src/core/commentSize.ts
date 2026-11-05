export const COMMENT_SIZE_KEY = 'pms.commentSize';
export const COMMENT_SIZE_MIN = 7;
export const COMMENT_SIZE_MAX = 18;
export const COMMENT_SIZE_DEFAULT = 9;

export const clampCommentSize = (v: unknown): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(COMMENT_SIZE_MAX, Math.max(COMMENT_SIZE_MIN, n)) : COMMENT_SIZE_DEFAULT;
};

type Store = Pick<Storage, 'getItem' | 'setItem'>;
const store = (): Store | null => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
};

export function loadCommentSize(s: Store | null = store()): number {
  try {
    const v = s?.getItem(COMMENT_SIZE_KEY);
    return v == null ? COMMENT_SIZE_DEFAULT : clampCommentSize(v);
  } catch {
    return COMMENT_SIZE_DEFAULT;
  }
}

export function saveCommentSize(n: number, s: Store | null = store()) {
  try {
    s?.setItem(COMMENT_SIZE_KEY, String(clampCommentSize(n)));
  } catch {
    /* preference simply won't persist */
  }
}

// Current size used when laying out comment boxes (on screen and in the saved PDF appearance).
let current = loadCommentSize();
export const getCommentSize = () => current;
export const setCommentSize = (n: number) => {
  current = clampCommentSize(n);
  saveCommentSize(current);
};
