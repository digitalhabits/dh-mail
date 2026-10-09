/**
 * Which address a new message starts from.
 *
 * The composer opened on the first connected mailbox, which is an accident
 * of connection order rather than an answer. This is the memory of the one
 * the reader picked and asked to keep.
 *
 * New messages only. A reply starts from the address the message was sent
 * to — the mailbox it was read in — and that is a property of the thread,
 * not a preference: remembering an address there would answer for a message
 * that has already been addressed.
 */

const COMPOSE_FROM_KEY = "redd-plan-mail-compose-from";

/** The remembered address, or null when there has never been one. */
export function readComposeFrom(): string | null {
  try {
    const stored = localStorage.getItem(COMPOSE_FROM_KEY);
    return stored?.trim() ? stored : null;
  } catch {
    /* private mode */
    return null;
  }
}

export function writeComposeFrom(account: string): void {
  try {
    localStorage.setItem(COMPOSE_FROM_KEY, account);
  } catch {
    /* private mode */
  }
}

/**
 * The address to open on, given the mailboxes there are today.
 *
 * Three answers, in the order they deserve to be believed:
 *
 * 1. The address the reader asked to keep. They said so in as many words,
 *    and a tab is not an argument against it.
 * 2. The mailbox they are working in. With one account tab picked, every
 *    message on screen is that mailbox's, and a new one starting from
 *    another is the composer answering a question nobody asked.
 * 3. The first connected mailbox, which is an accident of connection order
 *    and only stands where nothing better does.
 *
 * A remembered address that is no longer connected is not an answer either,
 * so it falls through the same way — otherwise disconnecting an account
 * would leave the composer naming a mailbox it cannot send from.
 */
export function composeFromDefault(
  accounts: string[],
  /** The account tabs in force. Empty, or more than one, means "All". */
  scope: string[] = []
): string {
  const stored = readComposeFrom();
  if (stored && accounts.includes(stored)) return stored;
  const only = scope.length === 1 ? scope[0] : undefined;
  if (only && accounts.includes(only)) return only;
  return accounts[0] ?? "";
}
