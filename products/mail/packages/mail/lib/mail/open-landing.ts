/**
 * The message a thread opens on.
 *
 * The first of the unread messages at the end: the ones after the last
 * message the reader has read. Not the first unread anywhere. A message
 * in the middle of a thread can stay unread for good, read on a phone
 * that never said so, or passed over. The rule that took the first unread
 * anywhere opened such a thread weeks back, in the middle, and the new
 * mail was far below. When nothing at the end is unread, the newest.
 *
 * A message the reader sent ends the run, unread or not: writing it, they
 * had read what came before. A reply of theirs that the copy holds as
 * unread made the thread open on it, above the answer that was new
 * (2026-10-14).
 *
 * No React here, so a test can read it.
 */

export function openLandingMessageId(
  messages: readonly { id: string; unread?: boolean; own?: boolean }[],
  newestMessageId: string
): string {
  let first = -1;
  for (let i = messages.length - 1; i >= 0 && messages[i].unread && !messages[i].own; i--) first = i;
  return first >= 0 ? messages[first].id : newestMessageId;
}
