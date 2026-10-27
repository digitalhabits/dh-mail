"use client";

/*
 * What can be done to one conversation, off MailPage: archive, delete,
 * restore, junk, move to a folder or back to the inbox, snooze and wake,
 * and read or unread.
 *
 * Owns: each action's request, the row leaving the list (or coming back
 * when the request fails), its toast, and its entry on the Undo stack.
 *
 * Does not own: the list or the stack. Rows leave through
 * use-thread-removal, and Undo entries go on through use-mail-undo; both
 * come in as inputs. Actions on many conversations at once are in
 * use-batch-actions.
 *
 * One hook inside, useIsOutlookAccount, whose one effect reads which
 * mailboxes are Outlook. The page calls this hook where that call stood,
 * so the effect runs in the same order.
 */

import * as React from "react";
import { formatSnoozeWakeLabel } from "@/components/mail/SnoozeMenu";
import { toast } from "@/lib/mail/toast";
import { bumpMailFolderCount } from "@/components/mail/MailFolders";
import { REMOVED_ROW_HIDE_MS } from "@/components/mail/use-thread-removal";
import { isMailPinned, pinMailThread, unpinMailThread } from "@/lib/mail/pins";
import { invalidateCachedMailThread } from "@/lib/mail/thread-cache";
import { mailProviderFor, mailProviderLabel, useIsOutlookAccount } from "@/lib/mail/use-outlook-accounts";
import { hideRow, unhideRow, type HiddenRows } from "@/lib/mail/hidden-rows";
import { everyCopy, rowStandsFor, threadKey, withRowsBack } from "@/lib/mail/thread-copies";
import { releaseRead } from "@/lib/mail/held-reads";
import { mailSay } from "@/lib/mail/i18n";
import { describeTargets, type MailUndoAnchor, type MailUndoWords } from "@/components/mail/use-mail-undo";
import type { PersonRow } from "@/lib/mail/person-participants";
import type { MailViewMode } from "@/components/mail/MailListControls";
import type { MailThreadSummary } from "@/lib/mail/types";
import { mailApiJson as apiJson } from "@/lib/mail/api";
import { patchCachedThreads, type ActiveMailFolder } from "@/components/mail/mail-list-state";


type OpenThread = {
  account: string;
  threadId: string;
  inPeople: boolean;
  focusMessageId?: string;
};

/** What the page hands to useThreadActions. */
export type ThreadActionsInput = {
  viewerId: string;
  listCacheKey: string;
  threads: MailThreadSummary[];
  setThreads: React.Dispatch<React.SetStateAction<MailThreadSummary[]>>;
  folder: string;
  tab: string;
  activeFolder: ActiveMailFolder | null;
  /** The open thread. */
  selected: OpenThread | null;
  setSelected: React.Dispatch<React.SetStateAction<OpenThread | null>>;
  removeThread: (key: string, alsoKeys?: string[]) => void;
  openFolderName: string | null;
  noteLeftOpenFolder: (account: string) => void;
  hideRemovedRows: (keys: string[]) => void;
  unhideRows: (keys: string[]) => void;
  pushMailUndo: (
    kind: "trash" | "archive" | "move" | "snooze",
    summary: MailThreadSummary,
    label: string,
    folderName?: string,
    leftFolderName?: string | null,
    after?: Promise<unknown>,
    wasPinned?: boolean,
    what?: string
  ) => string;
  dropMailUndo: (id: string | null) => void;
  /** One Undo for many conversations (use-mail-undo). Returns its id. */
  pushBatchUndo: (label: string, run: () => Promise<void>, anchor: MailUndoAnchor, words: MailUndoWords) => string;
  /** The people view's rows as painted, to name the stacks acted on. */
  personRowOrderRef: React.RefObject<PersonRow[]>;
  viewMode: MailViewMode;
  hiddenRowsRef: React.RefObject<HiddenRows>;
  listViewIdRef: React.RefObject<string>;
  loadAbortRef: React.RefObject<AbortController | null>;
  setSnoozedCount: React.Dispatch<React.SetStateAction<number | null>>;
};

