"use client";

/*
 * The undo of list actions, off MailPage: the stack behind Command+Z, the
 * Undo button on each toast, and how each kind of action is taken back.
 *
 * Owns: the stack, the toast that offers Undo, and the requests that take an
 * action back (unarchive, untrash, unmove, unsnooze), with the row put back
 * in the list. The stack itself is `lib/mail/mail-undo-stack.ts`, which is
 * pure and has its own suite.
 *
 * Does not own: the actions themselves. Archive, delete, move and snooze stay
 * where they are. Each one calls `pushMailUndo` or `pushBatchUndo` when the
 * row leaves the list, and `dropMailUndo` if its request fails.
 *
 * There are two kinds of entry. A thread entry names its kind, and this file
 * knows how to take it back. A batch entry carries its own `run`, because
 * only the caller knows what many threads at once came from.
 *
 * The page reads `hasMailUndo()` in its key handler, so that Command+Z falls
 * through to the browser when there is nothing here to take back.
 *
 * No effects. The hook can stand anywhere after the list data it reads.
 * New kinds of undo go in this file, not in MailPage.
 */

import * as React from "react";

import { toast } from "@/lib/mail/toast";
import { mailSay } from "@/lib/mail/i18n";
import { mailApiJson as apiJson } from "@/lib/mail/api";
import { everyCopy, threadKey } from "@/lib/mail/thread-copies";
import { unhideRow, type HiddenRows } from "@/lib/mail/hidden-rows";
import { pinMailThread } from "@/lib/mail/pins";
import { createMailUndoStack } from "@/lib/mail/mail-undo-stack";
import type { MailThreadSummary } from "@/lib/mail/types";
import { bumpMailFolderCount } from "@/components/mail/MailFolders";
import { patchCachedThreads } from "@/components/mail/mail-list-state";

/**
 * An action on many conversations at once: a person's mail, or a
 * selection. It knows how to take itself back, so the stack only has to
 * keep it and run it.
 */
type MailBatchUndoEntry = {
  id: string;
  kind: "batch";
  toastId: string | number;
  run: () => Promise<void>;
};

type MailThreadUndoEntry = {
  id: string;
  kind: "trash" | "archive" | "move" | "snooze";
  summary: MailThreadSummary;
  toastId: string | number;
  folderName?: string;
  /** The open folder this left, if it left one. Undo puts the count back. */
  leftFolderName?: string | null;
  /**
   * The request this takes back, while it is still on its way. The entry
   * goes on the stack when the row leaves the list, not when the provider
   * answers: Gmail can take a second, and a Command+Z inside that second
   * found an empty stack and did nothing. Undo waits for this first, so
   * the restore never overtakes the delete.
   */
  after?: Promise<unknown>;
  /** It was pinned, and archiving took the pin off. Undo puts it back. */
  wasPinned?: boolean;
};

type MailUndoEntry = MailThreadUndoEntry | MailBatchUndoEntry;

