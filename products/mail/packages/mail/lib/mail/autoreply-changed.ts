/**
 * Word, inside the page, that a mailbox's out-of-office reply was changed
 * somewhere other than the Out of office dialog. The mark on the mailbox
 * and an open dialog read it, so they show the new reply without a reload.
 *
 * The detail is the reply as the provider answered it.
 */

const EVENT = "mail:autoreply-changed";

export function announceAutoReplyChanged(reply: { account: string }): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: reply }));
}

/** Call `listener` with each changed reply. Answers the way to stop. */
export function onAutoReplyChanged<T extends { account: string }>(listener: (reply: T) => void): () => void {
  const handle = (event: Event) => {
    const reply = (event as CustomEvent<T>).detail;
    if (reply && typeof reply.account === "string") listener(reply);
  };
  window.addEventListener(EVENT, handle);
  return () => window.removeEventListener(EVENT, handle);
}
