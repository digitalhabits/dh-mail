"use client";

/**
 * Hiding mailboxes for a while, on the page: the state (on this machine, as
 * the pause is), the clock that hides and shows them when a time or a
 * schedule window begins and ends, the list of the hidden ones for the tabs,
 * and what the tabs' menus do. The rules are lib/mail/mailbox-hide.
 */

import { diagEvent, diagHours, diagTime, mailboxNumber } from "@/lib/mail/diagnostics";
import { MAILBOX_HIDE_KEY as KEY } from "@/lib/mail/storage-keys";
import * as React from "react";

import { requestUnpauseChallenge } from "@/components/mail/UnpauseChallenge";
import { useMailT } from "@/lib/mail/i18n";
import {
  hideAgainEndsShow,
  DEFAULT_HIDE_AGAIN_MINUTES,
  hideAgainFor,
  hideAgainLabel,
  handHideRow,
  hideKey,
  hideStep,
  mailboxHideVerdict,
  MAILBOX_HIDE_DEFAULT,
  normaliseHideAgainMinutes,
  readHideState,
  scheduleWindowEnd,
  shownEarlyEnd,
  shownEarlyUntil,
  showWordsFor,
  strandedHandHide,
  type MailboxHide,
  type MailboxHideState,
  type MailboxHideVerdict,
} from "@/lib/mail/mailbox-hide";
import { listHiddenMailboxes, setMailboxInMailTab } from "@/lib/mail/mailbox-visibility";
import type { MailQuietWindow } from "@/lib/mail/quiet-hours";
import { toast } from "@/lib/mail/toast";
import { normaliseUnpauseWords } from "@/lib/mail/unpause-friction";
import { useMailRouter } from "@/lib/mail-router";

const EVENT = "redd-plan-mail-hide-changed";

function read(): MailboxHideState {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? readHideState(JSON.parse(raw)) : MAILBOX_HIDE_DEFAULT;
  } catch {
    return MAILBOX_HIDE_DEFAULT;
  }
}

function write(state: MailboxHideState): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode: the hiding lasts as long as the window */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Change one mailbox's row; an empty row goes. */
function patchRow(email: string, patch: (row: MailboxHide) => MailboxHide): MailboxHideState {
  const state = read();
  const key = hideKey(email);
  const next = patch(state.accounts[key] ?? {});
  const accounts = { ...state.accounts };
  const kept = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined && v !== false));
  if (Object.keys(kept).length) accounts[key] = kept as MailboxHide;
  else delete accounts[key];
  const state2 = { ...state, accounts };
  write(state2);
  return state2;
}

/** How a hidden mailbox is hidden, for its tab. */
export type MailboxHideStatus = MailboxHideVerdict & {
  byHand: boolean;
  /** Shown early inside a schedule window: when that window ends ("HH:MM"). */
  shownEarlyUntil: string | null;
};

export type MailboxHideControls = {
  /** The connected mailboxes hidden now, by hand or by a time. */
  hidden: string[];
  statusOf: (email: string) => MailboxHideStatus;
  hoursOf: (email: string) => MailQuietWindow[];
  showWords: number;
  /** `from`: where it was asked, for the log ("menu: for 1 hour"). */
  hideUntil: (email: string, until: number, from?: string) => void;
  hideByHand: (email: string) => void;
  setHours: (email: string, windows: MailQuietWindow[]) => void;
  showNow: (email: string) => void;
  /** Shown early inside a schedule window: let the schedule hide it again. */
  resumeSchedule: (email: string) => void;
  setShowWords: (count: number) => void;
  /** Shown early, hidden again after this many minutes; 0 is Never. */
  hideAgainMinutes: number;
  setHideAgainMinutes: (minutes: number) => void;
  /** One account's words, and its "Hide again after": its own, or every account's. */
  showWordsOf: (email: string) => number;
  hideAgainOf: (email: string) => number;
  /** Give one account its own; null sets every account's, and takes their own away. */
  setShowWordsFor: (email: string | null, count: number) => void;
  setHideAgainFor: (email: string | null, minutes: number) => void;
};

/**
 * Set a mailbox's hiding schedule from outside the tabs: the rhythm asked
 * for when a mailbox is connected (account-rhythm.ts). The page's clock
 * hides and shows it from here on, as for a schedule set in its menu.
 */
