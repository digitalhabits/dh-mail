"use client";

/*
 * Opening what the reader clicks, off useMailPage: a thread row, a person
 * row, a row with Shift or Command held, and a double click that opens a
 * window of its own.
 *
 * Owns: `openThread` (and writing it into `openThreadRef`, for handlers
 * made before it), the pending action a row's menu hands to the thread it
 * opens, and the click handlers the list's rows call.
 *
 * Does not own: the selection. It comes in from use-mail-selection.
 *
 * One effect: a thread that becomes the open one by any road is marked
 * read (see `markRowRead`). useMailPage calls this hook where the last of
 * these stood, after everything they read.
 */

import * as React from "react";
import { type PersonRow } from "@/lib/mail/person-participants";
import { toast } from "@/lib/mail/toast";
import {
  openMailPersonWindow,
  openMailThreadWindow,
} from "@/lib/mail/reader-window";
import { everyCopy, rowStandsFor, threadKey } from "@/lib/mail/thread-copies";
import type { MailThreadAction, MailThreadSummary } from "@/lib/mail/types";
import { mailApiJson as apiJson } from "@/lib/mail/api";
import { patchCachedThreads } from "@/components/mail/mail-list-state";

type OpenThread = {
  account: string;
  threadId: string;
  inPeople: boolean;
  focusMessageId?: string;
};

/** How long after an open the store is told the thread is read. */
const MARK_READ_AFTER_OPEN_MS = 3000;

