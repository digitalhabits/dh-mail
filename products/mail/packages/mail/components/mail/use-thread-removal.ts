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
import { successorInEitherOrder, successorInStack } from "@/lib/mail/successor";
import type { PersonRow } from "@/lib/mail/person-participants";
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
  inPeople: boolean;
  focusMessageId?: string;
};


/**
 * Sent with the thread keys whenever threads leave the inbox: archived,
 * deleted, moved, snoozed or filed as junk.
 */
export const MAIL_THREADS_GONE_EVENT = "dh-mail-threads-gone";

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
  personRowOrderRef,
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
  /** The stacks as painted, each with its threads in the order shown. */
  personRowOrderRef: React.RefObject<PersonRow[]>;
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
        by its own key, or by a copy folded into it. The one key alone
        misses the row when it stands on its other copy. The row then
        survives its own deletion. It stays on screen and invites a second
        press that lands on a conversation the reader did not choose.
      */
      const gone = new Set([key, ...alsoKeys]);
      // Said aloud, for a list kept apart from this one that names the
      // thread (the organization's triage list).
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(MAIL_THREADS_GONE_EVENT, { detail: [...gone] }));
      }
      const isRemoved = (t: MailThreadSummary) =>
        gone.has(threadKey(t)) ||
        (t.alsoIn?.some((c) => gone.has(threadKey(c))) ?? false);
      const successor = successorInEitherOrder(
        painted,
        threadsRef.current,
        isRemoved
      );
      // A thread opened from a stack: the next one is in the same stack.
      const inStack =
        viewMode === "people" && selectedPersonKey
          ? successorInStack(personRowOrderRef.current, selectedPersonKey, isRemoved)
          : undefined;
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
        // With a person or a stack open, the next thread is one of theirs.
        // When they have no other, fall back to their page — the successor
        // thread in list order could belong to someone else entirely.
        if (viewMode === "people" && selectedPersonKey) {
          return inStack
            ? {
                account: inStack.account,
                threadId: inStack.threadId,
                inPeople: inStack.tab === "people",
                focusMessageId: inStack.focusMessageId,
              }
            : null;
        }
        return successor
          ? {
              account: successor.account,
              threadId: successor.threadId,
              inPeople: successor.tab === "people",
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
      personRowOrderRef,
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
    // In this view only: the row is shown in the view it went to. If it is
    // hidden in every view, a mail sent to Trash is not in Trash.
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
