import { Comment, Markup } from './types';

export interface Actor {
  name: string;
  email?: string;
  role?: string;
}

/** Mirrors the server rule: ownership by e-mail when the comment is stamped, by name otherwise. */
export const ownsComment = (c: Comment, u: Actor): boolean => (c.authorEmail ? c.authorEmail === u.email : c.author === u.name);

/** Only the author edits a comment (administrators cannot rewrite someone else's words). */
export const canEditComment = ownsComment;

/** The author deletes a comment; administrators may also delete (moderation). */
export const canDeleteComment = (c: Comment, u: Actor): boolean => ownsComment(c, u) || u.role === 'admin';

/** A markup can be removed only if every comment on it may be deleted by the user. */
/** Only the author of a markup can delete it (administrators do not bypass this). */
export const canDeleteMarkup = (m: Markup, u: Actor): boolean => (m.authorEmail ? m.authorEmail === u.email : m.author === u.name);