export function setMailboxHiddenHours(email: string, windows: MailQuietWindow[]): void {
  patchRow(email, (row) => ({ ...row, hours: windows.length ? windows : undefined, shownUntil: undefined }));
}

/** Words to type before a hidden mailbox can be shown early. 0 is none. */
export function readMailboxShowWords(): number {
  return read().showWords ?? 0;
}

/**
 * Set those words from outside the menu: the question asked when a mailbox
 * is connected. One number for every mailbox, as in the menu.
 */
export function setMailboxShowWords(count: number): void {
  const words = normaliseUnpauseWords(count);
  const { showWords: _old, ...rest } = read();
  write({ ...rest, accounts: withoutOwn(rest.accounts, "showWords"), ...(words ? { showWords: words } : null) });
}

/** "Hide again after" for one account, or (null) every account's, taking their own away. */
function setMailboxHideAgainFor(email: string | null, minutes: number): void {
  const value = normaliseHideAgainMinutes(minutes);
  if (email) {
    patchRow(email, (row) => ({ ...row, hideAgainMinutes: value }));
    return;
  }
  const { hideAgainMinutes: _old, ...rest } = read();
  // Never (0) is written: left out, it would be the 15-minute default.
  write({ ...rest, accounts: withoutOwn(rest.accounts, "hideAgainMinutes"), hideAgainMinutes: value });
}

/** Every account's row without its own value of `field`: they take every account's again. */
function withoutOwn(
  accounts: MailboxHideState["accounts"],
  field: "showWords" | "hideAgainMinutes"
): MailboxHideState["accounts"] {
  const out: MailboxHideState["accounts"] = {};
  for (const [key, row] of Object.entries(accounts)) {
    const { [field]: _own, ...rest } = row;
    if (Object.keys(rest).length) out[key] = rest;
  }
  return out;
}

