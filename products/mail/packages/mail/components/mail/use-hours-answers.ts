"use client";

/**
 * What each schedule page of the account menu offers, and how its answer is
 * saved (account-hours-menu.tsx).
 *
 * - Shown in Mail, one account: the plain answers, then "Same as …" for the
 *   hours other accounts are shown. Saved as that account's hiding schedule.
 * - New mail arrives, one account: "Same as All accounts" first, then the
 *   plain answers and "Same as …". Same as All follows All's hours; any
 *   other answer gives the account hours of its own.
 * - The All tab: the plain answers, saved for every account.
 *
 * "Current" goes on the answer the hours are now, so the page opens on it.
 */

import * as React from "react";

import type { PauseControls } from "@/components/mail/account-hours-menu";
import { useOnHoursWords } from "@/components/mail/pause-panels";
import { answerFor, type HoursAnswer } from "@/components/mail/hours-question";
import { answerName, onRowsOf, sameAsAnswers, type ScheduleSave } from "@/components/mail/hours-schedule-page";
import type { MailboxHideControls } from "@/components/mail/use-mailbox-hide";
import { formatAccountChipLabel, type AccountChipLabel } from "@/lib/mail/account-labels";
import {
  FETCH_PRESET_ORDER,
  FETCH_PRESETS,
  onHoursSummary,
  sameWeek,
  SHOWN_PRESET_ORDER,
  SHOWN_PRESETS,
} from "@/lib/mail/account-rhythm";
import { SCHEDULE_DAY_LABELS } from "@/lib/mail/custom-lists";
import { useMailT, type MailStringKey } from "@/lib/mail/i18n";
import type { PauseLock } from "@/lib/mail/pause-lock";
import {
  accountFollowsAllHours,
  accountPauseRow,
  mailPauseVerdictForAccount,
  quietHoursForAccount,
  unpauseWordsFor,
  type MailQuietWindow,
} from "@/lib/mail/quiet-hours";

export type HoursTab = "shown" | "fetch";

export type SchedulePageSpec = {
  answers: HoursAnswer[];
  kept: MailQuietWindow[];
  current: string | null;
  shown?: MailQuietWindow[];
  lock?: PauseLock;
  save: (save: ScheduleSave) => void;
};

const SHOWN_WORDS: Record<string, { name: MailStringKey; what: MailStringKey }> = {
  always: { name: "rhythmAnswerAlways", what: "rhythmAnswerAlwaysWhat" },
  weekdays: { name: "rhythmAnswerWeekdays", what: "rhythmAnswerWeekdaysWhat" },
  work: { name: "rhythmAnswerWork", what: "rhythmAnswerWorkWhat" },
};
const FETCH_WORDS: Record<string, { name: MailStringKey; what: MailStringKey }> = {
  always: { name: "rhythmAnswerAlways", what: "rhythmAnswerAlwaysWhat" },
  twice: { name: "rhythmAnswerTwice", what: "rhythmAnswerTwiceWhat" },
  work: { name: "rhythmAnswerWork", what: "rhythmAnswerWorkWhat" },
};

/** The id of the answer that follows All's hours. */
export const FOLLOW_ALL = "all";

