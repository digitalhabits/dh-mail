"use client";

/*
 * The sync concern of the mail page: Sync now, the turn of its icon, the
 * background read, and whether any mailbox is paused.
 *
 * Two hooks, because the parts are made at different points of
 * useMailPage:
 *
 * - `useMailSync` is useSyncNow (the button's own logic), where useMailPage
 *   always called it.
 * - `useSyncSlice` makes one memoised object for the components that show
 *   or press Sync, after the mailboxes' sync states are read.
 *
 * Components read the slice with `usePageSync` (mail-page-slices.tsx).
 */

import { useMemoObject } from "@/components/mail/use-memo-object";
import { useSyncNow } from "@/components/mail/use-sync-now";
import type { usePauseChip } from "@/components/mail/use-pause-chip";
import type { useThreadListData } from "@/components/mail/use-thread-list-data";
import { firstReadLines, pausedAfterFirstRead } from "@/lib/mail/first-read";
import * as React from "react";
import { useMailSyncStates } from "@/lib/mail/use-sync-states";
import type { useReaderState } from "@/components/mail/use-mail-reader";
import type { useListData } from "@/components/mail/use-mail-list";
import type { usePausing } from "@/components/mail/use-mail-accounts";
import type { MailPageProps } from "@/components/mail/use-mail-page";

type ListData = ReturnType<typeof useThreadListData>;
type PauseChip = ReturnType<typeof usePauseChip>;

export function useMailSync({
  selected,
  loadThreads,
  threadsRef,
}: {
  selected: { account: string; threadId: string } | null;
  loadThreads: ListData["loadThreads"];
  threadsRef: ListData["threadsRef"];
}) {
  return useSyncNow({ selected, loadThreads, threadsRef });
}

export function useSyncSlice({
  button,
  loadThreads,
  refreshing,
  pause,
  firstReads,
  syncPaused,
  readSoFar,
}: {
  button: ReturnType<typeof useMailSync>;
  loadThreads: ListData["loadThreads"];
  /** A read in the background over rows already on screen. */
  refreshing: boolean;
  pause: PauseChip;
  /** Each mailbox's first read, while it runs (lib/mail/first-read). */
  firstReads: ReturnType<typeof firstReadLines>;
  /** Mailboxes whose first read is paused. */
  syncPaused: ReturnType<typeof pausedAfterFirstRead>;
  /** Messages in hand while a mailbox's first read runs; 0 when none is. */
  readSoFar: number;
}) {
  const { syncTurn, syncNow } = button;
  const { noneFetching, pausedCount, pausedLabel, resumeFetching } = pause;
  return useMemoObject({
    syncNow,
    syncTurn,
    refreshing,
    /** Read the list again. The settings menu asks after an account changes. */
    loadThreads,
    noneFetching,
    pausedCount,
    pausedLabel,
    resumeFetching,
    firstReads,
    syncPaused,
    readSoFar,
  });
}

export type MailSyncSlice = ReturnType<typeof useSyncSlice>;

export function useSyncPress({
  loadThreads,
  selected,
  threadsRef,
}: Pick<ReturnType<typeof useReaderState>, "selected"> &
  Pick<ReturnType<typeof useListData>, "loadThreads" | "threadsRef">) {
  const syncButton = useMailSync({
    selected,
    loadThreads,
    threadsRef,
  });
  return { syncButton };
}

export function useFirstReadState({
  accounts,
}: Pick<MailPageProps, "accounts">) {
  const syncStates = useMailSyncStates();
  // A removed mailbox can leave a row behind; only the list's mailboxes count.
  const firstReads = React.useMemo(() => firstReadLines(syncStates, accounts), [syncStates, accounts]);
  const syncPaused = React.useMemo(() => pausedAfterFirstRead(syncStates, accounts), [syncStates, accounts]);
  /** Messages in hand while a mailbox's first read runs; 0 when none is. */
  const readSoFar = React.useMemo(
    () =>
      // Only while it runs: a paused mailbox is searched at its provider, whole.
      firstReads
        .filter((line) => line.folder === "" && line.state === "reading")
        .reduce((n, line) => n + line.done, 0),
    [firstReads]
  );
  return { firstReads, readSoFar, syncPaused };
}

export function usePageSyncSlice({
  firstReads,
  loadThreads,
  pause,
  readSoFar,
  refreshing,
  syncButton,
  syncPaused,
}: Pick<ReturnType<typeof usePausing>, "pause"> &
  Pick<ReturnType<typeof useListData>, "loadThreads" | "refreshing"> &
  Pick<ReturnType<typeof useSyncPress>, "syncButton"> &
  Pick<ReturnType<typeof useFirstReadState>, "firstReads" | "readSoFar" | "syncPaused">) {
  const sync = useSyncSlice({
    button: syncButton,
    loadThreads,
    refreshing,
    pause,
    firstReads,
    syncPaused,
    readSoFar,
  });
  return sync;
}
