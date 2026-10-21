"use client";

/*
 * The reader concern of the mail page: which thread or person is open, and
 * the ways to open one.
 *
 * Each `use…` here is one part of useMailPage, called where its hooks always
 * ran, so the effects keep their order. `usePageReaderSlice` makes the slice
 * that components read with `usePageReader` (mail-page-slices.tsx). See
 * docs/mail-ui-structure.md.
 */

import * as React from "react";
import { type PersonRow } from "@/lib/mail/person-participants";
import { isChatPopoutOpen } from "@/lib/native-shell";
import { useMemoObject } from "@/components/mail/use-memo-object";
import { useRowOpening } from "@/components/mail/use-row-opening";
import { usePersonSelection } from "@/components/mail/use-person-selection";
import { rowStandsFor } from "@/lib/mail/thread-copies";
import type { MailThreadSummary } from "@/lib/mail/types";
import { believedPopoutKeys, setOpenPopoutKeys } from "@/lib/mail/popout";
import type { useListData, useListPeople, useListTabsAndPins, useSelectionPart, useVisibleRows } from "@/components/mail/use-mail-list";
import type { useComposeState } from "@/components/mail/use-mail-compose";
import type { useListSpace } from "@/components/mail/use-mail-page-layout";
import type { MailPageProps } from "@/components/mail/use-mail-page";

export function useReaderState() {
  // Which person digest is open in the reading pane (People view only).
  const [selectedPersonKey, setSelectedPersonKey] = React.useState<
    string | null
  >(null);
  const [selected, setSelected] = React.useState<{
    account: string;
    threadId: string;
    /** Whether participants already match known contacts (the People pile). */
    inPeople: boolean;
    /** Search hit message id — open the thread centered on it. */
    focusMessageId?: string;
  } | null>(null);
  // Keep the open thread's People flag in sync after a change or a refresh.
  const reconcileSelection = React.useCallback(
    (rows: MailThreadSummary[]) => {
      setSelected((current) => {
        if (!current) return current;
        // By what the row stands for, not its key: the open thread keeps
        // matching its row when a refresh leaves the row standing on the
        // conversation's other copy. The identity is left alone — a
        // repoint would remount the reader under someone mid-read.
        const next = rows.find((t) => rowStandsFor(t, current));
        if (!next) return current;
        const inPeople = next.tab === "people";
        return current.inPeople === inPeople ? current : { ...current, inPeople };
      });
    },
    []
  );
  /** Held in a ref: the handlers that open a thread are made before it is. */
  const openThreadRef = React.useRef<
    ((t: MailThreadSummary) => void) | null
  >(null);
  /**
   * Land on a person, wherever the reader came from.
   *
   * One thread is not a choice to make: the person pane is a list of what
   * is open with somebody, and a list of one is a card standing in front of
   * the only thing behind it. So a single thread opens in the place of the
   * pane, and the pane is kept for the people there is something to
   * choose between.
   *
   * The rule is here, not in the click handler alone. If only a click
   * applies it, it fails when the app moves the selection itself. After an
   * archive or a delete of the open person, the next one comes up as a card
   * to click, even with a single thread. Same landing, same rule, whoever
   * asked for it.
   */
  const landOnPerson = React.useCallback((row?: PersonRow | null) => {
    setSelectedPersonKey(row ? row.key : null);
    // The person stays marked in the list, and the thread renders: the
    // reading pane asks about an open thread before it asks about a person.
    if (row && row.threads.length === 1) openThreadRef.current?.(row.threads[0]);
    else setSelected(null);
  }, []);
  return { landOnPerson, openThreadRef, reconcileSelection, selected, selectedPersonKey, setSelected, setSelectedPersonKey };
}

