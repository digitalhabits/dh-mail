/**
 * What a paused mailbox shows: the mail it held when the pause began.
 *
 * A pause holds back the mail that comes in. The list is not read again,
 * but a search reached past it, and so did a thread opened from a search:
 * the copy goes on filling during a pause, so both showed the mail the
 * pause was holding back. A reader in a bad hour searched again and again
 * to see whether a thread had news (a tester, 2026-10-27). Old mail must
 * stay findable; new mail must not.
 *
 * The cut-off is the last time the mailbox's inbox was read while it was
 * not paused (use-paused-snooze-wakes notes it): the list on screen was
 * read then, so anything newer is mail the pause holds back. The reader's
 * own mail is not held back. A mailbox never read live has no cut-off, and
 * nothing is held back from its search.
 *
 * The rules are pure; `pauseCutOff` reads the two settings it needs.
 */

import { mailPauseVerdictForAccount, readPauseState, type MailPauseState } from "@/lib/mail/quiet-hours";
import { MAIL_LAST_LIVE_READ_KEY, MAIL_PAUSE_KEY } from "@/lib/mail/storage-keys";

/** Each mailbox's last live inbox read (ms), by its address in lower case. */
export function readLastLiveReads(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(MAIL_LAST_LIVE_READ_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** The cut-off for this mailbox now, or null when nothing is held back. */
export function cutOffFor(
  pause: MailPauseState,
  liveReads: Readonly<Record<string, number>>,
  account: string,
  now: Date
): number | null {
  if (!mailPauseVerdictForAccount(pause, account, now).paused) return null;
  const at = liveReads[account.trim().toLowerCase()];
  return typeof at === "number" && Number.isFinite(at) ? at : null;
}

/** The same, from the settings this app keeps. Null outside a window. */
export function pauseCutOff(account: string, now = new Date()): number | null {
  if (typeof window === "undefined") return null;
  let pause: MailPauseState;
  try {
    pause = readPauseState(JSON.parse(window.localStorage.getItem(MAIL_PAUSE_KEY) ?? "null"));
  } catch {
    return null;
  }
  return cutOffFor(pause, readLastLiveReads(), account, now);
}

/** Whether a message is shown under a cut-off: from before it, or the reader's own. */
export function shownUnderCutOff(
  message: { sentAt: number; own: boolean },
  cutOff: number | null
): boolean {
  return cutOff == null || message.own || message.sentAt < cutOff;
}
