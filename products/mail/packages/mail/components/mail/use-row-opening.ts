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
 * No effects. useMailPage calls this hook where the last of these stood,
 * after everything they read.
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
  inCrm: boolean;
  focusMessageId?: string;
};

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
  const openThread = React.useCallback((t: MailThreadSummary) => {
    setComposing(false);
    setListExpanded(false);
    setSelected({
      account: t.account,
      threadId: t.threadId,
      inCrm: t.tab === "people",
      focusMessageId: t.focusMessageId,
    });
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
      for (const c of everyCopy(t, threadsRef.current)) {
        void apiJson("/api/mail/read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(c),
        }).catch((err) => {
          console.warn("[mail] could not mark the thread read:", err);
        });
      }
    }
    setThreads((current) => {
      const next = current.map((item) =>
        rowStandsFor(item, t) ? { ...item, unread: false } : item
      );
      patchCachedThreads(viewerId, listCacheKey, next);
      return next;
    });
  }, [listCacheKey, setThreads, threadsRef, viewerId, setComposing, setListExpanded, setSelected]);
  openThreadRef.current = openThread;

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
