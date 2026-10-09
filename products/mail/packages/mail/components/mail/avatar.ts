/**
 * The glyph shown for a person who has no picture.
 *
 * Initials, and a colour picked from their address rather than at random, so
 * the same person is the same colour on every load and in every window.
 *
 * This was written twice — once in the thread list and once in the popout
 * header — with a comment on the second copy saying it stayed local so the
 * header would not depend on MailPage. That is what a module is for.
 */

/** Same initials rule as the compose recipient contact list. */
export function senderInitials(name: string, email: string): string {
  const source = name.replace(/\(.*\)/, "").trim() || email;
  const words = source.split(/[\s.@_-]+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}
const AVATAR_STYLES = [
  "bg-sky-100 text-sky-700",
  "bg-amber-100 text-amber-700",
  "bg-emerald-100 text-emerald-700",
  "bg-violet-100 text-violet-700",
  "bg-rose-100 text-rose-700",
  "bg-teal-100 text-teal-700",
  "bg-indigo-100 text-indigo-700",
];
/** Deterministic pastel per person, so avatars keep their color across loads. */
export function avatarStyle(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return AVATAR_STYLES[Math.abs(hash) % AVATAR_STYLES.length];
}
