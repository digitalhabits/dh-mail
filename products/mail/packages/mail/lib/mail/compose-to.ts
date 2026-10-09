"use client";

/**
 * "Write to this address."
 *
 * An address can be clicked deep inside a message — in the plain-text body, or
 * in the sandboxed frame that renders HTML — and the composer lives at the top
 * of the page. A window event carries the request up, the same way the
 * mailbox filter asks the settings menu to open.
 *
 * The reader's own mail client is not what opens. We are the mail client.
 */

export const MAIL_COMPOSE_TO_EVENT = "redd-plan-mail-compose-to";

/** Ask the interface to open a new message addressed to `address`. */
export function requestMailComposeTo(address: string): void {
  const to = address.trim().replace(/^mailto:/i, "");
  if (!to) return;
  window.dispatchEvent(
    new CustomEvent<{ address: string }>(MAIL_COMPOSE_TO_EVENT, {
      detail: { address: to },
    })
  );
}

/** Listen for those requests. Returns the unsubscribe. */
export function onMailComposeTo(
  handler: (address: string) => void
): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<{ address: string }>).detail;
    if (detail?.address) handler(detail.address);
  };
  window.addEventListener(MAIL_COMPOSE_TO_EVENT, listener);
  return () => window.removeEventListener(MAIL_COMPOSE_TO_EVENT, listener);
}