export function useMailUndo({
  viewerId,
  listCacheKey,
  hiddenRowsRef,
  setThreads,
  setSnoozedCount,
}: {
  viewerId: string;
  listCacheKey: string;
  hiddenRowsRef: React.RefObject<HiddenRows>;
  setThreads: React.Dispatch<React.SetStateAction<MailThreadSummary[]>>;
  setSnoozedCount: React.Dispatch<React.SetStateAction<number | null>>;
}) {
  /**
   * Stack of archive/trash/move/snooze actions — each Cmd+Z pops exactly one.
   * Made once and kept for the life of the page; it is never replaced.
   */
  const [stack] = React.useState(() => createMailUndoStack<MailUndoEntry>());

  const applyMailUndo = React.useCallback(
    async (undo: MailUndoEntry) => {
      toast.dismiss(undo.toastId);
      if (undo.kind === "batch") {
        await undo.run();
        return;
      }
      if (undo.after) {
        try {
          await undo.after;
        } catch {
          // It never went, and the caller put the row back. Nothing to undo.
          return;
        }
      }
      // The row is coming back; nothing may keep hiding it. Every kind set
      // a hide when it removed the row, so every kind clears one here.
      unhideRow(hiddenRowsRef.current, threadKey(undo.summary));
      if (undo.leftFolderName)
        bumpMailFolderCount(undo.summary.account, undo.leftFolderName, 1);
      setThreads((current) => {
        const key = threadKey(undo.summary);
        if (current.some((t) => threadKey(t) === key)) return current;
        const next = [...current, undo.summary].sort(
          (a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt)
        );
        patchCachedThreads(viewerId, listCacheKey, next);
        return next;
      });
      try {
        if (undo.kind === "move") {
          await apiJson("/api/mail/folders/unmove", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              account: undo.summary.account,
              threadId: undo.summary.threadId,
              folderName: undo.folderName,
            }),
          });
          if (undo.folderName)
            bumpMailFolderCount(undo.summary.account, undo.folderName, -1);
          toast.success(mailSay("movedBackToInbox"));
        } else if (undo.kind === "snooze") {
          await apiJson("/api/mail/unsnooze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              account: undo.summary.account,
              threadId: undo.summary.threadId,
            }),
          });
          setSnoozedCount((n) => {
            const current = n == null ? 1 : n;
            return Math.max(0, current - 1);
          });
          toast.success(mailSay("snoozeCancelled"));
        } else {
          // Every copy that went — the row's own and the ones folded into
          // it — comes back, or the row would return as one of them and the
          // rest would stay wherever they were sent.
          await Promise.all(
            everyCopy(undo.summary, [undo.summary]).map((c) =>
              apiJson(
                undo.kind === "trash"
                  ? "/api/mail/untrash"
                  : "/api/mail/unarchive",
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(c),
                }
              )
            )
          );
          // The pin archiving took off. Undo is the whole move back, and a
          // thread that returns to the inbox without its pin is not that.
          if (undo.wasPinned) pinMailThread(undo.summary);
          toast.success(
            mailSay(
              undo.kind === "trash" ? "restoredToInbox" : "movedBackToInbox"
            )
          );
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : mailSay("couldNotRestore")
        );
      }
    },
    [listCacheKey, hiddenRowsRef, setSnoozedCount, setThreads, viewerId]
  );

  const undoLastMailAction = React.useCallback(async () => {
    const undo = stack.pop();
    if (!undo) return;
    await applyMailUndo(undo);
  }, [applyMailUndo, stack]);

  /** Toast Undo undoes that specific action even if newer ones followed. */
  const undoMailActionById = React.useCallback(
    async (id: string) => {
      const undo = stack.take(id);
      if (!undo) return;
      await applyMailUndo(undo);
    },
    [applyMailUndo, stack]
  );

  const pushMailUndo = React.useCallback(
    (
      kind: "trash" | "archive" | "move" | "snooze",
      summary: MailThreadSummary,
      label: string,
      folderName?: string,
      leftFolderName?: string | null,
      after?: Promise<unknown>,
      wasPinned?: boolean
    ): string => {
      const id = `${kind}-${threadKey(summary)}-${Date.now()}`;
      const toastId =
        kind === "move"
          ? toast.success(label, {
              action: {
                label: "Undo",
                onClick: () => void undoMailActionById(id),
              },
              duration: 8000,
            })
          : toast(label, {
              action: {
                label: "Undo",
                onClick: () => void undoMailActionById(id),
              },
              duration: 8000,
            });
      stack.push({
        id,
        kind,
        summary,
        wasPinned,
        toastId,
        folderName,
        leftFolderName,
        after,
      });
      return id;
    },
    [undoMailActionById, stack]
  );

  /** An action that failed has nothing to take back: off the stack, toast gone. */
  const dropMailUndo = React.useCallback((id: string | null) => {
    if (!id) return;
    const entry = stack.take(id);
    if (!entry) return;
    toast.dismiss(entry.toastId);
  }, [stack]);

  /**
   * The toast and the Command+Z entry for an action on many conversations.
   *
   * These two were toasts with an Undo button and nothing on the stack, so
   * Command+Z after deleting a person's mail, or a selection, did nothing —
   * and the people view deletes no other way.
   */
  const pushBatchUndo = React.useCallback(
    (label: string, run: () => Promise<void>) => {
      const id = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const toastId = toast(label, {
        action: {
          label: mailSay("undo"),
          onClick: () => void undoMailActionById(id),
        },
        duration: 8000,
      });
      stack.push({ id, kind: "batch", toastId, run });
    },
    [undoMailActionById, stack]
  );

  /** Something is on the stack for Command+Z to take back. */
  const hasMailUndo = React.useCallback(() => stack.size > 0, [stack]);

  return {
    pushMailUndo,
    pushBatchUndo,
    dropMailUndo,
    undoLastMailAction,
    hasMailUndo,
  };
}