export function useMailboxHide({
  visible,
  onVisibilityChange,
}: {
  /** The mailboxes Mail shows now. */
  visible: string[];
  /** The page's own list, told at once. */
  onVisibilityChange: (email: string, inMailTab: boolean) => void;
}): MailboxHideControls {
  const t = useMailT();
  const router = useMailRouter();
  const [state, setState] = React.useState<MailboxHideState>(() =>
    typeof window === "undefined" ? MAILBOX_HIDE_DEFAULT : read()
  );
  const [minute, setMinute] = React.useState(() => Date.now());
  const [hidden, setHidden] = React.useState<string[]>([]);

  React.useEffect(() => {
    const onChanged = () => setState(read());
    window.addEventListener(EVENT, onChanged);
    window.addEventListener("storage", onChanged);
    const tick = window.setInterval(() => setMinute(Date.now()), 30_000);
    return () => {
      window.removeEventListener(EVENT, onChanged);
      window.removeEventListener("storage", onChanged);
      window.clearInterval(tick);
    };
  }, []);

  // The hidden ones, read again whenever the shown ones change.
  const visibleKey = visible.map(hideKey).sort().join(",");
  React.useEffect(() => {
    let alive = true;
    void listHiddenMailboxes().then((list) => {
      if (alive) setHidden(list);
    });
    return () => {
      alive = false;
    };
  }, [visibleKey]);

  /** Flip the flag, tell the page and the host. */
  const flip = React.useCallback(
    async (email: string, inMailTab: boolean) => {
      onVisibilityChange(email, inMailTab);
      setHidden((list) =>
        inMailTab ? list.filter((e) => hideKey(e) !== hideKey(email)) : [...list.filter((e) => hideKey(e) !== hideKey(email)), email]
      );
      try {
        await setMailboxInMailTab(email, inMailTab);
        // Read again once it is saved: a read the page's change set off
        // could answer before the save landed, with the old answer.
        void listHiddenMailboxes().then(setHidden);
      } catch (err) {
        // Refused: the page goes back to what is true.
        onVisibilityChange(email, !inMailTab);
        void listHiddenMailboxes().then(setHidden);
        throw err;
      }
      router.refresh();
    },
    [onVisibilityChange, router]
  );

  // The clock: hide when a time or a window begins, show when it ends.
  const inFlight = React.useRef(new Set<string>());
  React.useEffect(() => {
    const now = new Date(minute);
    const hiddenSet = new Set(hidden.map(hideKey));
    const shownSet = new Set(visible.map(hideKey));
    const steps: { key: string; email: string; show: boolean }[] = [];
    const adopted: { email: string; row: MailboxHide }[] = [];
    for (const [key, row] of Object.entries(state.accounts)) {
      if (inFlight.current.has(key)) continue;
      if (!hiddenSet.has(key) && !shownSet.has(key)) continue; // not connected
      /*
        Hidden by hand before a hide by hand ended at the schedule, so
        nothing would ever show it: the schedule takes it over now.
      */
      const taken = strandedHandHide(row, shownSet.has(key), now);
      if (taken) {
        adopted.push({ email: [...visible, ...hidden].find((e) => hideKey(e) === key) ?? key, row: taken });
        continue;
      }
      const step = hideStep(row, shownSet.has(key), now);
      if (!step) continue;
      const email = [...visible, ...hidden].find((e) => hideKey(e) === key) ?? key;
      steps.push({ key, email, show: step === "show" });
    }
    if (!steps.length && !adopted.length) return;
    // After this render: the steps change the page's own state.
    const timer = window.setTimeout(() => {
      for (const { email, row } of adopted) {
        diagEvent("hide by hand handed to schedule", { mailbox: mailboxNumber(email), until: diagTime(row.byHandUntil ?? null) });
        patchRow(email, () => row);
      }
      for (const { key, email, show } of steps) {
        if (inFlight.current.has(key)) continue;
        inFlight.current.add(key);
        patchRow(email, (r) => ({ ...r, autoHidden: show ? undefined : true }));
        void flip(email, show)
          .catch(() => undefined)
          .finally(() => inFlight.current.delete(key));
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [state, minute, visible, hidden, flip]);

  /*
    The page's own list says what is shown, at once; the hidden list is read
    from the providers and can lag a moment behind it. A mailbox the page
    shows is not hidden, whatever a late answer said: "Show in Mail now" left
    the tab shown and its menu saying "Hidden until you show it".
  */
  const shownKeys = React.useMemo(() => new Set(visible.map(hideKey)), [visible]);
  const hiddenNow = React.useMemo(() => hidden.filter((e) => !shownKeys.has(hideKey(e))), [hidden, shownKeys]);
  const statusOf = React.useCallback(
    (email: string): MailboxHideStatus => {
      const verdict = mailboxHideVerdict(state.accounts[hideKey(email)], new Date(minute));
      const isHidden = hiddenNow.some((e) => hideKey(e) === hideKey(email));
      const row = state.accounts[hideKey(email)];
      return {
        ...verdict,
        hidden: isHidden,
        // By hand: no words to type to show it, with an end or without.
        byHand: isHidden && (!verdict.hidden || verdict.reason === "hand"),
        shownEarlyUntil: isHidden ? null : shownEarlyUntil(row, new Date(minute)),
      };
    },
    [state, minute, hiddenNow]
  );

  const showWords = state.showWords ?? 0;
  const hideAgainMinutes = state.hideAgainMinutes ?? DEFAULT_HIDE_AGAIN_MINUTES;

  return {
    hidden: hiddenNow,
    statusOf,
    hoursOf: (email) => state.accounts[hideKey(email)]?.hours ?? [],
    showWords,
    hideUntil: (email, until, from) => {
      diagEvent("hide set", { mailbox: mailboxNumber(email), until: diagTime(until), from: from ?? "unknown" });
      patchRow(email, (row) => ({ ...row, hiddenUntil: until, shownUntil: undefined }));
      toast.success(t("mailboxHiddenFor", { email }));
    },
    hideByHand: (email) => {
      // By hand: until it is shown, or with a schedule until the schedule next changes.
      const row = patchRow(email, (r) => handHideRow(r, new Date())).accounts[hideKey(email)];
      diagEvent("hide set", {
        mailbox: mailboxNumber(email),
        until: row?.byHandUntil ? diagTime(row.byHandUntil) : row?.autoHidden ? "schedule window end" : "shown by hand",
      });
      void flip(email, false)
        .then(() => toast.success(t("accountHiddenFromMailConnected", { email })))
        .catch((err: unknown) => toast.error(err instanceof Error ? err.message : t("couldNotUpdate")));
    },
    setHours: (email, windows) => {
      diagEvent("hidden hours set", { mailbox: mailboxNumber(email), hidden: diagHours(windows) });
      // A schedule set again is a schedule meant: a "show now" from before
      // no longer holds it off, and the clock hides it if a window is on.
      patchRow(email, (row) => {
        const next = { ...row, hours: windows.length ? windows : undefined, shownUntil: undefined };
        // Hidden by hand until the old schedule's next window: until the new one's.
        return row.byHandUntil ? handHideRow(next, new Date()) : next;
      });
    },
    resumeSchedule: (email) => {
      diagEvent("schedule resumed", { mailbox: mailboxNumber(email) });
      // The clock does the hiding: with shownUntil gone, the window hides it.
      patchRow(email, (row) => ({ ...row, shownUntil: undefined }));
      toast.success(t("mailboxHiddenFor", { email }));
    },
    showNow: (email) => {
      const key = hideKey(email);
      const row = state.accounts[key];
      const now = new Date();
      const verdict = mailboxHideVerdict(row, now);
      // Hidden by a time or the schedule. Hidden by hand is shown with no words and no end.
      const timed = verdict.hidden && verdict.reason !== "hand";
      /*
        Shown until its own time or window would have ended, or sooner
        with "Hide again after" set. A time kept with the hide-again cut
        stays, so the mailbox hides again when the cut runs out; with no
        cut it goes, as before.
      */
      const ownEnd =
        verdict.reason === "schedule"
          ? scheduleWindowEnd(row?.hours, now)
          : verdict.reason === "until"
            ? (row?.hiddenUntil ?? null)
            : null;
      // This account's own words and "Hide again after", or every account's.
      const words = showWordsFor(state, email);
      const againMinutes = hideAgainFor(state, email);
      const shownEnd = timed ? shownEarlyEnd(ownEnd, againMinutes, now) : null;
      /*
        The question names how long, when "Hide again after" is what ends
        it: "Show … for 15 minutes?" says that the mailbox goes again. A
        plain "again?" does not say that. When its own time or window
        ends first, that is when it goes, and the cut says nothing true.
      */
      const cutEndsIt = hideAgainEndsShow(ownEnd, againMinutes, now);
      void (async () => {
        // Early is only early against a time: a mailbox hidden by hand asks nothing.
        if (timed && words > 0) {
          const ok = await requestUnpauseChallenge(words, {
            title: cutEndsIt
              ? t("showMailboxForTitle", { email, time: hideAgainLabel(againMinutes, t) })
              : t("showMailboxTitle", { email }),
            lead: t("showMailboxLead"),
            confirm: t("showMailboxConfirm"),
          });
          if (!ok) return;
        }
        diagEvent("shown early", { mailbox: mailboxNumber(email), until: diagTime(shownEnd), words: timed && words > 0 });
        patchRow(email, (r) => ({
          ...r,
          hiddenUntil: verdict.reason === "until" && againMinutes > 0 ? r.hiddenUntil : undefined,
          autoHidden: undefined,
          byHandUntil: undefined,
          shownUntil: timed ? (shownEnd ?? undefined) : r.shownUntil,
        }));
        try {
          await flip(email, true);
          toast.success(t("accountShownInMail", { email }));
        } catch (err) {
          toast.error(err instanceof Error ? err.message : t("couldNotUpdate"));
        }
      })();
    },
    setShowWords: setMailboxShowWords,
    hideAgainMinutes,
    setHideAgainMinutes: (minutes) => setMailboxHideAgainFor(null, minutes),
    showWordsOf: (email) => showWordsFor(state, email),
    hideAgainOf: (email) => hideAgainFor(state, email),
    setShowWordsFor: (email, count) => {
      if (email) patchRow(email, (row) => ({ ...row, showWords: normaliseUnpauseWords(count) }));
      else setMailboxShowWords(count);
    },
    setHideAgainFor: setMailboxHideAgainFor,
  };
}

/**
 * How a mailbox is hidden, for a place that has no hide controls of its
 * own: Settings > Accounts. Read from the same stored state the tabs use,
 * and read again when it changes or a minute passes.
 */
export function useMailboxHideVerdict(email: string): MailboxHideVerdict & { hours: MailQuietWindow[] } {
  const [state, setState] = React.useState<MailboxHideState>(read);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const again = () => setState(read());
    window.addEventListener(EVENT, again);
    window.addEventListener("storage", again);
    const tick = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      window.removeEventListener(EVENT, again);
      window.removeEventListener("storage", again);
      window.clearInterval(tick);
    };
  }, []);
  const row = state.accounts[hideKey(email)];
  return { ...mailboxHideVerdict(row, new Date(now)), hours: row?.hours ?? [] };
}
