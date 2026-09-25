"use client";

/*
 * What can be done to many conversations at once, off MailPage: all of a
 * person's mail (Archive all, Delete all), a selection (archive, delete,
 * or dragged to a folder).
 *
 * Owns: one request per thread (the providers have no batch), one toast,
 * and one Undo for the lot, and where the list lands afterwards.
 *
 * Does not own: the selection, the rows or the stack. They come in from
 * use-mail-selection, use-thread-removal and use-mail-undo.
 *
 * No effects. The hook stands where actOnSelection stood, after the
 * selection it reads.
 */

import * as React from "react";
import { successorAfterRemoving } from "@/lib/mail/successor";
import { type PersonRow } from "@/lib/mail/person-participants";
import { toast } from "@/lib/mail/toast";
import { bumpMailFolderCount } from "@/components/mail/MailFolders";
import { unpinMailThread } from "@/lib/mail/pins";
import { invalidateCachedMailThread } from "@/lib/mail/thread-cache";
import { threadKey } from "@/lib/mail/thread-copies";
import { mailSay } from "@/lib/mail/i18n";
import type { MailThreadSummary } from "@/lib/mail/types";
import { mailApiJson as apiJson } from "@/lib/mail/api";
import type { MailViewMode } from "@/components/mail/MailListControls";

type OpenThread = {
  account: string;
  threadId: string;
  inCrm: boolean;
  focusMessageId?: string;
};

