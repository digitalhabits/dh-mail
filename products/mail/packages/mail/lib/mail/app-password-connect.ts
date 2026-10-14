/**
 * Asking for the Gmail app-password form.
 *
 * A Gmail connected with an app password signs in again with a new
 * password, never with Google's sign-in, which would not take it. The
 * desktop app's connect seam sends a reconnect of such a mailbox here. The
 * form is in Settings → Accounts, so Settings opens on that page, and the
 * form takes the address when it is mounted.
 *
 * In both builds; only the organization's build has the form, and only it
 * has such mailboxes.
 */

import { openMailAccountsMenu } from "@/lib/mail/open-mail-accounts-menu";

export const APP_PASSWORD_CONNECT_REQUEST = "dh-mail-app-password-connect";

/** The address asked for, until the form takes it. */
let pending: string | null = null;

/** Open the form for this mailbox. */
export function requestAppPasswordConnect(email: string): void {
  pending = email.trim().toLowerCase();
  openMailAccountsMenu({ category: "accounts" });
  window.dispatchEvent(new CustomEvent(APP_PASSWORD_CONNECT_REQUEST, { detail: { email: pending } }));
}

/** The address waiting for the form, once. */
export function takeAppPasswordConnectRequest(): string | null {
  const email = pending;
  pending = null;
  return email;
}
