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
 *
 * "Hide again after" (`hideAgainMinutes`) cuts an early show short: shown
 * early, a mailbox hides itself again after that long, or when its own
 * time or window ends, whichever comes first. The menu is Blocker's "Turn
 * back on after"; 0, the default, is Never.
 */

import {
  formatClock,
  mailPauseVerdict,
  minutesOfDay,
  readPauseState,
  type MailQuietWindow,
} from "@/lib/mail/quiet-hours";
import type { MailT } from "@/lib/mail/i18n-strings";
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
  /**
   * Its own words to type before it is shown early, and its own "Hide again
   * after". Absent: the state's, which are every account's
   * until one is given its own. 0 is kept: none, for this account.
   */
  showWords?: number;
  hideAgainMinutes?: number;
};

export type MailboxHideState = {
  /** Keyed by the address in lower case. */
  accounts: Record<string, MailboxHide>;
  /** Words to type before showing a mailbox early. 0 is none. */
  showWords?: number;
  /** Shown early, hidden again after this many minutes. 0 or absent is Never. */
  hideAgainMinutes?: number;
};

/** The "Hide again after" menu, in minutes; 0 is Never. Blocker's menu. */
export const HIDE_AGAIN_OPTIONS = Object.freeze([0, 5, 10, 15, 30, 60, 120, 240, 480, 1440]);

/** One of the menu's values, or 0 (Never) for anything else. */
export function normaliseHideAgainMinutes(value: unknown): number {
  return typeof value === "number" && HIDE_AGAIN_OPTIONS.includes(value) ? value : 0;
}

/** A "Hide again after" length in words: Never, 15 minutes, 1 hour, 8 hours. */
export function hideAgainLabel(minutes: number, t: MailT): string {
  if (minutes === 0) return t("hideAgainNever");
  if (minutes < 60) return t("hideAgainMinutes", { count: minutes });
  if (minutes === 60) return t("hideAgainOneHour");
  return t("hideAgainHours", { count: minutes / 60 });
}

/**
 * Whether "Hide again after" is what ends an early show: set, and sooner
 * than the end of the mailbox's own time or window. Then the question
 * before showing it names how long.
 */
export function hideAgainEndsShow(ownEnd: number | null, hideAgainMinutes: number, now: Date): boolean {
  if (hideAgainMinutes <= 0) return false;
  return ownEnd == null || ownEnd - now.getTime() > hideAgainMinutes * 60_000;
}

/**
 * When a mailbox shown early now hides again: the end of its own time or
 * window, cut short by "Hide again after". Null when nothing hides it again.
 */
export function shownEarlyEnd(ownEnd: number | null, hideAgainMinutes: number, now: Date): number | null {
  const after = hideAgainMinutes > 0 ? now.getTime() + hideAgainMinutes * 60_000 : null;
  if (ownEnd == null) return after;
  return after == null ? ownEnd : Math.min(ownEnd, after);
}

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
  /** The schedule's: the moment it shows again, past windows that run on. */
  endsAt?: Date | null;
};

const NOT_HIDDEN: MailboxHideVerdict = { hidden: false, reason: null, until: null, untilClock: null };

/** Is the mailbox hidden by a time or its schedule now, and until when? */
export function mailboxHideVerdict(row: MailboxHide | undefined, now: Date): MailboxHideVerdict {
  if (!row) return NOT_HIDDEN;
  const shownEarly = Boolean(row.shownUntil && row.shownUntil > now.getTime());
  if (row.hiddenUntil && row.hiddenUntil > now.getTime() && !shownEarly) {
    const until = new Date(row.hiddenUntil);
    return { hidden: true, reason: "until", until, untilClock: formatClock(minutesOfDay(until)) };
  }
  if (row.hours?.length && !shownEarly) {
    const verdict = mailPauseVerdict({ quietHours: row.hours }, now);
    if (verdict.paused) {
      return { hidden: true, reason: "schedule", until: null, untilClock: verdict.untilClock, endsAt: verdict.endsAt ?? null };
    }
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
  if (!verdict.paused) return null;
  return verdict.endsAt?.getTime() ?? null;
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
  const value = raw as { accounts?: unknown; showWords?: unknown; hideAgainMinutes?: unknown };
  const accounts: Record<string, MailboxHide> = {};
  if (value.accounts && typeof value.accounts === "object") {
    for (const [email, rawRow] of Object.entries(value.accounts as Record<string, unknown>)) {
      if (!email.trim() || !rawRow || typeof rawRow !== "object") continue;
      const row = rawRow as Record<string, unknown>;
      const out: MailboxHide = {};
      if (typeof row.hiddenUntil === "number" && Number.isFinite(row.hiddenUntil)) out.hiddenUntil = row.hiddenUntil;
      if (typeof row.shownUntil === "number" && Number.isFinite(row.shownUntil)) out.shownUntil = row.shownUntil;
      if (row.autoHidden === true) out.autoHidden = true;
      if (typeof row.showWords === "number") out.showWords = normaliseUnpauseWords(row.showWords);
      if (typeof row.hideAgainMinutes === "number") out.hideAgainMinutes = normaliseHideAgainMinutes(row.hideAgainMinutes);
      // The windows are the pause schedule's, read by its own reader.
      const hours = readPauseState({ quietHours: row.hours }).quietHours;
      if (hours.length) out.hours = hours;
      if (Object.keys(out).length) accounts[hideKey(email)] = out;
    }
  }
  const showWords = normaliseUnpauseWords(value.showWords);
  const hideAgainMinutes = normaliseHideAgainMinutes(value.hideAgainMinutes);
  return {
    accounts,
    ...(showWords ? { showWords } : null),
    ...(hideAgainMinutes ? { hideAgainMinutes } : null),
  };
}

/** An account's words to type before it is shown early: its own, or every account's. */
export function showWordsFor(state: MailboxHideState, email: string): number {
  return state.accounts[hideKey(email)]?.showWords ?? state.showWords ?? 0;
}

/** An account's "Hide again after", in minutes: its own, or every account's. */
export function hideAgainFor(state: MailboxHideState, email: string): number {
  return state.accounts[hideKey(email)]?.hideAgainMinutes ?? state.hideAgainMinutes ?? 0;
}
