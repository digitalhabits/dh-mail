/**
 * The glyph shown for a person who has no picture.
 *
 * Initials, and a colour picked from their address rather than at random, so
 * the same person is the same colour on every load and in every window.
 *
 * The thread list and the popout header both use it, so it is written once,
 * in this module.
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
  One warm grey for everybody. Colour per person can help tell faces
  apart, but in a list of mail it mostly pulls the eye off the words. The
  initials do the telling apart. The tone is
  in mail.css, with its dark version.
*/
/** The style of a face with no picture: the same quiet grey for everyone. */
export function avatarStyle(_key: string): string {
  return "mail-avatar-neutral";
}
