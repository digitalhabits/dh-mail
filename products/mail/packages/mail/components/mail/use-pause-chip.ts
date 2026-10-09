"use client";

/*
 * Asleep or awake, as the page shows it, off useMailPage: the chip beside
 * the search field and its words, which mailboxes are fetching, the quiet
 * times per mailbox, and resuming.
 *
 * Owns: what is derived from the pause state. The state itself is
 * use-mail-pause (useMailPause), called here first.
 *
 * useMailPause's effects run where they always ran: useMailPage calls
 * this hook where it called useMailPause. No effects of its own.
 */

import * as React from "react";
import { formatSnoozeWakeLabel } from "@/components/mail/SnoozeMenu";
import { accountChipLabels, formatAccountChipLabel } from "@/lib/mail/account-labels";
import { useMailPause } from "@/components/mail/use-mail-pause";
import { requestUnpauseChallenge } from "@/components/mail/UnpauseChallenge";
import { fetchingAccounts, mailPauseChip, mailPauseVerdictForAccount } from "@/lib/mail/quiet-hours";
import { useMailT } from "@/lib/mail/i18n";

export function usePauseChip({
  accountEmails,
  accountLabels,
  t,
}: {
  accountEmails: string[];
  accountLabels: ReturnType<typeof accountChipLabels>;
  t: ReturnType<typeof useMailT>;
}) {
  /**
   * Asleep or awake — see use-mail-sleep, and the switch beside the search
   * field. Read here because this is where the fetching is decided.
   */
  const {
    state: pauseState,
    verdict: pause,
    now: pauseNow,
    pauseUntil: pauseMailUntil,
    resume: resumeNow,
    setQuietHours: setMailQuietHours,
    setFollowAllHours,
    setUnpauseWords,
  } = useMailPause();
  /** Words to type before ending a pause early. 0: none. */
  const unpauseWords = pauseState.unpauseWords ?? 0;
  /*
    Every way of ending a pause early asks for the words first: the menu,
    the "Start fetching again now" button, the sync control. Asked once per
    press, however many mailboxes it wakes.
  */
  const resumeMail = React.useCallback(
    (account?: string | null) => {
      void (async () => {
        if (!(await requestUnpauseChallenge(unpauseWords))) return;
        resumeNow(account);
      })();
    },
    [resumeNow, unpauseWords]
  );
  const pauseChip = mailPauseChip(pauseState, accountEmails, pauseNow);
  const pauseChipUntil = pauseChip.until
    ? formatSnoozeWakeLabel(pauseChip.until.toISOString())
    : pauseChip.untilClock;
  const fetchingNow = fetchingAccounts(pauseState, accountEmails, pauseNow);
  const noneFetching =
    accountEmails.length > 0 && fetchingNow.length === 0;
  /** How many mailboxes are paused now, by a pause or by quiet hours. */
  const pausedCount = accountEmails.length - fetchingNow.length;
  /** "Quiet until 12:00", or "team quiet until Mon" for one mailbox. */
  const pausedLabel = pauseChip.paused
    ? pauseChipUntil
      ? pauseChip.account
        ? t("mailPausedAccountUntil", {
            account: formatAccountChipLabel(pauseChip.account, accountLabels),
            time: pauseChipUntil,
          })
        : t("mailPausedUntil", { time: pauseChipUntil })
      : t("mailNotFetching")
    : "";
  const quietUntilByAccount = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const email of accountEmails) {
      const local = mailPauseVerdictForAccount(pauseState, email, pauseNow);
      if (!local.paused) continue;
      const time = local.until
        ? formatSnoozeWakeLabel(local.until.toISOString())
        : local.untilClock;
      if (!time) continue;
      map.set(
        email.trim().toLowerCase(),
        t("quietUntilTooltip", { time })
      );
    }
    return map;
  }, [accountEmails, pauseNow, pauseState, t]);
  const resumeFetching = React.useCallback(() => {
    void (async () => {
      if (!(await requestUnpauseChallenge(unpauseWords))) return;
      if (pause.paused && pause.reason === "pause") {
        resumeNow();
        return;
      }
      for (const email of accountEmails) {
        if (mailPauseVerdictForAccount(pauseState, email, pauseNow).paused) {
          resumeNow(email);
        }
      }
    })();
  }, [accountEmails, pause.paused, pause.reason, pauseNow, pauseState, resumeNow, unpauseWords]);

  return {
    pauseState,
    pauseNow,
    pauseMailUntil,
    resumeMail,
    setMailQuietHours,
    setFollowAllHours,
    unpauseWords,
    setUnpauseWords,
    pauseChip,
    noneFetching,
    pausedCount,
    pausedLabel,
    quietUntilByAccount,
    resumeFetching,
  };
}
