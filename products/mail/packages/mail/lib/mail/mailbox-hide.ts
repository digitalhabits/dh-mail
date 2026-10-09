/**
 * Hiding a mailbox for a while: for an hour, until a time, or on a weekly
 * schedule, with words to type before showing it early.
 *
 * Hidden is the mailbox's "in Mail" flag, the one the eye in Settings sets:
 * a hidden mailbox leaves the list, the search and All, and stays connected.
 * "Until I show it" is that flag and nothing more. The timed kinds are kept
 * here, on this machine (as the pause is), and the page turns the flag off
 * when one begins and on when it ends (useMailboxHide). It turns on only a
 * mailbox it turned off itself (`autoHidden`), so a mailbox hidden by hand
 * is never shown by a clock.
 *
 * A schedule is the pause schedule's shape and rules (MailQuietWindow,
 * mailPauseVerdict): a window over midnight is a night, overlapping windows
 * are one, and the one ending last says when it ends. Showing a mailbox
 * early inside a window shows it until that window ends (`shownUntil`).
 */

import {
  formatClock,
  mailPauseVerdict,
  minutesOfDay,
  parseClock,
  readPauseState,
  type MailQuietWindow,
} from "@/lib/mail/quiet-hours";
import { normaliseUnpauseWords } from "@/lib/mail/unpause-friction";

/** One mailbox's timed hiding. */
export type MailboxHide = {
  /** Hidden until this moment (epoch ms). */
  hiddenUntil?: number;
  /** The weekly windows it is hidden in. */
  hours?: MailQuietWindow[];
  /** Shown early inside a window: shown until this moment. */
  shownUntil?: number;
  /** This machine hid it (by a time or the schedule), so a clock may show it again. */
  autoHidden?: boolean;
};

export type MailboxHideState = {
  /** Keyed by the address in lower case. */
  accounts: Record<string, MailboxHide>;
  /** Words to type before showing a mailbox early. 0 is none. */
  showWords?: number;
};

export const MAILBOX_HIDE_DEFAULT: MailboxHideState = { accounts: {} };

export function hideKey(email: string): string {
  return email.trim().toLowerCase();
}

export type MailboxHideVerdict = {
  hidden: boolean;
  /** What hides it now: a time set, or the schedule. */
  reason: "until" | "schedule" | null;
  /** When it shows again: a Date for a time, "HH:MM" for the schedule. */
  until: Date | null;
  untilClock: string | null;
};

const NOT_HIDDEN: MailboxHideVerdict = { hidden: false, reason: null, until: null, untilClock: null };

/** Is the mailbox hidden by a time or its schedule now, and until when? */
export function mailboxHideVerdict(row: MailboxHide | undefined, now: Date): MailboxHideVerdict {
  if (!row) return NOT_HIDDEN;
  if (row.hiddenUntil && row.hiddenUntil > now.getTime()) {
    const until = new Date(row.hiddenUntil);
    return { hidden: true, reason: "until", until, untilClock: formatClock(minutesOfDay(until)) };
  }
  if (row.hours?.length && !(row.shownUntil && row.shownUntil > now.getTime())) {
    const verdict = mailPauseVerdict({ quietHours: row.hours }, now);
    if (verdict.paused) return { hidden: true, reason: "schedule", until: null, untilClock: verdict.untilClock };
  }
  return NOT_HIDDEN;
}

/**
 * Shown early inside a schedule window: the window's end ("HH:MM"), so the
 * menu can offer to hide it again. Null when it is not shown early.
 */
export function shownEarlyUntil(row: MailboxHide | undefined, now: Date): string | null {
  if (!row?.hours?.length || !(row.shownUntil && row.shownUntil > now.getTime())) return null;
  const verdict = mailPauseVerdict({ quietHours: row.hours }, now);
  return verdict.paused ? verdict.untilClock : null;
}

/**
 * The moment the schedule window it is in now ends, or null outside one.
 * For "show now" inside a window: shown until the window would have ended.
 */
export function scheduleWindowEnd(hours: MailQuietWindow[] | undefined, now: Date): number | null {
  if (!hours?.length) return null;
  const verdict = mailPauseVerdict({ quietHours: hours }, now);
  if (!verdict.paused || !verdict.untilClock) return null;
  const end = parseClock(verdict.untilClock);
  if (end == null) return null;
  const minutes = (end - minutesOfDay(now) + 1440) % 1440 || 1440;
  const at = new Date(now.getTime() + minutes * 60_000);
  at.setSeconds(0, 0);
  return at.getTime();
}

/** What the page should do to the "in Mail" flag of one mailbox now. */
export type HideStep = "hide" | "show" | null;

/**
 * Hide a mailbox a time or the schedule hides and Mail still shows; show one
 * this machine hid once its time is over. Never shows a mailbox hidden by
 * hand (not `autoHidden`).
 */
export function hideStep(row: MailboxHide | undefined, inMailTab: boolean, now: Date): HideStep {
  const verdict = mailboxHideVerdict(row, now);
  if (verdict.hidden && inMailTab) return "hide";
  if (!verdict.hidden && !inMailTab && row?.autoHidden) return "show";
  return null;
}

/** Read stored state, keeping only what is well formed. */
export function readHideState(raw: unknown): MailboxHideState {
  if (!raw || typeof raw !== "object") return MAILBOX_HIDE_DEFAULT;
  const value = raw as { accounts?: unknown; showWords?: unknown };
  const accounts: Record<string, MailboxHide> = {};
  if (value.accounts && typeof value.accounts === "object") {
    for (const [email, rawRow] of Object.entries(value.accounts as Record<string, unknown>)) {
      if (!email.trim() || !rawRow || typeof rawRow !== "object") continue;
      const row = rawRow as Record<string, unknown>;
      const out: MailboxHide = {};
      if (typeof row.hiddenUntil === "number" && Number.isFinite(row.hiddenUntil)) out.hiddenUntil = row.hiddenUntil;
      if (typeof row.shownUntil === "number" && Number.isFinite(row.shownUntil)) out.shownUntil = row.shownUntil;
      if (row.autoHidden === true) out.autoHidden = true;
      // The windows are the pause schedule's, read by its own reader.
      const hours = readPauseState({ quietHours: row.hours }).quietHours;
      if (hours.length) out.hours = hours;
      if (Object.keys(out).length) accounts[hideKey(email)] = out;
    }
  }
  const showWords = normaliseUnpauseWords(value.showWords);
  return { accounts, ...(showWords ? { showWords } : null) };
}
