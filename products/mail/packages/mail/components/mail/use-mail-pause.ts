"use client";

import * as React from "react";

import {
  MAIL_PAUSE_DEFAULT,
  mailPauseVerdict,
  pauseAccountKey,
  readPauseState,
  type MailAccountPause,
  type MailPauseState,
  type MailPauseVerdict,
  type MailQuietWindow,
} from "@/lib/mail/quiet-hours";

/**
 * Whether this mailbox is fetching, and the switch that says otherwise.
 *
 * Kept on the machine rather than with the mailbox: it is about the reader's
 * morning, not about their account, and a mailbox open on a second computer
 * is a second reader's morning to decide.
 *
 * The clock is watched as well as the switch — a window that ends at noon
 * has to start fetching at noon without anybody pressing anything, and a
 * verdict computed once at render would be the answer to a question asked
 * an hour ago.
 *
 * All is the default scope. A mailbox can hold a pause of its own, and
 * hours of its own, on top of that.
 */
const KEY = "redd-plan-mail-pause";
export const MAIL_PAUSE_EVENT = "redd-plan-mail-pause-changed";

function read(): MailPauseState {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? readPauseState(JSON.parse(raw)) : MAIL_PAUSE_DEFAULT;
  } catch {
    return MAIL_PAUSE_DEFAULT;
  }
}

function write(state: MailPauseState): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode — the switch then lasts as long as the window does */
  }
  window.dispatchEvent(new Event(MAIL_PAUSE_EVENT));
}

function withAccountRow(
  state: MailPauseState,
  email: string,
  patch: (row: MailAccountPause) => MailAccountPause | undefined
): MailPauseState {
  const key = pauseAccountKey(email);
  const current = state.accounts?.[key] ?? {};
  const nextRow = patch(current);
  const accounts = { ...state.accounts };
  if (!nextRow || (!nextRow.pausedUntil && nextRow.quietHours == null)) {
    delete accounts[key];
  } else {
    accounts[key] = nextRow;
  }
  const next: MailPauseState = { ...state };
  if (Object.keys(accounts).length) next.accounts = accounts;
  else delete next.accounts;
  return next;
}

export function useMailPause(): {
  state: MailPauseState;
  verdict: MailPauseVerdict;
  now: Date;
  /**
   * Pause until this moment. No address is All. An address is that mailbox.
   */
  pauseUntil: (until: number, account?: string | null) => void;
  /** Clear the pause on All, or on one mailbox. Hours stay. */
  resume: (account?: string | null) => void;
  setQuietHours: (windows: MailQuietWindow[], account?: string | null) => void;
  /** True: this mailbox uses All's hours again. */
  setFollowAllHours: (account: string, follow: boolean) => void;
} {
  const [state, setState] = React.useState<MailPauseState>(MAIL_PAUSE_DEFAULT);
  // The clock, as a minute that changes. Rendering on it is what makes a
  // window that ends at noon end at noon.
  const [minute, setMinute] = React.useState(() => Date.now());

  React.useEffect(() => {
    setState(read());
    const onChanged = () => setState(read());
    window.addEventListener(MAIL_PAUSE_EVENT, onChanged);
    // Another window of the same app: the switch is one mailbox's, not one
    // window's.
    window.addEventListener("storage", onChanged);
    const tick = window.setInterval(() => setMinute(Date.now()), 30_000);
    return () => {
      window.removeEventListener(MAIL_PAUSE_EVENT, onChanged);
      window.removeEventListener("storage", onChanged);
      window.clearInterval(tick);
    };
  }, []);

  const now = React.useMemo(() => new Date(minute), [minute]);
  const verdict = React.useMemo(
    () => mailPauseVerdict(state, now),
    [state, now]
  );

  return {
    state,
    verdict,
    now,
    pauseUntil: (until, account) => {
      if (!account) {
        const next = { ...read(), pausedUntil: until };
        write(next);
        setState(next);
        return;
      }
      const next = withAccountRow(read(), account, (row) => ({
        ...row,
        pausedUntil: until,
      }));
      write(next);
      setState(next);
    },
    /*
      Resuming clears the pause, and only the pause. Quiet hours are a
      standing arrangement — ending this morning's mute must not cancel
      every night from here on.
    */
    resume: (account) => {
      if (!account) {
        const { pausedUntil, ...rest } = read();
        void pausedUntil;
        write(rest);
        setState(rest);
        return;
      }
      const next = withAccountRow(read(), account, (row) => {
        const { pausedUntil, ...rest } = row;
        void pausedUntil;
        return rest;
      });
      write(next);
      setState(next);
    },
    setQuietHours: (windows, account) => {
      if (!account) {
        const next = { ...read(), quietHours: windows };
        write(next);
        setState(next);
        return;
      }
      const next = withAccountRow(read(), account, (row) => ({
        ...row,
        quietHours: windows,
      }));
      write(next);
      setState(next);
    },
    setFollowAllHours: (account, follow) => {
      const next = withAccountRow(read(), account, (row) => {
        if (follow) {
          const { quietHours, ...rest } = row;
          void quietHours;
          return rest;
        }
        return { ...row, quietHours: row.quietHours ?? [] };
      });
      write(next);
      setState(next);
    },
  };
}
