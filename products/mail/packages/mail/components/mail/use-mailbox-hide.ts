"use client";

/**
 * Hiding mailboxes for a while, on the page: the state (on this machine, as
 * the pause is), the clock that hides and shows them when a time or a
 * schedule window begins and ends, the list of the hidden ones for the tabs,
 * and what the tabs' menus do. The rules are lib/mail/mailbox-hide.
 */

import * as React from "react";

import { requestUnpauseChallenge } from "@/components/mail/UnpauseChallenge";
import { useMailT } from "@/lib/mail/i18n";
import {
  hideKey,
  hideStep,
  mailboxHideVerdict,
  MAILBOX_HIDE_DEFAULT,
  readHideState,
  scheduleWindowEnd,
  shownEarlyUntil,
  type MailboxHide,
  type MailboxHideState,
  type MailboxHideVerdict,
} from "@/lib/mail/mailbox-hide";
import { listHiddenMailboxes, setMailboxInMailTab } from "@/lib/mail/mailbox-visibility";
import type { MailQuietWindow } from "@/lib/mail/quiet-hours";
import { toast } from "@/lib/mail/toast";
import { normaliseUnpauseWords } from "@/lib/mail/unpause-friction";
import { useMailRouter } from "@/lib/mail-router";

const KEY = "redd-plan-mail-hide";
export const MAILBOX_HIDE_KEY = KEY;
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
  hideUntil: (email: string, until: number) => void;
  hideByHand: (email: string) => void;
  setHours: (email: string, windows: MailQuietWindow[]) => void;
  showNow: (email: string) => void;
  /** Shown early inside a schedule window: let the schedule hide it again. */
  resumeSchedule: (email: string) => void;
  setShowWords: (count: number) => void;
};

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
    for (const [key, row] of Object.entries(state.accounts)) {
      if (inFlight.current.has(key)) continue;
      if (!hiddenSet.has(key) && !shownSet.has(key)) continue; // not connected
      const step = hideStep(row, shownSet.has(key), now);
      if (!step) continue;
      const email = [...visible, ...hidden].find((e) => hideKey(e) === key) ?? key;
      steps.push({ key, email, show: step === "show" });
    }
    if (!steps.length) return;
    // After this render: the steps change the page's own state.
    const timer = window.setTimeout(() => {
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
        byHand: isHidden && !verdict.hidden,
        shownEarlyUntil: isHidden ? null : shownEarlyUntil(row, new Date(minute)),
      };
    },
    [state, minute, hiddenNow]
  );

  const showWords = state.showWords ?? 0;

  return {
    hidden: hiddenNow,
    statusOf,
    hoursOf: (email) => state.accounts[hideKey(email)]?.hours ?? [],
    showWords,
    hideUntil: (email, until) => {
      patchRow(email, (row) => ({ ...row, hiddenUntil: until, shownUntil: undefined }));
      toast.success(t("mailboxHiddenFor", { email }));
    },
    hideByHand: (email) => {
      // By hand: no clock shows it again.
      patchRow(email, (row) => ({ ...row, hiddenUntil: undefined, autoHidden: undefined }));
      void flip(email, false)
        .then(() => toast.success(t("accountHiddenFromMailConnected", { email })))
        .catch((err: unknown) => toast.error(err instanceof Error ? err.message : t("couldNotUpdate")));
    },
    setHours: (email, windows) => {
      // A schedule set again is a schedule meant: a "show now" from before
      // no longer holds it off, and the clock hides it if a window is on.
      patchRow(email, (row) => ({ ...row, hours: windows.length ? windows : undefined, shownUntil: undefined }));
    },
    resumeSchedule: (email) => {
      // The clock does the hiding: with shownUntil gone, the window hides it.
      patchRow(email, (row) => ({ ...row, shownUntil: undefined }));
      toast.success(t("mailboxHiddenFor", { email }));
    },
    showNow: (email) => {
      const key = hideKey(email);
      const row = state.accounts[key];
      const now = new Date();
      const verdict = mailboxHideVerdict(row, now);
      void (async () => {
        // Early is only early against a time: a mailbox hidden by hand asks nothing.
        if (verdict.hidden && showWords > 0) {
          const ok = await requestUnpauseChallenge(showWords, {
            title: t("showMailboxTitle", { email }),
            lead: t("showMailboxLead"),
            confirm: t("showMailboxConfirm"),
          });
          if (!ok) return;
        }
        patchRow(email, (r) => ({
          ...r,
          hiddenUntil: undefined,
          autoHidden: undefined,
          shownUntil: verdict.reason === "schedule" ? (scheduleWindowEnd(r.hours, now) ?? undefined) : r.shownUntil,
        }));
        try {
          await flip(email, true);
          toast.success(t("accountShownInMail", { email }));
        } catch (err) {
          toast.error(err instanceof Error ? err.message : t("couldNotUpdate"));
        }
      })();
    },
    setShowWords: (count) => {
      const state2 = read();
      const words = normaliseUnpauseWords(count);
      const next: MailboxHideState = { accounts: state2.accounts, ...(words ? { showWords: words } : null) };
      write(next);
    },
  };
}

/**
 * How a mailbox is hidden, for a place that has no hide controls of its
 * own: Settings > Accounts. Read from the same stored state the tabs use,
 * and read again when it changes or a minute passes.
 */
export function useMailboxHideVerdict(email: string): MailboxHideVerdict {
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
  return mailboxHideVerdict(state.accounts[hideKey(email)], new Date(now));
}
