"use client";

import * as React from "react";

/**
 * Sync: one button that syncs.
 *
 * Pausing is on the account tabs: the menu of an account's tab, or
 * of All, sets when it is shown and when new mail comes in
 * (account-hours-menu.tsx). Sync keeps a small amber dot while anything is
 * paused, and says what in its hover, so a quiet inbox is not taken for a
 * broken one.
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
  const paused = noneFetching || pausedCount > 0;
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
          : "text-stone-500 hover:bg-stone-200/70 hover:text-stone-800"
      )}
    >
      <SyncIcon className="h-3.5 w-3.5" spinning={refreshing || syncTurn} />
      {t("sync")}
      {paused ? (
        <span aria-hidden className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-500" />
      ) : null}
    </button>
  );
});
