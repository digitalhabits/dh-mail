/**
 * A Gmail mailbox connected with an app password.
 *
 * The internal app's Google sign-in takes only the organization's own
 * accounts, so a personal Gmail gets in with an app password instead: Gmail's
 * IMAP and SMTP servers take it with no Google sign-in, and the local store
 * (mail_native::sync) reads, sends and acts on the mailbox with it. It is kept
 * where a Google grant is kept, in the mailbox's keychain item, behind a mark
 * that tells it apart.
 *
 * What only Google's own Gmail API does — the label list, a new label,
 * the auto-reply, Google contacts, the name in Gmail's settings — has no
 * door for it. Those ask for an access token and get `GmailAppPasswordError`,
 * and say the feature is not there for this mailbox.
 *
 * No React and no storage of its own here, so a suite can read it.
 */

/** Before the password in the keychain item. The same mark as mail_native::sync. */
export const APP_PASSWORD_MARK = "app-password:";

/** Whether a stored Gmail secret is an app password, not a Google grant. */
export function isAppPasswordSecret(secret: string | null | undefined): boolean {
  return Boolean(secret?.startsWith(APP_PASSWORD_MARK));
}

/**
 * What is stored for an app password: the mark, then the password with the
 * spaces Google shows it in taken out.
 */
export function appPasswordSecret(password: string): string {
  return APP_PASSWORD_MARK + password.replace(/\s+/g, "");
}

/** Google shows an app password as four groups of four letters. */
export function looksLikeAppPassword(password: string): boolean {
  return /^[a-z]{16}$/i.test(password.replace(/\s+/g, ""));
}

/**
 * A Google API feature asked for on a mailbox that has no Google sign-in.
 * Not a reconnect: the mailbox is fine, the feature is not there for it.
 */
export class GmailAppPasswordError extends Error {
  readonly accountEmail: string;

  constructor(accountEmail: string) {
    super(`${accountEmail} is connected with an app password, which Google's Gmail API does not take`);
    this.name = "GmailAppPasswordError";
    this.accountEmail = accountEmail;
  }
}

export function isGmailAppPasswordError(err: unknown): err is GmailAppPasswordError {
  return err instanceof Error && err.name === "GmailAppPasswordError";
}