export function useHoursAnswers({
  accounts,
  labels,
  hide,
  pause,
}: {
  accounts: string[];
  labels: Map<string, AccountChipLabel>;
  hide: MailboxHideControls;
  pause: PauseControls;
}) {
  const t = useMailT();
  const words = useOnHoursWords();
  const say = React.useCallback(
    (kept: MailQuietWindow[]) =>
      onHoursSummary(kept, words, SCHEDULE_DAY_LABELS) ?? t("rhythmAnswerAlwaysWhat"),
    [t, words]
  );
  /** Words to type: one account's own, or every account's. */
  const fetchWords = (email: string) => unpauseWordsFor(pause.state, email);

  const presets = (tab: HoursTab): HoursAnswer[] =>
    tab === "shown"
      ? SHOWN_PRESET_ORDER.map((id) => ({ id, name: t(SHOWN_WORDS[id].name), what: t(SHOWN_WORDS[id].what), rows: SHOWN_PRESETS[id] }))
      : FETCH_PRESET_ORDER.map((id) => ({ id, name: t(FETCH_WORDS[id].name), what: t(FETCH_WORDS[id].what), rows: FETCH_PRESETS[id] }));

  /** Hours other accounts have of their own, as "Same as …" answers. */
  const others = (tab: HoursTab, email: string, taken: HoursAnswer[]) =>
    sameAsAnswers(
      accounts
        .filter((other) => other.toLowerCase() !== email.toLowerCase())
        .map((other) => ({
          email: other,
          name: formatAccountChipLabel(other, labels),
          kept: tab === "shown" ? hide.hoursOf(other) : (accountPauseRow(pause.state, other)?.quietHours ?? null),
        }))
        .filter((source): source is { email: string; name: string; kept: MailQuietWindow[] } => source.kept != null && source.kept.length > 0),
      taken,
      t,
      say
    );

  /** The answer some hours are, borrowed ones too, or null. */
  const currentOf = (answers: HoursAnswer[], kept: MailQuietWindow[]) => {
    const rows = onRowsOf(kept);
    return answerFor(answers, rows) ?? answers.find((answer) => sameWeek(answer.rows, rows))?.id ?? null;
  };

  const accountPage = (tab: HoursTab, email: string): SchedulePageSpec => {
    if (tab === "shown") {
      const base = presets("shown");
      const answers = [...base, ...others("shown", email, base)];
      const kept = hide.hoursOf(email);
      const status = hide.statusOf(email);
      return {
        answers,
        kept,
        current: currentOf(answers, kept),
        lock: status.hidden && !status.byHand && hide.showWordsOf(email) > 0 ? { words: hide.showWordsOf(email) } : undefined,
        save: ({ kept: next }) => hide.setHours(email, next),
      };
    }
    const all: HoursAnswer = {
      id: FOLLOW_ALL,
      name: t("hoursMenuSameAsAll"),
      what: say(pause.state.quietHours),
      rows: onRowsOf(pause.state.quietHours),
      borrowed: true,
    };
    const base = presets("fetch");
    const answers = [all, ...base, ...others("fetch", email, [all, ...base])];
    const kept = quietHoursForAccount(pause.state, email);
    const follows = accountFollowsAllHours(pause.state, email);
    return {
      answers,
      kept,
      current: follows ? FOLLOW_ALL : currentOf(answers.slice(1), kept),
      shown: onRowsOf(hide.hoursOf(email)),
      lock: mailPauseVerdictForAccount(pause.state, email, pause.now).paused && fetchWords(email) > 0 ? { words: fetchWords(email) } : undefined,
      save: ({ choice, kept: next }) => {
        if (choice === FOLLOW_ALL) pause.setFollowAllHours(email, true);
        else pause.setQuietHours(next, email);
      },
    };
  };

  const allPage = (tab: HoursTab): SchedulePageSpec => {
    const answers = presets(tab);
    if (tab === "shown") {
      // One week for all, when they share one; otherwise none is current.
      const first = accounts.length ? hide.hoursOf(accounts[0]) : [];
      const shared = accounts.every((email) => sameWeek(hide.hoursOf(email), first));
      // Locked while any account is hidden with words of its own to type:
      // the most of them is what a looser week for all asks for.
      const lockWords = Math.max(0, ...accounts.map((email) => {
        const status = hide.statusOf(email);
        return status.hidden && !status.byHand ? hide.showWordsOf(email) : 0;
      }));
      return {
        answers,
        kept: shared ? first : [],
        current: shared ? currentOf(answers, first) : null,
        lock: lockWords > 0 ? { words: lockWords } : undefined,
        save: ({ kept }) => accounts.forEach((email) => hide.setHours(email, kept)),
      };
    }
    const lockWords = Math.max(0, ...accounts.map((email) =>
      mailPauseVerdictForAccount(pause.state, email, pause.now).paused ? fetchWords(email) : 0
    ));
    return {
      answers,
      kept: pause.state.quietHours,
      current: currentOf(answers, pause.state.quietHours),
      lock: lockWords > 0 ? { words: lockWords } : undefined,
      save: ({ kept }) => {
        pause.setQuietHours(kept, null);
        for (const email of accounts) pause.setFollowAllHours(email, true);
      },
    };
  };

  return {
    page: (tab: HoursTab, account: string | null) => (account ? accountPage(tab, account) : allPage(tab)),
    /** The name of the answer an account's hours are now: "Working hours", "Same as All accounts". */
    currentName: (tab: HoursTab, account: string) => {
      const spec = accountPage(tab, account);
      return answerName(spec.answers, spec.current, t("rhythmAnswerCustom").replace(/…$/, ""));
    },
  };
}
