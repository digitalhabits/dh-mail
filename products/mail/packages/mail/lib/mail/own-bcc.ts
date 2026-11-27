/**
 * The Bcc field of a message, for the reader's own messages only.
 *
 * Only the sender's copy of a message has Bcc. A received message that
 * carries a Bcc list (a server that left the header in, or a copy sent to
 * the reader in Bcc) must not show who else was hidden from the others, as
 * Gmail and Outlook do not. So the list goes on a message of ours and on
 * no other message, and not at all when it is empty.
 */
export function ownBcc(own: boolean, emails: readonly string[]): { bccEmails?: string[] } {
  const list = emails.filter(Boolean);
  return own && list.length ? { bccEmails: [...list] } : {};
}