export function useThreadActions({
  viewerId,
  listCacheKey,
  threads,
  setThreads,
  folder,
  tab,
  activeFolder,
  selected,
  setSelected,
  removeThread,
  openFolderName,
  noteLeftOpenFolder,
  hideRemovedRows,
  unhideRows,
  pushMailUndo,
  dropMailUndo,
  pushBatchUndo,
  hiddenRowsRef,
  listViewIdRef,
  loadAbortRef,
  setSnoozedCount,
  personRowOrderRef,
  viewMode,
}: ThreadActionsInput) {
  const { archive, isOutlookAccount, markUnread, moveToFolder, moveToInbox } = useMoveActions({ activeFolder, dropMailUndo, folder, hideRemovedRows, listCacheKey, loadAbortRef, noteLeftOpenFolder, openFolderName, pushMailUndo, removeThread, setThreads, threads, unhideRows, viewerId });
  const { restoreFromTrash, setThreadJunk, toggleRead, trash } = useMarkAndDeleteActions({ dropMailUndo, hideRemovedRows, isOutlookAccount, noteLeftOpenFolder, openFolderName, pushMailUndo, removeThread, selected, setSelected, setThreads, threads, unhideRows });
  const { snooze, snoozeMany, unsnooze } = useSnoozeActions({ activeFolder, dropMailUndo, personRowOrderRef, viewMode, pushBatchUndo, hiddenRowsRef, listCacheKey, listViewIdRef, loadAbortRef, pushMailUndo, removeThread, setSnoozedCount, setThreads, tab, threads, viewerId });

  return {
    markUnread,
    moveToFolder,
    isOutlookAccount,
    archive,
    moveToInbox,
    toggleRead,
    trash,
    restoreFromTrash,
    setThreadJunk,
    snooze,
    snoozeMany,
    unsnooze,
  };
}