export function useBatchActions({
  threads,
  setThreads,
  viewMode,
  selectedPersonKey,
  setSelected,
  setSelectedPersonKey,
  landOnPerson,
  removeThread,
  noteLeftOpenFolder,
  hideRemovedRows,
  unhideRows,
  pushBatchUndo,
  selectedThreadsNow,
  successorAfterSelection,
  clearMultiSelection,
  personRowOrderRef,
}: {
  threads: MailThreadSummary[];
  setThreads: React.Dispatch<React.SetStateAction<MailThreadSummary[]>>;
  viewMode: MailViewMode;
  selectedPersonKey: string | null;
  setSelected: React.Dispatch<React.SetStateAction<OpenThread | null>>;
  setSelectedPersonKey: React.Dispatch<React.SetStateAction<string | null>>;
  landOnPerson: (row?: PersonRow | null) => void;
  removeThread: (key: string, alsoKeys?: string[]) => void;
  noteLeftOpenFolder: (account: string) => void;
  hideRemovedRows: (keys: string[]) => void;
  unhideRows: (keys: string[]) => void;
  pushBatchUndo: (label: string, run: () => Promise<void>) => void;
  selectedThreadsNow: () => MailThreadSummary[];
  successorAfterSelection: () => MailThreadSummary | null;
  clearMultiSelection: () => void;
  /** The people rows as painted, to land on the next one. */
  personRowOrderRef: React.RefObject<PersonRow[]>;
}) {
  /**
   * Archive every conversation with someone.
   *
   * Not the per-thread `archive` called in a loop: that pushes an undo toast
   * each time, so archiving a person you write to often would stack twenty of
   * them, and undoing would mean twenty clicks. One request per thread is
   * unavoidable — the providers have no batch — but one toast is not.
   */
  const archivePerson = React.useCallback(
    async (row: PersonRow) => {
      const targets = row.threads.map((t) => ({
        account: t.account,
        threadId: t.threadId,
      }));
      if (!targets.length) return;
      const before = threads;

      // Work out where to go before the rows are gone. The one below, or the
      // one above when this was the last — the same rule the thread list uses
      // in removeThread, so archiving behaves the same in either view.
      const wasOpen = selectedPersonKey === row.key;
      const successor = successorAfterRemoving(
        personRowOrderRef.current,
        (r) => r.key === row.key
      );

      const targetKeys = targets.map((t) => threadKey(t));
      for (const rowKey of targetKeys) removeThread(rowKey);
      hideRemovedRows(targetKeys);
      if (wasOpen) landOnPerson(successor);

      const results = await Promise.allSettled(
        targets.map((t) =>
          apiJson("/api/mail/archive", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(t),
          })
        )
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed === targets.length) {
        unhideRows(targetKeys);
        setThreads(before);
        toast.error(`Couldn't archive ${row.name}'s mail`);
        return;
      }
      // Some through, some not: the list is rebuilt from the server on the
      // next load anyway, so say what happened rather than guessing.
      if (failed) {
        toast.error(`${failed} of ${targets.length} couldn't be archived`);
        return;
      }

      // On the stack, as `trashPerson` is. A toast of its own left Command+Z
      // with nothing to take back.
      const archived = targets.length;
      pushBatchUndo(
        archived === 1
          ? `Conversation with ${row.name} archived`
          : `${archived} conversations with ${row.name} archived`,
        async () => {
          try {
            await Promise.all(
              targets.map((t) =>
                apiJson("/api/mail/unarchive", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(t),
                })
              )
            );
            unhideRows(targetKeys);
            setThreads(before);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Couldn't undo");
          }
        }
      );
    },
    [
      threads,
      removeThread,
      hideRemovedRows,
      unhideRows,
      landOnPerson,
      selectedPersonKey,
      setThreads,
      pushBatchUndo,
      personRowOrderRef,
    ]
  );

  /**
   * Delete every conversation with someone.
   *
   * `archivePerson` with the two things deleting adds: a pin and a cached
   * body outlive an archived thread but not a deleted one, so both go with
   * it, and the folder counts are told that something left.
   *
   * The caller asks first — this is the one action here that empties a list
   * — and Trash is what makes the asking enough. Nothing is destroyed, so
   * the answer to a mistake is the provider's Trash rather than an undo
   * that has to reach across a dozen requests.
   */
  const trashPerson = React.useCallback(
    async (row: PersonRow) => {
      const targets = row.threads.map((t) => ({
        account: t.account,
        threadId: t.threadId,
      }));
      if (!targets.length) return;
      const before = threads;

      const wasOpen = selectedPersonKey === row.key;
      const successor = successorAfterRemoving(
        personRowOrderRef.current,
        (r) => r.key === row.key
      );

      const targetKeys = targets.map((t) => threadKey(t));
      for (const target of targets) {
        unpinMailThread(target.account, target.threadId);
        invalidateCachedMailThread(target.account, target.threadId);
      }
      for (const rowKey of targetKeys) removeThread(rowKey);
      hideRemovedRows(targetKeys);
      if (wasOpen) landOnPerson(successor);

      const results = await Promise.allSettled(
        targets.map((t) =>
          apiJson("/api/mail/trash", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(t),
          })
        )
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed === targets.length) {
        unhideRows(targetKeys);
        setThreads(before);
        toast.error(mailSay("couldNotDeletePersonMail", { name: row.name }));
        return;
      }
      noteLeftOpenFolder(targets[0].account);
      if (failed) {
        toast.error(
          mailSay("someCouldNotBeDeleted", {
            failed,
            count: targets.length,
          })
        );
        return;
      }
      // One Undo for the batch, the way archiving does it. Trash is still
      // where these have gone, and the dialog said so — this is the quick
      // way back for the answer given half a second ago. On the stack too,
      // so Command+Z is the same way back.
      pushBatchUndo(
        targets.length === 1
          ? mailSay("conversationDeletedWith", { name: row.name })
          : mailSay("conversationsDeletedWith", {
              count: targets.length,
              name: row.name,
            }),
        async () => {
          try {
            await Promise.all(
              targets.map((t) =>
                apiJson("/api/mail/untrash", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(t),
                })
              )
            );
            unhideRows(targetKeys);
            setThreads(before);
          } catch (err) {
            toast.error(
              err instanceof Error ? err.message : mailSay("couldNotUndo")
            );
          }
        }
      );
    },
    [
      threads,
      removeThread,
      hideRemovedRows,
      unhideRows,
      noteLeftOpenFolder,
      selectedPersonKey,
      landOnPerson,
      pushBatchUndo,
      setThreads,
      personRowOrderRef,
    ]
  );

  /**
   * Archive or delete every selected row.
   *
   * One request per thread — the providers have no batch — but one toast
   * and one Undo, the way `archivePerson` does it: thirty toasts for thirty
   * rows would be thirty things to dismiss and thirty clicks to undo.
   */
  const actOnSelection = React.useCallback(
    async (kind: "archive" | "trash") => {
      const targets = selectedThreadsNow().map((t) => ({
        account: t.account,
        threadId: t.threadId,
      }));
      if (!targets.length) return;
      const before = threads;
      const people = viewMode === "people";
      const successor = people ? null : successorAfterSelection();
      const targetKeys = targets.map((t) => threadKey(t));

      if (kind === "trash") {
        for (const target of targets) {
          unpinMailThread(target.account, target.threadId);
          invalidateCachedMailThread(target.account, target.threadId);
        }
      }
      for (const rowKey of targetKeys) removeThread(rowKey);
      hideRemovedRows(targetKeys);
      clearMultiSelection();
      if (people) {
        setSelected(null);
        setSelectedPersonKey(null);
      } else {
        setSelected(
          successor
            ? {
                account: successor.account,
                threadId: successor.threadId,
                inCrm: successor.tab === "people",
                focusMessageId: successor.focusMessageId,
              }
            : null
        );
      }

      const path = kind === "archive" ? "/api/mail/archive" : "/api/mail/trash";
      const results = await Promise.allSettled(
        targets.map((t) =>
          apiJson(path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(t),
          })
        )
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      // The conversations, in the by-person view too: "3 people deleted"
      // said something that did not happen.
      const noun = mailSay(
        targets.length === 1 ? "conversationOne" : "conversationsMany",
        { count: targets.length }
      );
      if (failed === targets.length) {
        unhideRows(targetKeys);
        setThreads(before);
        toast.error(
          mailSay(kind === "archive" ? "couldNotArchiveThese" : "couldNotDeleteThese", {
            what: noun,
          })
        );
        return;
      }
      if (kind === "trash") noteLeftOpenFolder(targets[0].account);
      if (failed) {
        toast.error(
          mailSay(kind === "archive" ? "someCouldNotBeArchived" : "someCouldNotBeDeleted", {
            failed,
            count: targets.length,
          })
        );
        return;
      }
      const undoPath =
        kind === "archive" ? "/api/mail/unarchive" : "/api/mail/untrash";
      pushBatchUndo(
        mailSay(kind === "archive" ? "selectionArchived" : "selectionDeleted", {
          what: noun,
        }),
        async () => {
          try {
            await Promise.all(
              targets.map((t) =>
                apiJson(undoPath, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(t),
                })
              )
            );
            unhideRows(targetKeys);
            setThreads(before);
          } catch (err) {
            toast.error(
              err instanceof Error ? err.message : mailSay("couldNotUndo")
            );
          }
        }
      );
    },
    [
      selectedThreadsNow,
      viewMode,
      threads,
      successorAfterSelection,
      removeThread,
      hideRemovedRows,
      unhideRows,
      clearMultiSelection,
      noteLeftOpenFolder,
      pushBatchUndo,
      setThreads,
      setSelected,
      setSelectedPersonKey,
    ]
  );

  /**
   * The selection a drag is carrying, or nothing when it carries one row.
   *
   * A row that is part of the selection takes the whole of it: the reader
   * ticked three conversations and dragged one of them, which is how every
   * list says "these". A row that is not in the selection is just itself,
   * and the selection stays where it is.
   */
  const dragCarriesSelection = React.useCallback(
    (thread: { account: string; threadId: string }): MailThreadSummary[] => {
      const chosen = selectedThreadsNow();
      const key = threadKey(thread);
      const carried =
        chosen.length > 1 && chosen.some((t) => threadKey(t) === key);
      return carried ? chosen : [];
    },
    [selectedThreadsNow]
  );

  /**
   * File several at once, and say so once.
   *
   * The single case keeps its own path above: it has an undo that puts one
   * conversation back where it came from. This one reports how many went
   * and where, and a failure puts every one of them back.
   */
  const moveManyToFolder = React.useCallback(
    async (targets: MailThreadSummary[], folderName: string) => {
      const before = threads;
      const keys = targets.map((t) => threadKey(t));
      for (const key of keys) removeThread(key);
      hideRemovedRows(keys);
      clearMultiSelection();
      const results = await Promise.allSettled(
        targets.map((t) =>
          apiJson<{ folderName: string; movedOut?: boolean }>(
            "/api/mail/folders/move",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                account: t.account,
                threadId: t.threadId,
                folderName,
                create: false,
              }),
            }
          )
        )
      );
      const done = results.filter(
        (r): r is PromiseFulfilledResult<{ folderName: string; movedOut?: boolean }> =>
          r.status === "fulfilled"
      );
      if (!done.length) {
        unhideRows(keys);
        setThreads(before);
        toast.error(mailSay("couldNotMove"));
        return;
      }
      const landed = done[0].value.folderName;
      for (const [i, result] of results.entries()) {
        if (result.status !== "fulfilled") continue;
        bumpMailFolderCount(targets[i].account, result.value.folderName, 1);
        if (result.value.movedOut) noteLeftOpenFolder(targets[i].account);
      }
      if (done.length < targets.length) {
        toast.error(
          mailSay("someCouldNotBeMoved", {
            failed: targets.length - done.length,
            count: targets.length,
          })
        );
        return;
      }
      toast.success(
        mailSay("movedManyToFolder", { count: targets.length, name: landed })
      );
    },
    [
      threads,
      removeThread,
      hideRemovedRows,
      unhideRows,
      clearMultiSelection,
      noteLeftOpenFolder,
      setThreads,
    ]
  );

  return {
    archivePerson,
    trashPerson,
    actOnSelection,
    dragCarriesSelection,
    moveManyToFolder,
  };
}
