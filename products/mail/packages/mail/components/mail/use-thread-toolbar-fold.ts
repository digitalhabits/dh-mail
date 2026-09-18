"use client";

import * as React from "react";

/**
 * How much of the thread action strip stays on the row.
 *
 * The strip is a measured row, not a guess from the pane width. A labelled
 * chip (attachments, a zoom size) and Reply all change how much fits, and a
 * width in pixels does not see them.
 *
 * Room first, then a tighter gap, then the ellipsis. A wide pane keeps the
 * ordinary spacing. A short pane closes the gaps before it hides a control.
 * What still does not fit goes behind the ellipsis, one control at a time.
 * The order is the one a narrow pane can spare first — looking at the
 * thread, then filing it, then the AI, then read and snooze. Reply,
 * archive, delete, the file chip and focus stay on the row.
 */
export const THREAD_TOOLBAR_SLOTS = [
  "zoom",
  "print",
  "popOut",
  "pin",
  "move",
  "crm",
  "read",
  "snooze",
] as const;

export type ThreadToolbarSlot = (typeof THREAD_TOOLBAR_SLOTS)[number];

/** The slots hidden when the fold has taken this many steps. */
export function hiddenToolbarSlots(
  fold: number,
  slots: readonly ThreadToolbarSlot[] = THREAD_TOOLBAR_SLOTS
): Set<ThreadToolbarSlot> {
  const taken = Math.max(0, Math.min(fold, slots.length));
  return new Set(slots.slice(0, taken));
}

/** True when the row's contents are wider than the box they sit in. */
export function toolbarRowOverflows(row: {
  scrollWidth: number;
  clientWidth: number;
}): boolean {
  return row.scrollWidth > row.clientWidth + 1;
}

/**
 * The same question, from the last child's edge.
 *
 * Some engines report a scrollWidth that matches the box even while a
 * shrink-0 child hangs off the end. The last child's right edge is the
 * thing the reader sees leave the pane.
 */
export function toolbarRowVisuallyOverflows(row: HTMLElement): boolean {
  if (toolbarRowOverflows(row)) return true;
  const last = row.lastElementChild;
  if (!(last instanceof HTMLElement)) return false;
  return (
    last.getBoundingClientRect().right > row.getBoundingClientRect().right + 1
  );
}

/**
 * Measure the action strip and fold what does not fit.
 *
 * `contentKey` names what is on the strip (Reply all, a file chip, junk).
 * When that set changes, a width that was too small a moment ago can fit
 * again, so the last failed step is forgotten.
 *
 * `slots` is the fold order for the controls that are actually on this
 * strip. A public build has no CRM; a thread with no pin has no pin. Those
 * steps are left out so the fold does not take a step that hides nothing.
 */
type ToolbarPack = {
  /** Gaps and circles are one step smaller than the ordinary strip. */
  tight: boolean;
  /** How many slots, from the front of the list, live in the menu. */
  fold: number;
};

function tighterPack(pack: ToolbarPack, maxFold: number): ToolbarPack | null {
  if (!pack.tight) return { tight: true, fold: pack.fold };
  if (pack.fold < maxFold) return { tight: true, fold: pack.fold + 1 };
  return null;
}

function looserPack(pack: ToolbarPack): ToolbarPack | null {
  if (pack.fold > 0) return { tight: pack.tight, fold: pack.fold - 1 };
  if (pack.tight) return { tight: false, fold: 0 };
  return null;
}

function samePack(a: ToolbarPack, b: ToolbarPack): boolean {
  return a.tight === b.tight && a.fold === b.fold;
}

export function useThreadToolbarFold(
  contentKey: string,
  slots: readonly ThreadToolbarSlot[] = THREAD_TOOLBAR_SLOTS
): {
  /** Gaps are closed. Circles are one step smaller. Nothing is hidden yet. */
  tight: boolean;
  fold: number;
  hidden: Set<ThreadToolbarSlot>;
  /** The ellipsis is on the row. */
  showOverflowMenu: boolean;
  setRowNode: (node: HTMLDivElement | null) => void;
} {
  const [pack, setPack] = React.useState<ToolbarPack>({
    tight: false,
    fold: 0,
  });
  const packRef = React.useRef(pack);
  packRef.current = pack;
  const slotsRef = React.useRef(slots);
  slotsRef.current = slots;
  const rejectedRef = React.useRef<(ToolbarPack & { width: number }) | null>(
    null
  );
  const observerRef = React.useRef<ResizeObserver | null>(null);
  const rowRef = React.useRef<HTMLDivElement | null>(null);

  const sync = React.useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    const available = row.clientWidth;
    if (available <= 0) return;
    const current = packRef.current;
    const max = slotsRef.current.length;
    if (toolbarRowVisuallyOverflows(row)) {
      rejectedRef.current = { ...current, width: available };
      const next = tighterPack(current, max);
      if (next) setPack(next);
      return;
    }
    const looser = looserPack(current);
    if (!looser) return;
    const rejected = rejectedRef.current;
    if (
      rejected &&
      samePack(rejected, looser) &&
      available <= rejected.width
    ) {
      return;
    }
    setPack(looser);
  }, []);

  React.useLayoutEffect(() => {
    rejectedRef.current = null;
    setPack({ tight: false, fold: 0 });
  }, [contentKey]);

  // After every paint of this strip: a chip can appear, a pane can move.
  // The sync bails out when the pack is already the one that fits.
  React.useLayoutEffect(() => {
    sync();
  });

  const setRowNode = React.useCallback(
    (node: HTMLDivElement | null) => {
      rowRef.current = node;
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!node) return;
      const observer = new ResizeObserver(() => {
        sync();
      });
      observer.observe(node);
      observerRef.current = observer;
      sync();
    },
    [sync]
  );

  const hidden = hiddenToolbarSlots(pack.fold, slots);
  return {
    tight: pack.tight,
    fold: pack.fold,
    hidden,
    showOverflowMenu: pack.fold > 0,
    setRowNode,
  };
}
