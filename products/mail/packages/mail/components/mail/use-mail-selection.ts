"use client";

/*
 * More than one row at a time, off MailPage.
 *
 * Shift-click takes everything between the open row and the one clicked;
 * Cmd-click adds one row, or takes it out again. The keys are thread keys
 * in the thread view and person keys in the people view — one set serves
 * both, because the two views are never on screen together.
 *
 * The open row is the anchor and stays open underneath. Nothing else is
 * opened by extending a selection: opening marks a thread read, and a
 * reader sweeping thirty rows to archive them has not read thirty rows.
 *
 * Owns: the set of selected keys, and the questions asked of it (how many,
 * which threads, where to land after them). The rules themselves are pure
 * functions in `lib/mail/multi-select.ts`, which has its own suite.
 *
 * Does not own: what is done to a selection. Archive and delete of the
 * selection stay with the other thread actions, and call
 * `selectedThreadsNow`, `successorAfterSelection` and `clearMultiSelection`.
 *
 * One effect: a new view, folder or search clears the selection. The page
 * calls this hook where that effect always stood.
 *
 * The painted order is read from the page's refs at the moment of acting,
 * because that is the list the selection was made on.
 */

import * as React from "react";

import type { MailViewMode } from "@/components/mail/MailListControls";
import {
  nextMultiSelection,
  rowAfterSelection,
  selectedInOrder,
} from "@/lib/mail/multi-select";
import type { PersonRow } from "@/lib/mail/person-participants";
import { threadKey } from "@/lib/mail/thread-copies";
import type { MailThreadSummary } from "@/lib/mail/types";

export function useMailSelection({
  viewMode,
  listCacheKey,
  screenThreadOrderRef,
  personRowOrderRef,
}: {
  viewMode: MailViewMode;
  listCacheKey: string;
  /** The threads as painted: pins band, then the list. */
  screenThreadOrderRef: React.RefObject<MailThreadSummary[]>;
  /** The people rows as painted, in the people view. */
  personRowOrderRef: React.RefObject<PersonRow[]>;
}) {
  const [multiKeys, setMultiKeys] = React.useState<Set<string>>(
    () => new Set()
  );
  const clearMultiSelection = React.useCallback(() => {
    setMultiKeys((current) => (current.size ? new Set() : current));
  }, []);
  // A new view, folder or search is a new list; a selection made in the old
  // one would name rows that are no longer there.
  React.useEffect(() => {
    clearMultiSelection();
  }, [viewMode, listCacheKey, clearMultiSelection]);

  /**
   * A click with Shift or Cmd held. Returns true when it changed the
   * selection, and the caller then opens nothing.
   */
  const selectRowWithModifier = React.useCallback(
    (
      event: React.MouseEvent | undefined,
      rowKey: string,
      anchorKey: string | null,
      order: () => string[]
    ): boolean => {
      if (!event) return false;
      const extend = event.shiftKey;
      const toggle = event.metaKey || event.ctrlKey;
      if (!extend && !toggle) return false;
      event.preventDefault();
      setMultiKeys((current) =>
        nextMultiSelection(current, rowKey, anchorKey, extend, order)
      );
      return true;
    },
    []
  );

  /**
   * The threads a selection stands for, whichever view made it.
   *
   * In the people view a selected person is every open thread with them,
   * which is what archiving or deleting the person means.
   */
  const selectedThreadsNow = React.useCallback((): MailThreadSummary[] => {
    if (multiKeys.size < 2) return [];
    if (viewMode === "people") {
      return personRowOrderRef.current
        .filter((row) => multiKeys.has(row.key))
        .flatMap((row) => row.threads);
    }
    // The painted order, pins band included — the same list the selection
    // was made on. Read at the moment of acting, which is the only moment it
    // is needed.
    return selectedInOrder(screenThreadOrderRef.current, multiKeys, threadKey);
  }, [multiKeys, viewMode, personRowOrderRef, screenThreadOrderRef]);

  /** How many rows are selected — threads or people, as the view has it. */
  const multiSelectedCount = multiKeys.size >= 2 ? multiKeys.size : 0;

  /**
   * Where to land once the selected rows are gone: the first row after the
   * last selected one that is not itself selected, else the last before.
   * Worked out before anything is removed, from the painted order, for the
   * same reason `removeThread` does.
   */
  const successorAfterSelection = React.useCallback(
    (): MailThreadSummary | null =>
      rowAfterSelection(screenThreadOrderRef.current, (t) =>
        multiKeys.has(threadKey(t))
      ),
    [multiKeys, screenThreadOrderRef]
  );

  return {
    multiKeys,
    multiSelectedCount,
    clearMultiSelection,
    selectRowWithModifier,
    selectedThreadsNow,
    successorAfterSelection,
  };
}
