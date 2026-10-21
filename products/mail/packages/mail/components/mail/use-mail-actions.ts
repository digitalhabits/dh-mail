"use client";

/*
 * The actions concern of the mail page: what is done to mail. Archive,
 * move, delete, junk, snooze, read and unread, pins, undo, delete forever,
 * and the same for a selection or a person.
 *
 * Each `use…` here is one part of useMailPage, called where its hooks always
 * ran, so the effects keep their order. `usePageActionsSlice` makes the slice
 * that components read with `usePageActions` (mail-page-slices.tsx). See
 * docs/mail-ui-structure.md.
 */

import * as React from "react";
import { useMailUndo } from "@/components/mail/use-mail-undo";
import { useMemoObject } from "@/components/mail/use-memo-object";
import { usePersonMenu } from "@/components/mail/use-person-menu";
import { useThreadRemoval } from "@/components/mail/use-thread-removal";
import { useThreadActions } from "@/components/mail/use-thread-actions";
import { useBatchActions } from "@/components/mail/use-batch-actions";
import { usePinToggle } from "@/components/mail/use-pin-toggle";
import { useDeleteForever } from "@/components/mail/use-delete-forever";
import { threadKey } from "@/lib/mail/thread-copies";
import type { MailThreadAction, MailThreadSummary } from "@/lib/mail/types";
import { patchCachedThreads } from "@/components/mail/mail-list-state";
import type { useListData, useListFolders, useListPlace, useListQuery, useListTabsAndPins, useListView, useOutbox, useSelectionPart, useVisibleRows } from "@/components/mail/use-mail-list";
import type { useReaderOpening, useReaderState } from "@/components/mail/use-mail-reader";
import type { usePageSetup } from "@/components/mail/use-page-setup";
import type { useComposeRequests } from "@/components/mail/use-mail-compose";
import type { MailPageProps } from "@/components/mail/use-mail-page";

export function useActionsCore({
  activeFolder,
  folder,
  hiddenRowsRef,
  listCacheKey,
  listViewIdRef,
  loadAbortRef,
  screenThreadOrderRef,
  selected,
  selectedPersonKey,
  setSelected,
  setSnoozedCount,
  setThreads,
  tab,
  threads,
  threadsRef,
  viewMode,
  viewerId,
}: Pick<ReturnType<typeof useListTabsAndPins>, "tab" | "viewMode"> &
  Pick<ReturnType<typeof useReaderState>, "selected" | "selectedPersonKey" | "setSelected"> &
  Pick<ReturnType<typeof useListQuery>, "activeFolder"> &
  Pick<ReturnType<typeof useListView>, "folder"> &
  Pick<ReturnType<typeof useListData>, "hiddenRowsRef" | "listCacheKey" | "listViewIdRef" | "loadAbortRef" | "setSnoozedCount" | "setThreads" | "threads" | "threadsRef"> &
  Pick<ReturnType<typeof useVisibleRows>, "screenThreadOrderRef"> &
  Pick<MailPageProps, "viewerId">) {
  // The open folder's chip takes the counted number and leaves it alone.
  //
  // It does not raise that number to however many threads are loaded.
  // Gmail's label totals lag after a message is filed, but a count by
  // search has no lag. A raise also reads the wrong thing: `threads` still
  // holds the previous view's rows for a moment after a folder opens. A
  // folder holding one thread then shows the inbox's row count, and it
  // stays there for ninety seconds.

  const {
    removeThread,
    openFolderName,
    noteLeftOpenFolder,
    hideRemovedRows,
    unhideRows,
  } = useThreadRemoval({
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
  });
  const {
    pushMailUndo,
    pushBatchUndo,
    dropMailUndo,
    undoLastMailAction,
    hasMailUndo,
  } = useMailUndo({
    viewerId,
    listCacheKey,
    hiddenRowsRef,
    setThreads,
    setSnoozedCount,
  });
  const {
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
    unsnooze,
  } = useThreadActions({
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
    hiddenRowsRef,
    listViewIdRef,
    loadAbortRef,
    setSnoozedCount,
  });
  return { archive, hasMailUndo, hideRemovedRows, isOutlookAccount, markUnread, moveToFolder, moveToInbox, noteLeftOpenFolder, pushBatchUndo, removeThread, restoreFromTrash, setThreadJunk, snooze, toggleRead, trash, undoLastMailAction, unhideRows, unsnooze };
}

