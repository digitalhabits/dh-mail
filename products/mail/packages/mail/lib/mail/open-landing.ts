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
 * No React here, so a test can read it.
 */

export function openLandingMessageId(
  messages: readonly { id: string; unread?: boolean }[],
  newestMessageId: string
): string {
  let first = -1;
  for (let i = messages.length - 1; i >= 0 && messages[i].unread; i--) first = i;
  return first >= 0 ? messages[first].id : newestMessageId;
}