/** Unread, moving to a folder, archiving, and moving back to the inbox. */
export function useMoveActions({
  activeFolder,
  dropMailUndo,
  folder,
  hideRemovedRows,
  listCacheKey,
  loadAbortRef,
  noteLeftOpenFolder,
  openFolderName,
  pushMailUndo,
  removeThread,
  setThreads,
  threads,
  unhideRows,
  viewerId,
}: { activeFolder: ThreadActionsInput["activeFolder"]; dropMailUndo: ThreadActionsInput["dropMailUndo"]; folder: ThreadActionsInput["folder"]; hideRemovedRows: ThreadActionsInput["hideRemovedRows"]; listCacheKey: ThreadActionsInput["listCacheKey"]; loadAbortRef: ThreadActionsInput["loadAbortRef"]; noteLeftOpenFolder: ThreadActionsInput["noteLeftOpenFolder"]; openFolderName: ThreadActionsInput["openFolderName"]; pushMailUndo: ThreadActionsInput["pushMailUndo"]; removeThread: ThreadActionsInput["removeThread"]; setThreads: ThreadActionsInput["setThreads"]; threads: ThreadActionsInput["threads"]; unhideRows: ThreadActionsInput["unhideRows"]; viewerId: ThreadActionsInput["viewerId"] }) {
  const markUnread = React.useCallback(
    async (t: { account: string; threadId: string }) => {
      // The reader's own word: a read still waiting to be told is dropped.
      releaseRead(everyCopy(t, threads).map((c) => threadKey(c)));
      try {
        // One copy is enough to make the row bold again; it is the one
        // the reader is looking at.
        await apiJson("/api/mail/unread", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account: t.account, threadId: t.threadId }),
        });
        setThreads((current) => {
          const next = current.map((item) =>
            rowStandsFor(item, t) ? { ...item, unread: true } : item
          );
          patchCachedThreads(viewerId, listCacheKey, next);
          return next;
        });
        toast(mailSay("markedAsUnread"));
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't mark as unread"
        );
      }
    },
    [listCacheKey, setThreads, threads, viewerId]
  );
  const moveToFolder = React.useCallback(
    async (
      t: { account: string; threadId: string },
      folderName: string,
      create: boolean
    ) => {
      const key = threadKey(t);
      const before = threads;
      const summary = threads.find((x) => threadKey(x) === key);
      removeThread(key);
      hideRemovedRows([key]);
      try {
        const json = await apiJson<{
          folderName: string;
          movedOut?: boolean;
        }>(
          "/api/mail/folders/move",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              account: t.account,
              threadId: t.threadId,
              folderName,
              create,
            }),
          }
        );
        bumpMailFolderCount(t.account, json.folderName, 1);
        // Outlook keeps a message in one folder, so it has left this one.
        // Gmail keeps every label it had, so it has not.
        if (json.movedOut) noteLeftOpenFolder(t.account);
        if (summary) {
          pushMailUndo(
            "move",
            summary,
            mailSay("movedToFolder", { name: json.folderName }),
            json.folderName,
            json.movedOut ? openFolderName : null
          );
        } else {
          toast.success(mailSay("movedToFolder", { name: json.folderName }));
        }
      } catch (err) {
        unhideRows([key]);
        setThreads((current) => withRowsBack(current, before, [key]));
        throw err;
      }
    },
    [
      threads,
      removeThread,
      pushMailUndo,
      noteLeftOpenFolder,
      openFolderName,
      hideRemovedRows,
      unhideRows,
      setThreads,
    ]
  );
  /*
   * Toasts name the provider that did the deed, so they ask which one it
   * was. "Archived in Gmail" over an Outlook mailbox is the app talking
   * about itself instead of the account in front of it. The mail went to
   * Outlook, and the sentence says otherwise.
   */
  const isOutlookAccount = useIsOutlookAccount();
  const archive = React.useCallback(
    async (t: { account: string; threadId: string }) => {
      const key = threadKey(t);
      const before = threads;
      const summary = threads.find((x) => threadKey(x) === key);
      const provider = mailProviderLabel(mailProviderFor(t.account, isOutlookAccount));
      /*
        One press has raised three of these, word for word.

        Each call shows one toast and archives every copy behind the row in
        the one go, so three toasts are three calls — and the three named the
        same subject, which several of these threads share. Whether that is
        one control firing three times or three threads being archived at
        once cannot be told from the toast, so the call says where it came
        from. The first frames of the stack name it outright.
      */
      console.info(
        `[mail] archive ${key} "${summary?.subject ?? "(not in the list)"}"`,
        new Error("called from").stack?.split("\n").slice(1, 5).join("\n")
      );
      /*
        A pin is a shortcut to something in the inbox, so archiving takes
        it off.

        If it stays, the band goes on drawing the thread from the summary
        the pin keeps. The reader presses Archive, is told it is archived,
        and sees the row stay exactly where it was.
      */
      const wasPinned = isMailPinned(t.account, t.threadId);
      if (wasPinned) unpinMailThread(t.account, t.threadId);
      // Every copy behind the row — the same reason as in `trash`.
      const copies = everyCopy(t, threads);
      const keys = copies.map(threadKey);
      removeThread(key, keys);
      hideRemovedRows(keys);
      const sent = Promise.all(
        copies.map((c) =>
          apiJson("/api/mail/archive", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(c),
          })
        )
      );
      // On the stack now, not when the provider answers — see `after`.
      const undoId = summary
        ? pushMailUndo(
            "archive",
            summary,
            `"${summary.subject}" archived in ${provider}`,
            undefined,
            undefined,
            sent,
            wasPinned
          )
        : null;
      try {
        await sent;
        if (!summary) toast(mailSay("archivedIn", { provider }));
      } catch (err) {
        dropMailUndo(undoId);
        unhideRows(keys);
        setThreads((current) => withRowsBack(current, before, keys));
        // The rows come back, so the pin does too.
        if (wasPinned && summary) pinMailThread(summary);
        toast.error(err instanceof Error ? err.message : "Couldn't archive");
      }
    },
    [
      threads,
      removeThread,
      pushMailUndo,
      dropMailUndo,
      hideRemovedRows,
      unhideRows,
      isOutlookAccount,
      setThreads,
    ]
  );
  /**
   * Back to the inbox.
   *
   * The fourth of the rail's places in the move menu, and the only one with
   * no button of its own: archiving, junking and deleting all have one, and
   * the way back from any of them is this. On Gmail it is the inbox label
   * put back; on Outlook a move to the inbox folder. The endpoint knows
   * which — it is the one undo has always used.
   */
  const moveToInbox = React.useCallback(
    async (t: { account: string; threadId: string }) => {
      const key = threadKey(t);
      const before = threads;
      const summary = threads.find((x) => threadKey(x) === key);
      const copies = everyCopy(t, threads);
      const keys = copies.map(threadKey);
      // Where the reader is standing decides whether the row should go: in
      // the inbox it has arrived, anywhere else it has left.
      const leaves = folder !== "inbox" || Boolean(activeFolder);
      /*
        And where it comes back from decides how.

        Out of Junk it is "not junk", out of Trash it is "untrash", and from
        anywhere else it is the undo of an archive. The undo of an archive
        is not enough for all three. On Gmail it only puts the inbox label
        back, and a thread still in Spam or Trash stays there. The copy even
        looks for it in All Mail, where a junked thread is not. Mail moved
        out of Junk that way never reaches the inbox.
      */
      const endpoint =
        !activeFolder && folder === "junk"
          ? "/api/mail/not-junk"
          : !activeFolder && folder === "trash"
            ? "/api/mail/untrash"
            : "/api/mail/unarchive";
      if (leaves) {
        removeThread(key, keys);
        // Not hidden, only the list load in flight dropped. A row hidden
        // after it is removed stays hidden in every list for a minute — the
        // inbox included, which is exactly where this one is going.
        loadAbortRef.current?.abort();
      }
      try {
        await Promise.all(
          copies.map((c) =>
            apiJson(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(c),
            })
          )
        );
        toast(
          summary
            ? `"${summary.subject}" moved to ${mailSay("viewInbox")}`
            : mailSay("viewInbox")
        );
      } catch (err) {
        if (leaves) setThreads((current) => withRowsBack(current, before, keys));
        toast.error(err instanceof Error ? err.message : "Couldn't move");
      }
    },
    [threads, folder, activeFolder, removeThread, loadAbortRef, setThreads]
  );
  return { archive, isOutlookAccount, markUnread, moveToFolder, moveToInbox };
}