export function useActionsMore({
  clearMultiSelection,
  hideRemovedRows,
  inJunkView,
  inTrashView,
  landOnPerson,
  listScrollRef,
  loadThreads,
  noteLeftOpenFolder,
  personRowOrderRef,
  pins,
  pushBatchUndo,
  removeThread,
  selectedPersonKey,
  selectedThreadsNow,
  setSelected,
  setSelectedPersonKey,
  setThreads,
  successorAfterSelection,
  t,
  threads,
  threadsRef,
  unhideRows,
  viewMode,
}: Pick<ReturnType<typeof usePageSetup>, "t"> &
  Pick<ReturnType<typeof useListTabsAndPins>, "pins" | "viewMode"> &
  Pick<ReturnType<typeof useReaderState>, "landOnPerson" | "selectedPersonKey" | "setSelected" | "setSelectedPersonKey"> &
  Pick<ReturnType<typeof useListView>, "inJunkView" | "inTrashView"> &
  Pick<ReturnType<typeof useListData>, "loadThreads" | "setThreads" | "threads" | "threadsRef"> &
  Pick<ReturnType<typeof useVisibleRows>, "listScrollRef" | "personRowOrderRef"> &
  Pick<ReturnType<typeof useActionsCore>, "hideRemovedRows" | "noteLeftOpenFolder" | "pushBatchUndo" | "removeThread" | "unhideRows"> &
  Pick<ReturnType<typeof useSelectionPart>, "clearMultiSelection" | "selectedThreadsNow" | "successorAfterSelection">) {
  const {
    archivePerson,
    trashPerson,
    actOnSelection,
    dragCarriesSelection,
    moveManyToFolder,
  } = useBatchActions({
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
  });
  const {
    personMenuAt,
    setPersonMenuAt,
    personSnooze,
    setPersonSnooze,
    personSnoozeSignal,
    askPersonSnooze,
    onPersonSnoozeOpenChange,
    togglePersonPin,
  } = usePersonMenu();
  const { togglePin, capturePinFlip } = usePinToggle({
    pins,
    listScrollRef,
    t,
  });
  const { purgeFrom, purgeAsk, askDeleteForever, runPurge, cancelPurge } =
    useDeleteForever({
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
    });
  return { actOnSelection, archivePerson, askDeleteForever, askPersonSnooze, cancelPurge, capturePinFlip, dragCarriesSelection, moveManyToFolder, onPersonSnoozeOpenChange, personMenuAt, personSnooze, personSnoozeSignal, purgeAsk, purgeFrom, runPurge, setPersonMenuAt, setPersonSnooze, togglePersonPin, togglePin, trashPerson };
}

export function useRowActions({
  askDeleteForever,
  editAsNewMessage,
  folders,
  hereNow,
  inJunkView,
  inTrashView,
  listCacheKey,
  loadThreads,
  moveToFolder,
  moveToInbox,
  openThread,
  restoreFromTrash,
  setPendingRowAction,
  setSelected,
  setThreadJunk,
  setThreads,
  viewerId,
}: Pick<ReturnType<typeof useReaderState>, "setSelected"> &
  Pick<ReturnType<typeof useListFolders>, "folders"> &
  Pick<ReturnType<typeof useListView>, "inJunkView" | "inTrashView"> &
  Pick<ReturnType<typeof useListData>, "listCacheKey" | "loadThreads" | "setThreads"> &
  Pick<ReturnType<typeof useActionsCore>, "moveToFolder" | "moveToInbox" | "restoreFromTrash" | "setThreadJunk"> &
  Pick<ReturnType<typeof useActionsMore>, "askDeleteForever"> &
  Pick<ReturnType<typeof useComposeRequests>, "editAsNewMessage"> &
  Pick<ReturnType<typeof useReaderOpening>, "openThread" | "setPendingRowAction"> &
  Pick<ReturnType<typeof useListPlace>, "hereNow"> &
  Pick<MailPageProps, "viewerId">) {
  /**
   * Everything the row's menu needs that the list itself cannot answer.
   *
   * One bundle rather than nine props written out twice, because the list
   * is drawn in two places — grouped by date and grouped by person — and
   * two copies of this is two chances for them to drift apart.
   */
  const rowMenuActions = React.useCallback(
    (t: MailThreadSummary) => ({
      onAction: (action: MailThreadAction) => {
        /*
          Edit as new opens no thread. It is a copy of a message taken out
          of its conversation to be sent again as another one, so it goes
          straight to the composer — everything else here is something done
          to the thread, in the thread.
        */
        if (action === "editAsNew") {
          void editAsNewMessage(t);
          return;
        }
        openThread(t);
        setPendingRowAction({
          account: t.account,
          threadId: t.threadId,
          action,
        });
      },
      folders,
      onMoveToFolder: (folderName: string, create: boolean) =>
        moveToFolder(t, folderName, create),
      // Junk is a move, so it lives in the move menu — and only one way
      // round at a time: out of junk from inside it, into junk from
      // anywhere else.
      onJunk:
        inJunkView ? undefined : () => void setThreadJunk(t, true),
      onNotJunk:
        inJunkView ? () => void setThreadJunk(t, false) : undefined,
      onRestore:
        inTrashView ? () => void restoreFromTrash(t) : undefined,
      onDeleteForever: askDeleteForever
        ? () => askDeleteForever([{ account: t.account, threadId: t.threadId }])
        : undefined,
      // The rail's four in the move menu, and where this row is now.
      onMoveToInbox: () => void moveToInbox(t),
      here: hereNow,
    }),
    // `hereNow` is not in the list. It is declared below this callback, and
    // it is a new object on each render. It comes from the tab and the open
    // folder. `openThread` changes with the list key, and `moveToFolder`
    // changes with the rows. A new tab or folder changes the two, so this
    // callback is made again when `hereNow` moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      editAsNewMessage,
      folders,
      moveToFolder,
      moveToInbox,
      openThread,
      restoreFromTrash,
      setThreadJunk,
      inTrashView,
      inJunkView,
      askDeleteForever,
    ]
  );
  /**
   * A thread joined the People pile. Not always the thread on screen: the
   * team layer's dialog stays open while the reader opens other mail.
   */
  const markThreadInPeople = (changed: { account: string; threadId: string }) => {
    const key = threadKey(changed);
    // Optimistically move the thread into People before the list reload.
    setThreads((current) => {
      const next = current.map((t) =>
        threadKey(t) === key ? { ...t, tab: "people" as const } : t
      );
      patchCachedThreads(viewerId, listCacheKey, next);
      return next;
    });
    setSelected((current) =>
      current && threadKey(current) === key ? { ...current, inPeople: true } : current
    );
    // The thread has joined People; which list is being read is a separate
    // question, and the reader answered it. So this does not jump to
    // People. A jump moves anybody working in All or Other onto a filter
    // they did not ask for. With the thread filed away after applying,
    // nothing waits for them there.
    void loadThreads();
  };
  return { markThreadInPeople, rowMenuActions };
}

