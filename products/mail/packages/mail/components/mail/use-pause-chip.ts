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
    resume: resumeMail,
    setQuietHours: setMailQuietHours,
    setFollowAllHours,
  } = useMailPause();
  const pauseChip = mailPauseChip(pauseState, accountEmails, pauseNow);
  const pauseChipUntil = pauseChip.until
    ? formatSnoozeWakeLabel(pauseChip.until.toISOString())
    : pauseChip.untilClock;
  const fetchingNow = fetchingAccounts(pauseState, accountEmails, pauseNow);
  const noneFetching =
    accountEmails.length > 0 && fetchingNow.length === 0;
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
    if (pause.paused && pause.reason === "pause") {
      resumeMail();
      return;
    }
    for (const email of accountEmails) {
      if (mailPauseVerdictForAccount(pauseState, email, pauseNow).paused) {
        resumeMail(email);
      }
    }
  }, [accountEmails, pause.paused, pause.reason, pauseNow, pauseState, resumeMail]);

  return {
    pauseState,
    pauseNow,
    pauseMailUntil,
    resumeMail,
    setMailQuietHours,
    setFollowAllHours,
    pauseChip,
    noneFetching,
    pausedLabel,
    quietUntilByAccount,
    resumeFetching,
  };
}