/** Read and unread, deleting, restoring from Trash, and junk. */
export function useMarkAndDeleteActions({
  dropMailUndo,
  hideRemovedRows,
  isOutlookAccount,
  noteLeftOpenFolder,
  openFolderName,
  pushMailUndo,
  removeThread,
  selected,
  setSelected,
  setThreads,
  threads,
  unhideRows,
}: Pick<ReturnType<typeof useMoveActions>, "isOutlookAccount"> &
  { dropMailUndo: ThreadActionsInput["dropMailUndo"]; hideRemovedRows: ThreadActionsInput["hideRemovedRows"]; noteLeftOpenFolder: ThreadActionsInput["noteLeftOpenFolder"]; openFolderName: ThreadActionsInput["openFolderName"]; pushMailUndo: ThreadActionsInput["pushMailUndo"]; removeThread: ThreadActionsInput["removeThread"]; selected: ThreadActionsInput["selected"]; setSelected: ThreadActionsInput["setSelected"]; setThreads: ThreadActionsInput["setThreads"]; threads: ThreadActionsInput["threads"]; unhideRows: ThreadActionsInput["unhideRows"] }) {
  /**
   * Read when anything is unread; otherwise the newest back to unread.
   *
   * One button for both, because they are the same intent seen from either
   * side: "I have dealt with this" and "I have not, after all". Which way it
   * goes is read off the rows, so the button always does the thing the icon
   * shows.
   *
   * Marking read clears every thread given. Marking unread touches one — the
   * newest — since bringing back eleven messages nobody asked for is not what
   * unread means to a reader.
   */
  const toggleRead = React.useCallback(
    async (rows: MailThreadSummary[], label: string) => {
      const unread = rows.filter((t) => t.unread);
      const before = threads;
      const call = (path: string, t: { account: string; threadId: string }) =>
        apiJson(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account: t.account, threadId: t.threadId }),
        });

      if (unread.length) {
        setThreads((current) =>
          current.map((t) =>
            unread.some((u) => threadKey(u) === threadKey(t))
              ? { ...t, unread: false }
              : t
          )
        );
        // Every copy behind each row, or the row comes back bold from
        // the mailbox that was not told. A row is undone only when none
        // of its copies could be told: one mailbox being out must not
        // put back every row, nor the copies that did go through.
        const outcomes = await Promise.all(
          unread.map(async (t) => {
            const results = await Promise.allSettled(
              everyCopy(t, before).map((c) => call("/api/mail/read", c))
            );
            return { key: threadKey(t), ok: results.some((r) => r.status === "fulfilled") };
          })
        );
        const undone = new Set(outcomes.filter((o) => !o.ok).map((o) => o.key));
        if (undone.size) {
          setThreads((current) =>
            current.map((t) => (undone.has(threadKey(t)) ? { ...t, unread: true } : t))
          );
          toast.error(`Couldn't mark ${label} read`);
        }
        return;
      }

      // Newest first in the list, so the newest thread is the one at the top.
      const newest = rows[0];
      if (!newest) return;
      // The reader's own word: a read still waiting to be told is dropped.
      releaseRead(everyCopy(newest, threads).map((c) => threadKey(c)));
      setThreads((current) =>
        current.map((t) =>
          threadKey(t) === threadKey(newest) ? { ...t, unread: true } : t
        )
      );
      try {
        await call("/api/mail/unread", newest);
      } catch (err) {
        setThreads((current) => withRowsBack(current, before, [threadKey(newest)]));
        toast.error(
          err instanceof Error ? err.message : "Couldn't mark unread"
        );
      }
    },
    [threads, setThreads]
  );
  const trash = React.useCallback(
    async (
      t: { account: string; threadId: string },
      /** Which control asked, for the line below. */
      from: "reader" | "row" | "drop" | "person" = "row"
    ) => {
      const key = threadKey(t);
      const before = threads;
      const summary = threads.find((x) => threadKey(x) === key);
      const provider = mailProviderLabel(mailProviderFor(t.account, isOutlookAccount));
      /*
        Every copy, not the one the row happens to stand for.

        A mail that arrived in two of the reader's mailboxes is one row —
        see dedupeThreadsByTip. If only the row's own copy is deleted, the
        other one takes the row's place on the next refresh: the same
        subject in the same spot. It reads as though nothing happened, and
        the reader deletes again. By then the selection is on the next
        conversation, so the second delete takes a mail that they never
        meant to touch.
      */
      /*
        Say what is going, from where, and what was on screen when it went.

        A delete has twice taken a conversation that was neither open nor
        selected, and the toast named it correctly — so the wrong one was
        chosen before the key was pressed. This line says which control
        asked and what the reader had, which is the difference between a
        guess and an answer.
      */
      console.info(
        `[mail] trash from ${from}: ${key} "${
          summary?.subject ?? "(not in the list)"
        }" · selected ${selected ? threadKey(selected) : "(none)"}`
      );
      const copies = everyCopy(t, threads);
      const keys = copies.map(threadKey);
      // Trash removes the conversation — drop pin + body cache with it.
      // Noted first, so undo can put the pin back with the conversation.
      const wasPinned = copies.some((c) => isMailPinned(c.account, c.threadId));
      for (const c of copies) {
        unpinMailThread(c.account, c.threadId);
        invalidateCachedMailThread(c.account, c.threadId);
      }
      removeThread(key, keys);
      hideRemovedRows(keys);
      const sent = Promise.all(
        copies.map((c) =>
          apiJson("/api/mail/trash", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(c),
          })
        )
      );
      // On the stack now, not when the provider answers — see `after`. The
      // folder count goes down only once it went, and undo waits for that,
      // so the count undo puts back is one that was taken.
      const undoId = summary
        ? pushMailUndo(
            "trash",
            summary,
            `"${summary.subject}" moved to Trash in ${provider}`,
            undefined,
            openFolderName,
            sent,
            wasPinned
          )
        : null;
      try {
        await sent;
        // Neither provider counts a deleted conversation in a folder.
        noteLeftOpenFolder(t.account);
        if (!summary) toast(`Conversation moved to Trash in ${provider}`);
      } catch (err) {
        dropMailUndo(undoId);
        unhideRows(keys);
        setThreads((current) => withRowsBack(current, before, keys));
        // The rows come back, so the pin does too.
        if (wasPinned && summary) pinMailThread(summary);
        toast.error(err instanceof Error ? err.message : "Couldn't delete");
      }
    },
    [
      threads,
      removeThread,
      pushMailUndo,
      dropMailUndo,
      noteLeftOpenFolder,
      openFolderName,
      hideRemovedRows,
      unhideRows,
      isOutlookAccount,
      selected,
      setThreads,
    ]
  );
  /**
   * Put a deleted conversation back where it came from.
   *
   * Only offered from the Trash view, which is the only place a thread is
   * known to be deleted. "Delete forever" stands beside it: see `purgeAsk`.
   */
  const restoreFromTrash = React.useCallback(
    async (t: { account: string; threadId: string }) => {
      const key = threadKey(t);
      const before = threads;
      invalidateCachedMailThread(t.account, t.threadId);
      removeThread(key);
      setSelected(null);
      try {
        await apiJson("/api/mail/untrash", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(t),
        });
        toast.success(mailSay("movedOutOfTrash"));
      } catch (err) {
        setThreads((current) => withRowsBack(current, before, [key]));
        toast.error(
          err instanceof Error ? err.message : mailSay("couldNotRestore")
        );
      }
    },
    [threads, removeThread, setThreads, setSelected]
  );
  /**
   * File a conversation as junk, or take it back out.
   *
   * Filing, not reporting: it moves the mail and syncs everywhere, and
   * teaches neither provider anything about the sender. See
   * `markMailThreadJunk`.
   */
  const setThreadJunk = React.useCallback(
    async (t: { account: string; threadId: string }, junk: boolean) => {
      const key = threadKey(t);
      const before = threads;
      // Every copy behind the row — the same reason as in `trash`.
      const copies = everyCopy(t, threads);
      const keys = copies.map(threadKey);
      for (const c of copies) invalidateCachedMailThread(c.account, c.threadId);
      removeThread(key, keys);
      if (junk) hideRemovedRows(keys);
      setSelected(null);
      try {
        await Promise.all(
          copies.map((c) =>
            apiJson(junk ? "/api/mail/junk" : "/api/mail/not-junk", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(c),
            })
          )
        );
        // Junk is out of every folder search, the same as Trash. Taking one
        // back out of Junk happens in the Junk view, where no folder is open.
        if (junk) noteLeftOpenFolder(t.account);
        toast.success(
          mailSay(junk ? "movedToJunk" : "movedBackToTheInbox")
        );
      } catch (err) {
        unhideRows(keys);
        setThreads((current) => withRowsBack(current, before, keys));
        toast.error(
          err instanceof Error
            ? err.message
            : mailSay(junk ? "couldNotMoveToJunk" : "couldNotMoveBack")
        );
      }
    },
    [
      threads,
      removeThread,
      noteLeftOpenFolder,
      hideRemovedRows,
      unhideRows,
      setThreads,
      setSelected,
    ]
  );
  return { restoreFromTrash, setThreadJunk, toggleRead, trash };
}

