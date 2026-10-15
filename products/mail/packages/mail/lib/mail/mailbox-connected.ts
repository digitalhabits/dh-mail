/**
 * A mailbox was just connected for the first time: the page asks how it
 * should fit the week (AccountRhythmDialog). A reconnect asks nothing.
 *
 * Held as well as announced. The first mailbox is connected from the
 * welcome screen, before the mail page is there to hear an event, so the
 * page takes the waiting address when it mounts.
 */

export const MAILBOX_CONNECTED_EVENT = "mail:mailbox-connected";

let waiting: string | null = null;

export function announceMailboxConnected(email: string): void {
  const address = email.trim().toLowerCase();
  if (!address) return;
  waiting = address;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(MAILBOX_CONNECTED_EVENT, { detail: { email: address } }));
  }
}

/** The address waiting to be asked about, taken once. */
export function takeConnectedMailbox(): string | null {
  const address = waiting;
  waiting = null;
  return address;
}
