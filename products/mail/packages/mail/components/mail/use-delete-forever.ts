"use client";

/*
 * Delete forever, off MailPage: the question, and what happens after the
 * red button.
 *
 * Owns: which conversations the question is about (`purgeAsk`), asking it
 * (`askDeleteForever`, only in Trash and Junk), and `runPurge`: the rows go
 * at once, the providers are asked only when the Undo count has run out,
 * and whatever failed comes back.
 *
 * Does not own: the dialog, which the page draws, or the count, which is
 * `deleteForeverWithUndo` in undo-purge.tsx.
 *
 * No effects.
 */

import * as React from "react";
import { toast } from "@/lib/mail/toast";
import { invalidateCachedMailThread } from "@/lib/mail/thread-cache";
import { everyCopyOfEach, threadKey } from "@/lib/mail/thread-copies";
import { mailSay } from "@/lib/mail/i18n";
import type { MailThreadSummary } from "@/lib/mail/types";
import { mailApiJson as apiJson } from "@/lib/mail/api";
import { deleteForeverWithUndo, sayDeletedForever } from "@/components/mail/undo-purge";

type OpenThread = {
  account: string;
  threadId: string;
  inCrm: boolean;
  focusMessageId?: string;
};

export function useDeleteForever({
  inTrashView,
  inJunkView,
  threads,
  setThreads,
  threadsRef,
  setSelected,
  setSelectedPersonKey,
  removeThread,
  hideRemovedRows,
  unhideRows,
  clearMultiSelection,
  loadThreads,
}: {
  inTrashView: boolean;
  inJunkView: boolean;
  threads: MailThreadSummary[];
  setThreads: React.Dispatch<React.SetStateAction<MailThreadSummary[]>>;
  threadsRef: React.RefObject<MailThreadSummary[]>;
  setSelected: React.Dispatch<React.SetStateAction<OpenThread | null>>;
  setSelectedPersonKey: React.Dispatch<React.SetStateAction<string | null>>;
  removeThread: (key: string, alsoKeys?: string[]) => void;
  hideRemovedRows: (keys: string[]) => void;
  unhideRows: (keys: string[]) => void;
  clearMultiSelection: () => void;
  loadThreads: (options: { fresh: boolean }) => Promise<boolean>;
}) {
  /**
   * Mail deleted for good, from Trash or from Junk.
   *
   * This is the one action in the list that nothing can undo once it is
   * done, so it never runs from its button. The button sets `purgeAsk`, the
   * dialog asks, and only its red button calls `runPurge`. Even then the
   * provider is not told for a few seconds: a navy pill counts down with
   * Undo, as it does for Send. Undo there means "it was not done yet". See
   * `undo-purge.tsx`.
   *
   * It acts only on conversations that the reader has picked: the open one,
   * a row's own menu, or a selection of rows. There is no "empty the folder"
   * and there will not be one. A reader who wants Trash empty selects what
   * is in it, and so sees what goes.
   *
   * `purgeFrom` is the folder on screen when it is Trash or Junk, and null
   * everywhere else. No other view offers the action.
   */
  const purgeFrom: "trash" | "junk" | null = inTrashView ? "trash" : inJunkView ? "junk" : null;

  const [purgeAsk, setPurgeAsk] = React.useState<{
    from: "trash" | "junk";
    /** How many rows the reader picked. The question counts these. */
    count: number;
    /**
     * What goes: those rows and every copy folded into them. A mail that
     * arrived in two of the reader's mailboxes is one row in the list, and
     * can be one in Gmail and one in Outlook.
     */
    targets: { account: string; threadId: string }[];
  } | null>(null);

  /** Ask the question about these conversations. Null outside Trash and Junk. */
  const askDeleteForever = React.useMemo(
    () =>
      purgeFrom
        ? (rows: { account: string; threadId: string }[]) => {
            if (!rows.length) return;
            setPurgeAsk({
              from: purgeFrom,
              count: rows.length,
              // The list as it is now, read at the moment of asking.
              targets: everyCopyOfEach(rows, threadsRef.current),
            });
          }
        : undefined,
    [purgeFrom, threadsRef]
  );

  const runPurge = React.useCallback(() => {
    const ask = purgeAsk;
    if (!ask || !ask.targets.length) return;
    setPurgeAsk(null);
    const before = threads;
    const keys = ask.targets.map((t) => threadKey(t));
    // The rows go now. `hideRemovedRows` keeps them out of a list that is
    // read again during the count, while the mail is still on the server.
    for (const key of keys) removeThread(key);
    hideRemovedRows(keys);
    clearMultiSelection();
    setSelected(null);
    // The by-person page too: its conversations are the ones that just went.
    setSelectedPersonKey(null);

    const putBack = () => {
      unhideRows(keys);
      setThreads(before);
    };

    deleteForeverWithUndo({
      onUndo: putBack,
      onRun: async () => {
        for (const target of ask.targets) {
          invalidateCachedMailThread(target.account, target.threadId);
        }
        const results = await Promise.allSettled(
          ask.targets.map((target) =>
            apiJson("/api/mail/delete-forever", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...target, from: ask.from }),
            })
          )
        );
        const failed = results.filter((r) => r.status === "rejected");
        if (!failed.length) {
          sayDeletedForever();
          return;
        }
        // What failed is still on the server, so it is shown again. What
        // went is gone, and the list is read again to say so.
        unhideRows(keys);
        if (failed.length === ask.targets.length) {
          setThreads(before);
          const first = (failed[0] as PromiseRejectedResult).reason;
          toast.error(
            first instanceof Error ? first.message : mailSay("couldNotDeleteForever")
          );
          return;
        }
        toast.error(
          mailSay("someCouldNotBeDeletedForever", {
            failed: failed.length,
            count: ask.targets.length,
          })
        );
        void loadThreads({ fresh: true });
      },
    });
  }, [
    purgeAsk,
    threads,
    removeThread,
    hideRemovedRows,
    unhideRows,
    clearMultiSelection,
    loadThreads,
    setThreads,
    setSelected,
    setSelectedPersonKey,
  ]);

  /** The dialog's Cancel: nothing is deleted. */
  const cancelPurge = React.useCallback(() => setPurgeAsk(null), []);

  return { purgeFrom, purgeAsk, askDeleteForever, runPurge, cancelPurge };
}
