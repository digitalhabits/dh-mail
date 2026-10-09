"use client";

/**
 * Sync, with pausing beside it (2026-09-29).
 *
 * Syncing and pausing are both about getting mail, so the pause menu opens
 * from Sync. Both act on every mailbox, as search does, so they sit in the
 * title bar left of the search field, at its height, as an icon and the
 * word (2026-09-29):
 *
 * - Nothing paused: Sync, and a ▾ beside it that opens the pause menu.
 * - Some mailboxes paused: Sync checks the others (a pause is not undone by
 *   a quick click), and an amber "⏸ 2 ▾" beside it opens the menu.
 * - All paused: the whole button is the paused state, "⏸ All ▾" (until
 *   when is in its tooltip), and opens the menu, which starts with what is
 *   paused and a Resume for each.
 */

import { ChevronDown, Pause } from "lucide-react";

import { MailPauseMenu } from "@/components/mail/MailPauseMenu";
import { SyncIcon } from "@/components/mail/MailListControls";
import type { MailPageModel } from "@/components/mail/use-mail-page";
import { beginNativeWindowDragOnMove } from "@/lib/native-shell";
import { cn } from "@/lib/utils";

const AMBER = "border border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100";

export function SyncControl({ m }: { m: MailPageModel }) {
  const { chromeDark, noneFetching, pausedCount, pausedLabel, refreshing, syncNow, syncTurn, t } = m;
  const quiet = chromeDark
    ? "text-[var(--mail-chrome-muted)] hover:bg-[var(--mail-chrome-hover)] hover:text-[var(--mail-chrome-fg)]"
    : "text-stone-500 hover:bg-stone-200/70 hover:text-stone-800";

  if (noneFetching) {
    return (
      <PauseMenu
        m={m}
        trigger={
          <button
            type="button"
            title={pausedLabel}
            aria-label={pausedLabel}
            onPointerDown={beginNativeWindowDragOnMove}
            className={cn("flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-semibold", AMBER)}
          >
            <Pause className="h-3 w-3" aria-hidden />
            {/* Short: the time is in the tooltip and at the top of the menu. */}
            {t("tabAll")}
            <ChevronDown className="h-3 w-3 opacity-70" aria-hidden />
          </button>
        }
      />
    );
  }

  return (
    /* With the pause menu open, the whole pill is lit, not the arrow alone:
       the arrow's half ended in a hard edge against Sync, and the menu is
       about syncing as much as the arrow is. */
    <span
      className={cn(
        "flex shrink-0 items-center rounded-full",
        chromeDark
          ? "has-[[data-state=open]]:bg-[var(--mail-chrome-hover)]"
          : "has-[[data-state=open]]:bg-stone-200/70"
      )}
    >
      <button
        type="button"
        title={t("syncInbox")}
        aria-label={t("syncInbox")}
        onPointerDown={beginNativeWindowDragOnMove}
        onClick={syncNow}
        className={cn("flex h-7 items-center gap-1.5 rounded-l-full pl-2.5 pr-1.5 text-xs font-medium", quiet)}
      >
        <SyncIcon className="h-3.5 w-3.5" spinning={refreshing || syncTurn} />
        {t("sync")}
      </button>
      <PauseMenu
        m={m}
        trigger={
          pausedCount > 0 ? (
            <button
              type="button"
              title={t("mailboxesPaused", { count: pausedCount })}
              aria-label={t("mailboxesPaused", { count: pausedCount })}
              className={cn("ml-0.5 flex h-7 items-center gap-1 rounded-full px-2 text-xs font-semibold", AMBER)}
            >
              <Pause className="h-3 w-3" aria-hidden />
              {pausedCount}
              <ChevronDown className="h-3 w-3 opacity-70" aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              title={t("pauseReceivingMail")}
              aria-label={t("pauseReceivingMail")}
              /* No rule between the two: the chevron reads as part of
                 Sync, a step nearer the word. It goes down a pixel to sit
                 on the word's middle: "Sync" is mostly lower case with a
                 descender, so its ink centres about a pixel below the
                 line box the chevron is centred in (measured in WebKit). */
              className={cn("flex h-7 items-center rounded-r-full pl-0 pr-1.5", quiet)}
            >
              <ChevronDown className="h-3.5 w-3.5 translate-y-px" aria-hidden />
            </button>
          )
        }
      />
    </span>
  );
}

function PauseMenu({ m, trigger }: { m: MailPageModel; trigger: React.ReactElement }) {
  return (
    <MailPauseMenu
      state={m.pauseState}
      now={m.pauseNow}
      accounts={m.accountEmails}
      labels={m.accountLabels}
      isOutlookAccount={m.isOutlookAccount}
      onPause={m.pauseMailUntil}
      onResume={m.resumeMail}
      onQuietHoursChange={m.setMailQuietHours}
      onFollowAllHours={m.setFollowAllHours}
      onUnpauseWordsChange={m.setUnpauseWords}
      trigger={trigger}
    />
  );
}
