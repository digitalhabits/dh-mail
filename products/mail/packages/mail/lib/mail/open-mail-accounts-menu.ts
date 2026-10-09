/**
 * Open Settings from elsewhere, on one of its categories if asked.
 *
 * The mailbox filter next to search lists the same mailboxes, so that is
 * where people look to add or remove one. It sends them here instead of
 * holding a second copy of the controls. The desktop app's Settings… menu
 * item lands here too — see apps/mail/src/main.tsx. The standalone Contact
 * sources dialog uses the same event to go back to the Contacts page.
 */

export const OPEN_MAIL_ACCOUNTS_EVENT = "mail:open-accounts";

/** The categories on the Settings rail, in the order they are listed. */
export const MAIL_SETTINGS_CATEGORIES = [
  "accounts",
  "general",
  "reading",
  "snooze",
  "contacts",
  "shortcuts",
] as const;

export type MailSettingsCategory = (typeof MAIL_SETTINGS_CATEGORIES)[number];

export function isMailSettingsCategory(value: unknown): value is MailSettingsCategory {
  return MAIL_SETTINGS_CATEGORIES.includes(value as MailSettingsCategory);
}

export function openMailAccountsMenu(detail?: { category?: MailSettingsCategory }): void {
  if (typeof window === "undefined") return;
  // A menu event handler passes its own event object here. Only a category
  // this file knows is passed on.
  const category = isMailSettingsCategory(detail?.category) ? detail.category : undefined;
  window.dispatchEvent(new CustomEvent(OPEN_MAIL_ACCOUNTS_EVENT, { detail: { category } }));
}
