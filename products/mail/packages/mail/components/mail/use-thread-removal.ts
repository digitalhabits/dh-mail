"use client";

/*
 * Taking rows out of the list, off MailPage: the step every action that
 * removes a conversation shares.
 *
 * Owns: removing a row and landing on the next one (`removeThread`), keeping
 * a removed row hidden while older list reads come back
 * (`hideRemovedRows`, `unhideRows`), and the count of the folder on screen
 * (`noteLeftOpenFolder`).
 *
 * Does not own: the actions. Archive, delete, move, snooze and the rest
 * call these, and live in use-thread-actions and use-batch-actions.
 *
 * No effects.
 */

import * as React from "react";

import { bumpMailFolderCount } from "@/components/mail/MailFolders";
import type { MailViewMode } from "@/components/mail/MailListControls";
import {
  patchCachedThreads,
  type ActiveMailFolder,
} from "@/components/mail/mail-list-state";
import { hideRow, unhideRow, type HiddenRows } from "@/lib/mail/hidden-rows";
import { forgetThreadEverywhere } from "@/lib/mail/list-cache";
import { successorInEitherOrder } from "@/lib/mail/successor";
import { threadKey } from "@/lib/mail/thread-copies";
import type { MailThreadSummary } from "@/lib/mail/types";

/**
 * Keep an optimistically removed row from being resurrected.
 *
 * Longer than any list response that was already in flight when the row
 * was removed, and long enough for the provider's own listing to catch
 * up. The abort drops the response most likely to carry it back.
 */
export const REMOVED_ROW_HIDE_MS = 60_000;

type OpenThread = {
  account: string;
  threadId: string;
  inCrm: boolean;
  focusMessageId?: string;
};

export function useThreadRemoval({
  viewerId,
  listCacheKey,
  viewMode,
  selectedPersonKey,
  activeFolder,
  setThreads,
  setSelected,
  threadsRef,
  screenThreadOrderRef,
  hiddenRowsRef,
  listViewIdRef,
  loadAbortRef,
}: {
  viewerId: string;
  listCacheKey: string;
  viewMode: MailViewMode;
  selectedPersonKey: string | null;
  activeFolder: ActiveMailFolder | null;
  setThreads: React.Dispatch<React.SetStateAction<MailThreadSummary[]>>;
  setSelected: React.Dispatch<React.SetStateAction<OpenThread | null>>;
  threadsRef: React.RefObject<MailThreadSummary[]>;
  /** The threads as painted: pins band, then the list. */
  screenThreadOrderRef: React.RefObject<MailThreadSummary[]>;
  hiddenRowsRef: React.RefObject<HiddenRows>;
  listViewIdRef: React.RefObject<string>;
  loadAbortRef: React.RefObject<AbortController | null>;
}) {
  const removeThread = React.useCallback(
    /** `alsoKeys`: copies of the same mail in other mailboxes, gone with it. */
    (key: string, alsoKeys: string[] = []) => {
      /**
       * Where to go next, worked out before the row is gone.
       *
       * The painted order is the one to follow — pins band, then the visible
       * flow — because that is what the reader is looking at. But it is put
       * into a ref while the component renders, and this runs from an event,
       * so the two can disagree about what is on screen. When they do, the
       * plain thread order is a worse answer than the painted one and a much
       * better answer than none: dropping to the empty pane after a delete
       * reads as though something went wrong.
       */
      const painted = screenThreadOrderRef.current;
      /*
        Removed means the row that stands for any of the going copies —
        by its own key, or by a copy folded into it. Matching the one key
        alone missed the row whenever it was standing on its other copy,
        and the row then survived its own deletion: still on screen,
        inviting the second press that lands on a conversation the reader
        never chose.
      */
      const gone = new Set([key, ...alsoKeys]);
      const isRemoved = (t: MailThreadSummary) =>
        gone.has(threadKey(t)) ||
        (t.alsoIn?.some((c) => gone.has(threadKey(c))) ?? false);
      const successor = successorInEitherOrder(
        painted,
        threadsRef.current,
        isRemoved
      );
      if (
        !successor &&
        !painted.some(isRemoved) &&
        !threadsRef.current.some(isRemoved)
      ) {
        console.warn(
          `[mail] ${key} was not in the list it was removed from — nothing to open next`
        );
      }

      setThreads((current) => {
        const next = current.filter((t) => !isRemoved(t));
        patchCachedThreads(viewerId, listCacheKey, next);
        return next;
      });
      // The row is gone from this list. It is gone from the others too, and
      // those are cached in storage with no expiry — so a folder or a search
      // the reader comes back to later would paint it again.
      forgetThreadEverywhere(viewerId, isRemoved);
      setSelected((current) => {
        if (!current || !gone.has(threadKey(current))) return current;
        // With a person digest open, fall back to it — the successor thread
        // in list order could belong to someone else entirely.
        if (viewMode === "people" && selectedPersonKey) return null;
        return successor
          ? {
              account: successor.account,
              threadId: successor.threadId,
              inCrm: successor.tab === "people",
              focusMessageId: successor.focusMessageId,
            }
          : null;
      });
    },
    [
      listCacheKey,
      viewMode,
      selectedPersonKey,
      setThreads,
      threadsRef,
      viewerId,
      // A ref and a setter: stable, listed because a hook's input is not
      // known to be.
      screenThreadOrderRef,
      setSelected,
    ]
  );

  /**
   * A conversation left the folder we have open, so that folder holds one
   * fewer. Only for the folder on screen: leaving the inbox is not leaving a
   * folder, and the counts we keep are for named folders only.
   */
  const openFolderName = activeFolder?.name ?? null;

  const noteLeftOpenFolder = React.useCallback(
    (account: string) => {
      if (openFolderName) bumpMailFolderCount(account, openFolderName, -1);
    },
    [openFolderName]
  );


  const hideRemovedRows = React.useCallback((keys: string[]) => {
    const until = Date.now() + REMOVED_ROW_HIDE_MS;
    // In this view only: the row is shown in the view it went to. It was
    // hidden in every view, and a mail sent to Trash was not in Trash.
    for (const rowKey of keys) {
      hideRow(hiddenRowsRef.current, rowKey, listViewIdRef.current, until);
    }
    loadAbortRef.current?.abort();
  }, [hiddenRowsRef, listViewIdRef, loadAbortRef]);

  const unhideRows = React.useCallback((keys: string[]) => {
    for (const rowKey of keys) unhideRow(hiddenRowsRef.current, rowKey);
  }, [hiddenRowsRef]);

  return {
    removeThread,
    openFolderName,
    noteLeftOpenFolder,
    hideRemovedRows,
    unhideRows,
  };
}