export function useRowOpening({
  listCacheKey,
  threads,
  setThreads,
  threadsRef,
  viewerId,
  setComposing,
  setListExpanded,
  setSelected,
  openThreadRef,
  selected,
  selectedPersonKey,
  selectRowWithModifier,
  clearMultiSelection,
  landOnPerson,
  screenThreadOrderRef,
  personRowOrderRef,
}: {
  listCacheKey: string;
  threads: MailThreadSummary[];
  setThreads: React.Dispatch<React.SetStateAction<MailThreadSummary[]>>;
  threadsRef: React.RefObject<MailThreadSummary[]>;
  viewerId: string;
  setComposing: React.Dispatch<React.SetStateAction<boolean>>;
  setListExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  setSelected: React.Dispatch<React.SetStateAction<OpenThread | null>>;
  openThreadRef: React.RefObject<((t: MailThreadSummary) => void) | null>;
  selected: OpenThread | null;
  selectedPersonKey: string | null;
  selectRowWithModifier: (
    event: React.MouseEvent | undefined,
    rowKey: string,
    anchorKey: string | null,
    order: () => string[]
  ) => boolean;
  clearMultiSelection: () => void;
  landOnPerson: (row?: PersonRow | null) => void;
  screenThreadOrderRef: React.RefObject<MailThreadSummary[]>;
  personRowOrderRef: React.RefObject<PersonRow[]>;
}) {
  const markRowRead = React.useCallback((t: MailThreadSummary) => {
    /**
     * Tell the provider it has been read.
     *
     * Fetching the thread does this too, but only when the fetch is actually
     * made. A thread whose body was prefetched paints straight from the cache
     * and asks the server nothing — the prefetch deliberately passes
     * `markRead=0` so warming a body does not clear unread badges, and the
     * open that follows never sends anything at all. So the read state stayed
     * on this machine, looked right, and the next sync put the bold back.
     * Marking read by hand from the settings menu always worked, because that
     * has an endpoint of its own; opening a thread had none.
     */
    if (t.unread) {
      // Every copy behind the row: a thread cc'd to two mailboxes is one
      // row, unread while either copy is. Marking one read left the row
      // read for a moment and then bold again from the other.
      const copies = everyCopy(t, threadsRef.current);
      /*
        A moment after the open, not at it. The thread opens on the first
        of its new, unread messages, and it can only see which those are
        while they are still unread in the copy. Marked read at the click,
        the store had cleared them before the thread was read, and a long
        thread with three new messages opened on the newest of them (a KU
        tester, 2026-10-10). The row is not bold from the click on: only
        the word to the store waits.
      */
      window.setTimeout(() => {
        // Marked unread again in the meantime: that is the reader's last word.
        if (threadsRef.current.some((item) => rowStandsFor(item, t) && item.unread)) return;
        for (const c of copies) {
          void apiJson("/api/mail/read", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(c),
          }).catch((err) => {
            console.warn("[mail] could not mark the thread read:", err);
          });
        }
      }, MARK_READ_AFTER_OPEN_MS);
    }
    setThreads((current) => {
      const next = current.map((item) =>
        rowStandsFor(item, t) ? { ...item, unread: false } : item
      );
      patchCachedThreads(viewerId, listCacheKey, next);
      return next;
    });
  }, [listCacheKey, setThreads, threadsRef, viewerId]);

  const openThread = React.useCallback((t: MailThreadSummary) => {
    setComposing(false);
    setListExpanded(false);
    setSelected({
      account: t.account,
      threadId: t.threadId,
      inPeople: t.tab === "people",
      focusMessageId: t.focusMessageId,
    });
    markRowRead(t);
  }, [markRowRead, setComposing, setListExpanded, setSelected]);
  openThreadRef.current = openThread;

  /*
    The next thread after a delete, an archive or a move is opened by
    setting the selection, not through `openThread`. It showed, and its
    row kept the unread dot until it was clicked. So any thread that
    becomes the open one is marked read here, once, when it becomes open.
    Only on a change of thread: "Mark as unread" on the open thread keeps
    the selection, and must stay unread. A row already marked by
    `openThread` is read by now, and is not sent twice.
  */
  const markedKeyRef = React.useRef<string | null>(null);
  const selectedKey = selected ? threadKey(selected) : null;
  React.useEffect(() => {
    if (selectedKey === markedKeyRef.current) return;
    markedKeyRef.current = selectedKey;
    if (!selected) return;
    const row = threadsRef.current?.find((t) => rowStandsFor(t, selected));
    if (row?.unread) markRowRead(row);
    // `selected` is read through its key: a new object for the same thread
    // is not a new thread.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, markRowRead, threadsRef]);

  /**
   * What the right-click menu on a row asked the reader to do.
   *
   * Reply, forward, print and pop out all need the messages, and a row has
   * a summary. So the thread is opened and the action travels with it; the
   * reader does it as soon as it has something to do it to, and says so,
   * which clears this. Held with the thread it belongs to, so an action
   * meant for one conversation cannot land on the next one opened.
   */
  const [pendingRowAction, setPendingRowAction] = React.useState<{
    account: string;
    threadId: string;
    action: MailThreadAction;
  } | null>(null);

  const openPerson = React.useCallback(
    (row: PersonRow) => {
      setComposing(false);
      setListExpanded(false);
      landOnPerson(row);
    },
    [landOnPerson, setComposing, setListExpanded]
  );

  /**
   * Two clicks on a person: their mail in a window of its own — the pane
   * this view shows for them, or the one conversation when that is all
   * there is, the way a double-clicked thread opens. The first click has
   * opened them here; the row itself travels with the window, since the
   * window has no list to work them out from. See openMailPersonWindow.
   */
  const openPersonWindow = (row: PersonRow) => {
    clearMultiSelection();
    openPerson(row);
    void openMailPersonWindow(row).catch((err: unknown) => {
      console.error("person window:", err);
      toast.error(
        typeof err === "string" && err
          ? err
          : err instanceof Error
            ? err.message
            : "Couldn't open it"
      );
    });
  };

  /**
   * Two clicks on a thread row: read it in a window of its own.
   *
   * The whole reader — header, actions, reply box — under the system's own
   * title bar, the way Outlook opens a message. It used to put the list
   * away instead, which the expand button on the reader still does. The
   * first click has already opened the thread here; what travels with the
   * window is what the list knows and the window cannot learn — the copies
   * the row stands for, so an archive over there takes what an archive
   * here would, and the snooze for its button.
   */
  const expandThreadRow = React.useCallback(
    (t: MailThreadSummary) => {
      clearMultiSelection();
      openThread(t);
      void openMailThreadWindow({
        account: t.account,
        threadId: t.threadId,
        name: t.fromName,
        email: t.fromEmail,
        subject: t.subject,
        handoff: {
          copies: everyCopy(t, threads),
          snoozedUntil: t.snoozedUntil,
          // Not the row's unread: the first click marked it read.
        },
      }).catch((err: unknown) => {
        // The desktop shell rejects with a plain string — the ACL's own
        // words, or the window builder's — and that string is the one thing
        // worth reading when the window does not come. Show it as it is.
        console.error("reader window:", err);
        toast.error(
          typeof err === "string" && err
            ? err
            : err instanceof Error
              ? err.message
              : "Couldn't open it"
        );
      });
    },
    [clearMultiSelection, openThread, threads]
  );

  /** A click on a thread row, with whatever keys were held. */
  const clickThreadRow = React.useCallback(
    (t: MailThreadSummary, event?: React.MouseEvent) => {
      // The anchor is the row that stands for the open thread — its own
      // key when the row is standing on its other copy would anchor the
      // range to a row the list does not hold.
      const anchorRow = selected
        ? screenThreadOrderRef.current.find((row) =>
            rowStandsFor(row, selected)
          )
        : null;
      const anchorKey = anchorRow
        ? threadKey(anchorRow)
        : selected
          ? threadKey(selected)
          : null;
      const handled = selectRowWithModifier(
        event,
        threadKey(t),
        anchorKey,
        () => screenThreadOrderRef.current.map((row) => threadKey(row))
      );
      if (handled) return;
      clearMultiSelection();
      openThread(t);
    },
    [selected, selectRowWithModifier, clearMultiSelection, openThread, screenThreadOrderRef]
  );

  /** A click on a person row, with whatever keys were held. */
  const clickPersonRow = React.useCallback(
    (row: PersonRow, event?: React.MouseEvent) => {
      const handled = selectRowWithModifier(
        event,
        row.key,
        selectedPersonKey,
        () => personRowOrderRef.current.map((r) => r.key)
      );
      if (handled) return;
      clearMultiSelection();
      openPerson(row);
    },
    [selectedPersonKey, selectRowWithModifier, clearMultiSelection, openPerson, personRowOrderRef]
  );

  return {
    openThread,
    pendingRowAction,
    setPendingRowAction,
    openPersonWindow,
    expandThreadRow,
    clickThreadRow,
    clickPersonRow,
  };
}
