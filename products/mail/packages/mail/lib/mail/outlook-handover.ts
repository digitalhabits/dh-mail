"use client";

/**
 * Which Outlook mailbox a draft is handed to.
 *
 * The reason to finish a mail in Outlook is usually that Outlook is the
 * only place one particular address can be sent from — a university
 * account, most often — and that address does not change from one mail to
 * the next. So it is remembered rather than guessed: guessing picked the
 * first Outlook mailbox the app happened to know, which put a work draft
 * in somebody's personal Outlook.com account.
 *
 * The reply being written wins where it can, because a draft made in the
 * mailbox that holds the conversation is a real reply and keeps its place
 * in the thread. Everything else is the reader's standing choice.
 */

const OUTLOOK_DRAFT_ACCOUNT_KEY = "redd-plan-mail-outlook-draft-account";

export function readOutlookDraftAccount(): string | null {
  try {
    const stored = localStorage.getItem(OUTLOOK_DRAFT_ACCOUNT_KEY);
    return stored?.trim() ? stored : null;
  } catch {
    /* private mode */
    return null;
  }
}

export function writeOutlookDraftAccount(account: string): void {
  try {
    localStorage.setItem(OUTLOOK_DRAFT_ACCOUNT_KEY, account);
  } catch {
    /* private mode */
  }
}

/**
 * Handing it over without a mailbox of ours: a new Outlook message, and the
 * body on the pasteboard. Stored under this name when it is chosen.
 */
export const OUTLOOK_COMPOSE = "compose";

/**
 * Where this message goes, and how.
 *
 * "" is the new-message route, which needs no mailbox and is therefore the
 * only answer that always exists. It is also the default, because the
 * alternative — writing a draft into whichever Outlook mailbox happens to
 * be connected — put a work draft in a personal account. A draft is made
 * only in a mailbox the reader is writing from, or one they named.
 */
export function outlookDraftAccount(
  outlookAccounts: string[],
  /** The account the message is being written from, when there is one. */
  from?: string
): string {
  const known = (email: string) =>
    outlookAccounts.some((a) => a.toLowerCase() === email.trim().toLowerCase());
  const stored = readOutlookDraftAccount();
  if (stored === OUTLOOK_COMPOSE) return "";
  if (stored && known(stored)) return stored;
  if (from && known(from)) return from;
  return "";
}