export function usePageActionsSlice({
  actOnHeld,
  actOnSelection,
  archive,
  archivePerson,
  askDeleteForever,
  askPersonSnooze,
  cancelPurge,
  capturePinFlip,
  dragCarriesSelection,
  markThreadInPeople,
  markUnread,
  moveManyToFolder,
  moveToFolder,
  moveToInbox,
  onPersonSnoozeOpenChange,
  personMenuAt,
  personSnooze,
  personSnoozeSignal,
  purgeAsk,
  purgeFrom,
  restoreFromTrash,
  rowMenuActions,
  runPurge,
  setPersonMenuAt,
  setPersonSnooze,
  setThreadJunk,
  snooze,
  togglePersonPin,
  togglePin,
  toggleRead,
  trash,
  trashPerson,
  unsnooze,
}: Pick<ReturnType<typeof useActionsCore>, "archive" | "markUnread" | "moveToFolder" | "moveToInbox" | "restoreFromTrash" | "setThreadJunk" | "snooze" | "toggleRead" | "trash" | "unsnooze"> &
  Pick<ReturnType<typeof useActionsMore>, "actOnSelection" | "archivePerson" | "askDeleteForever" | "askPersonSnooze" | "cancelPurge" | "capturePinFlip" | "dragCarriesSelection" | "moveManyToFolder" | "onPersonSnoozeOpenChange" | "personMenuAt" | "personSnooze" | "personSnoozeSignal" | "purgeAsk" | "purgeFrom" | "runPurge" | "setPersonMenuAt" | "setPersonSnooze" | "togglePersonPin" | "togglePin" | "trashPerson"> &
  Pick<ReturnType<typeof useOutbox>, "actOnHeld"> &
  Pick<ReturnType<typeof useRowActions>, "markThreadInPeople" | "rowMenuActions">) {
  const actions = useMemoObject({
    actOnHeld, actOnSelection, archive, archivePerson, askDeleteForever, askPersonSnooze,
    cancelPurge, capturePinFlip, dragCarriesSelection, markThreadInPeople, markUnread,
    moveManyToFolder, moveToFolder, moveToInbox, onPersonSnoozeOpenChange, personMenuAt,
    personSnooze, personSnoozeSignal, purgeAsk, purgeFrom, restoreFromTrash, rowMenuActions,
    runPurge, setPersonMenuAt, setPersonSnooze, setThreadJunk, snooze, togglePersonPin, togglePin,
    toggleRead, trash, trashPerson, unsnooze,
  });
  return actions;
}