/** Snoozing and unsnoozing. */
export function useSnoozeActions({
  activeFolder,
  hiddenRowsRef,
  listCacheKey,
  dropMailUndo,
  listViewIdRef,
  loadAbortRef,
  personRowOrderRef,
  viewMode,
  pushBatchUndo,
  pushMailUndo,
  removeThread,
  setSnoozedCount,
  setThreads,
  tab,
  threads,
  viewerId,
}: { activeFolder: ThreadActionsInput["activeFolder"]; dropMailUndo: ThreadActionsInput["dropMailUndo"]; personRowOrderRef: ThreadActionsInput["personRowOrderRef"]; viewMode: ThreadActionsInput["viewMode"]; pushBatchUndo: ThreadActionsInput["pushBatchUndo"]; hiddenRowsRef: ThreadActionsInput["hiddenRowsRef"]; listCacheKey: ThreadActionsInput["listCacheKey"]; listViewIdRef: ThreadActionsInput["listViewIdRef"]; loadAbortRef: ThreadActionsInput["loadAbortRef"]; pushMailUndo: ThreadActionsInput["pushMailUndo"]; removeThread: ThreadActionsInput["removeThread"]; setSnoozedCount: ThreadActionsInput["setSnoozedCount"]; setThreads: ThreadActionsInput["setThreads"]; tab: ThreadActionsInput["tab"]; threads: ThreadActionsInput["threads"]; viewerId: ThreadActionsInput["viewerId"] }) {
  /**
   * One conversation. `quiet` is one of many (snoozeMany): no confirmation
   * and no error of its own, only whether it went.
   */
  const snoozeOne = React.useCallback(
    async (t: { account: string; threadId: string }, untilIso: string, quiet: boolean): Promise<boolean> => {
      const key = threadKey(t);
      const before = threads;
      const summary = threads.find((x) => threadKey(x) === key);
      const onSnoozedTab = !activeFolder && tab === "snoozed";
      const untilMs = Date.parse(untilIso);
      if (!onSnoozedTab && Number.isFinite(untilMs)) {
        // Only until the server has caught up, not until the wake time.
        // The server's filter owns the hiding after that — and it can end
        // a snooze early when a reply arrives, which a row vetoed here
        // until the original wake time would never show.
        hideRow(
          hiddenRowsRef.current,
          key,
          listViewIdRef.current,
          Math.min(untilMs, Date.now() + REMOVED_ROW_HIDE_MS)
        );
        // Drop any in-flight list response built before this snooze.
        loadAbortRef.current?.abort();
      }
      if (onSnoozedTab) {
        setThreads((current) => {
          const next = current
            .map((row) =>
              threadKey(row) === key
                ? { ...row, snoozedUntil: untilIso }
                : row
            )
            .sort(
              (a, b) =>
                Date.parse(a.snoozedUntil ?? a.lastAt) -
                Date.parse(b.snoozedUntil ?? b.lastAt)
            );
          patchCachedThreads(viewerId, listCacheKey, next);
          return next;
        });
      } else {
        removeThread(key);
      }
      const sent = apiJson("/api/mail/snooze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...t, until: untilIso }),
      });
      const when = formatSnoozeWakeLabel(untilIso);
      // The row that left says so at once, in its place, as archive does:
      // waiting for the provider left a gap where the list closed up and
      // opened again. Undo waits for the request (see `after`).
      const undoId =
        summary && !onSnoozedTab && !quiet
          ? pushMailUndo(
              "snooze",
              summary,
              `Snoozed until ${when}`,
              undefined,
              undefined,
              sent,
              undefined,
              mailSay("slotSnoozedUntil", { when })
            )
          : null;
      try {
        await sent;
        if (!onSnoozedTab) {
          setSnoozedCount((n) => {
            const current = n == null ? 0 : n;
            return current + 1;
          });
        }
        if (!undoId && !quiet) toast(`Snoozed until ${when}`);
        return true;
      } catch (err) {
        dropMailUndo(undoId);
        unhideRow(hiddenRowsRef.current, key);
        setThreads((current) => withRowsBack(current, before, [key]));
        if (!quiet) toast.error(err instanceof Error ? err.message : "Couldn't snooze");
        return false;
      }
    },
    [
      threads,
      removeThread,
      pushMailUndo,
      dropMailUndo,
      activeFolder,
      tab,
      listCacheKey,
      hiddenRowsRef,
      listViewIdRef,
      loadAbortRef,
      setSnoozedCount,
      setThreads,
      viewerId,
    ]
  );
  const snooze = React.useCallback(
    (t: { account: string; threadId: string }, untilIso: string) => snoozeOne(t, untilIso, false),
    [snoozeOne]
  );
  /**
   * Many conversations at once: a person's stack, or a selection. One
   * confirmation and one Undo for all of them, where they were in the
   * list. Each went with its own Undo before, so the last one's covered
   * the rest and Command+Z took back one at a time (2026-10-27).
   */
  const snoozeMany = React.useCallback(
    async (
      targets: MailThreadSummary[],
      untilIso: string,
      anchor?: MailUndoAnchor
    ) => {
      const onSnoozedTab = !activeFolder && tab === "snoozed";
      // One is one, and in Snoozed the rows only take a new time.
      if (targets.length <= 1 || onSnoozedTab) {
        for (const t of targets) void snoozeOne(t, untilIso, false);
        return;
      }
      const before = threads;
      const when = formatSnoozeWakeLabel(untilIso);
      const done = Promise.all(targets.map((t) => snoozeOne(t, untilIso, true)));
      // At once, as for one conversation: the rows leave now, so their
      // confirmation stands now. Undo waits for the requests.
      const undoId = pushBatchUndo(
        mailSay("snoozedMany", { count: targets.length, when }),
        async () => {
          const ok = await done;
          const back = targets.filter((_, i) => ok[i]);
          const backKeys = back.map(threadKey);
          for (const key of backKeys) unhideRow(hiddenRowsRef.current, key);
          setThreads((current) => {
            const next = withRowsBack(current, before, backKeys);
            patchCachedThreads(viewerId, listCacheKey, next);
            return next;
          });
          try {
            await Promise.all(
              back.map((t) =>
                apiJson("/api/mail/unsnooze", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ account: t.account, threadId: t.threadId }),
                })
              )
            );
            setSnoozedCount((n) => Math.max(0, (n ?? back.length) - back.length));
          } catch (err) {
            toast.error(err instanceof Error ? err.message : mailSay("couldNotUndo"));
          }
        },
        anchor ?? newestAnchor(targets),
        {
          action: "snooze",
          verb: mailSay("slotSnoozedUntil", { when }),
          object: describeTargets(targets, viewMode === "people" ? personRowOrderRef.current : null),
        }
      );
      const wentOk = await done;
      const failed = wentOk.filter((ok) => !ok).length;
      if (failed === targets.length) {
        dropMailUndo(undoId);
        toast.error("Couldn't snooze");
      } else if (failed) {
        toast.error(mailSay("someCouldNotBeSnoozed", { failed, count: targets.length }));
      }
    },
    [activeFolder, tab, threads, snoozeOne, viewMode, personRowOrderRef, pushBatchUndo, dropMailUndo, hiddenRowsRef, setThreads, viewerId, listCacheKey, setSnoozedCount]
  );
  const unsnooze = React.useCallback(
    async (t: { account: string; threadId: string }) => {
      const key = threadKey(t);
      const before = threads;
      unhideRow(hiddenRowsRef.current, key);
      removeThread(key);
      try {
        await apiJson("/api/mail/unsnooze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(t),
        });
        setSnoozedCount((n) => {
          const current = n == null ? 1 : n;
          return Math.max(0, current - 1);
        });
        toast.success(mailSay("snoozeCancelled"));
      } catch (err) {
        setThreads((current) => withRowsBack(current, before, [key]));
        toast.error(
          err instanceof Error ? err.message : "Couldn't cancel snooze"
        );
      }
    },
    [threads, removeThread, hiddenRowsRef, setSnoozedCount, setThreads]
  );
  return { snooze, snoozeMany, unsnooze };
}

/**
 * Where many conversations stood in the list: the newest of them. Its key
 * lets the people view put the confirmation under the person it left.
 */
function newestAnchor(rows: readonly MailThreadSummary[]): MailUndoAnchor {
  let newest: MailThreadSummary | null = null;
  for (const row of rows) if (!newest || Date.parse(row.lastAt) > Date.parse(newest.lastAt)) newest = row;
  return newest ? { lastAt: newest.lastAt, threadKey: threadKey(newest) } : { lastAt: null };
}