export function usePopoutWatch() {
  /*
    Which chat windows are really still open.

    The shell's window list is the truth, and it cannot be asked once per
    row on every repaint — so the threads this window popped out are kept
    (see `notePopoutOpened`) and checked against the shell whenever this
    window comes back to the front. Closing a chat hands focus here, which
    makes that the moment the answer changes. A handful of keys, so a
    handful of calls; outside the desktop app every answer is no and the
    set empties itself on the first pass.
  */
  React.useEffect(() => {
    let live = true;
    const check = async () => {
      const keys = believedPopoutKeys();
      if (!keys.length) return;
      const open = new Set<string>();
      for (const key of keys) {
        const at = key.indexOf("|");
        if (at < 0) continue;
        const account = key.slice(0, at);
        const threadId = key.slice(at + 1);
        if (await isChatPopoutOpen({ account, threadId })) open.add(key);
      }
      if (live) setOpenPopoutKeys(open);
    };
    void check();
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => {
      live = false;
      window.removeEventListener("focus", onFocus);
    };
  }, []);
}

export function useReaderOpening({
  clearMultiSelection,
  landOnPerson,
  listCacheKey,
  openThreadRef,
  personRowOrderRef,
  personRows,
  screenThreadOrderRef,
  selectRowWithModifier,
  selected,
  selectedPersonKey,
  setComposing,
  setListExpanded,
  setSelected,
  setSelectedPersonKey,
  setThreads,
  threads,
  threadsRef,
  viewMode,
  viewerId,
}: Pick<ReturnType<typeof useListTabsAndPins>, "viewMode"> &
  Pick<ReturnType<typeof useReaderState>, "landOnPerson" | "openThreadRef" | "selected" | "selectedPersonKey" | "setSelected" | "setSelectedPersonKey"> &
  Pick<ReturnType<typeof useListData>, "listCacheKey" | "setThreads" | "threads" | "threadsRef"> &
  Pick<ReturnType<typeof useComposeState>, "setComposing"> &
  Pick<ReturnType<typeof useListSpace>, "setListExpanded"> &
  Pick<ReturnType<typeof useVisibleRows>, "personRowOrderRef" | "screenThreadOrderRef"> &
  Pick<ReturnType<typeof useSelectionPart>, "clearMultiSelection" | "selectRowWithModifier"> &
  Pick<ReturnType<typeof useListPeople>, "personRows"> &
  Pick<MailPageProps, "viewerId">) {
  const { paintedPersonKey, selectedPerson } = usePersonSelection({
    viewMode,
    selected,
    personRows,
    selectedPersonKey,
    setSelectedPersonKey,
    landOnPerson,
  });
  /**
   * The open thread's row in the list, when the list holds one.
   *
   * It carries the state the reader's own actions need to read — whether the
   * thread is unread, when it is snoozed until. A thread reached from a search
   * hit or a deep link can be open without being in the list at all.
   */
  const selectedRow = selected
    ? (threads.find((t) => rowStandsFor(t, selected)) ?? null)
    : null;
  const {
    openThread,
    pendingRowAction,
    setPendingRowAction,
    openPersonWindow,
    expandThreadRow,
    clickThreadRow,
    clickPersonRow,
  } = useRowOpening({
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
  });
  return { clickPersonRow, clickThreadRow, expandThreadRow, openPersonWindow, openThread, paintedPersonKey, pendingRowAction, selectedPerson, selectedRow, setPendingRowAction };
}

export function usePageReaderSlice({
  clickPersonRow,
  clickThreadRow,
  expandThreadRow,
  openPersonWindow,
  openThread,
  paintedPersonKey,
  pendingRowAction,
  selected,
  selectedPerson,
  selectedRow,
  setPendingRowAction,
  setSelected,
  setSelectedPersonKey,
}: Pick<ReturnType<typeof useReaderState>, "selected" | "setSelected" | "setSelectedPersonKey"> &
  Pick<ReturnType<typeof useReaderOpening>, "clickPersonRow" | "clickThreadRow" | "expandThreadRow" | "openPersonWindow" | "openThread" | "paintedPersonKey" | "pendingRowAction" | "selectedPerson" | "selectedRow" | "setPendingRowAction">) {
  const reader = useMemoObject({
    selected, setSelected, selectedRow, selectedPerson, setSelectedPersonKey, paintedPersonKey,
    openThread, pendingRowAction, setPendingRowAction, openPersonWindow, expandThreadRow,
    clickThreadRow, clickPersonRow,
  });
  return reader;
}
