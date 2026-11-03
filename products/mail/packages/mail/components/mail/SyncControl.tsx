"use client";

import * as React from "react";
import { Pause } from "lucide-react";

/**
 * Sync: one button that syncs.
 *
 * Pausing is on the account tabs: the menu of an account's tab, or
 * of All, sets when it is shown and when new mail comes in
 * (account-hours-menu.tsx). While anything is paused, Sync says how much:
 * "Sync · 2 paused" while some mailboxes still fetch; with all of them
 * paused, the pause mark and when they come back ("All paused · next at
 * 18:00", "Paused · until Mon 08:00"). So a quiet inbox is not taken for a
 * broken one. Not an amber dot: a pause is chosen, and amber read as a
 * warning (2026-11-02).
 */

import { SyncIcon } from "@/components/mail/MailListControls";
import { usePageLayout, usePageSync } from "@/components/mail/mail-page-slices";
import { useMailT } from "@/lib/mail/i18n";
import { beginNativeWindowDragOnMove } from "@/lib/native-shell";
import { cn } from "@/lib/utils";

export const SyncControl = React.memo(function SyncControl() {
  const { noneFetching, pausedCount, pausedLabel, refreshing, syncNow, syncTurn } = usePageSync();
  const { chromeDark } = usePageLayout();
  const t = useMailT();
  const title = noneFetching
    ? pausedLabel
    : pausedCount > 0
      ? `${t("syncInbox")} · ${t("mailboxesPaused", { count: pausedCount })}`
      : t("syncInbox");
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onPointerDown={beginNativeWindowDragOnMove}
      onClick={syncNow}
      className={cn(
        "relative flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium",
        chromeDark
          ? "text-[var(--mail-chrome-muted)] hover:bg-[var(--mail-chrome-hover)] hover:text-[var(--mail-chrome-fg)]"
          : "text-stone-500 hover:bg-[var(--mail-sidebar-hover)] hover:text-stone-800"
      )}
    >
      {noneFetching && !(refreshing || syncTurn) ? (
        <Pause aria-hidden data-sync-paused="" className="h-3.5 w-3.5" />
      ) : (
        <SyncIcon className="h-3.5 w-3.5" spinning={refreshing || syncTurn} />
      )}
      <span className="mail-tb-label">
        {noneFetching
          ? pausedLabel
          : pausedCount > 0
            ? `${t("sync")} · ${t("syncPausedCount", { count: pausedCount })}`
            : t("sync")}
      </span>
    </button>
  );
});
