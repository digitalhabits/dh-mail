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
/*
  One warm grey for everybody. Colour per person was meant to help tell
  faces apart, and in a list of mail it mostly pulled the eye off the
  words; the initials do the telling apart (Ulrik, 2026-10-11). The tone is
  in mail.css, with its dark version.
*/
/** The style of a face with no picture: the same quiet grey for everyone. */
export function avatarStyle(_key: string): string {
  return "mail-avatar-neutral";
}
