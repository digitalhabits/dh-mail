"use client";

/*
 * The right-click menu on a person in the people view, off MailPage, and
 * the snooze times it opens.
 *
 * Owns: which person's menu is up and where, the thread a "Snooze…" is
 * about and where its times hang, and pinning a person to the top.
 *
 * Does not own: the menu's markup, or what snoozing does. The page draws
 * both, and snoozes through its own `snooze` and `unsnooze`.
 *
 * No effects.
 */

import * as React from "react";

import { toast } from "@/lib/mail/toast";
import { toggleMailPersonPin } from "@/lib/mail/person-pins";
import type { PersonRow } from "@/lib/mail/person-participants";
import type { MailThreadSummary } from "@/lib/mail/types";

export function usePersonMenu() {
  /**
   * The right-click menu on a person: whose row, and where the pointer was.
   *
   * One piece of state for the whole list, because one menu is up at a
   * time. The row itself is looked up when it is drawn, so a list that
   * reloads under an open menu cannot leave it pointing at a stale pile.
   */
  const [personMenuAt, setPersonMenuAt] = React.useState<
    { key: string; x: number; y: number } | null
  >(null);
  /**
   * The thread a "Snooze…" in that menu is about, and where to hang the
   * times. Held apart from the menu because the menu closes as it opens
   * this, and the picker must outlive it.
   */
  const [personSnooze, setPersonSnooze] = React.useState<{
    thread: MailThreadSummary;
    x: number;
    y: number;
  } | null>(null);
  const [personSnoozeSignal, setPersonSnoozeSignal] = React.useState(0);
  /**
   * Whether the times have actually been up yet.
   *
   * The picker reports itself closed once as it mounts, before it has ever
   * been open — and a picker that puts itself away on that report is one
   * that never appears at all.
   */
  const personSnoozeShown = React.useRef(false);
  const askPersonSnooze = React.useCallback(
    (thread: MailThreadSummary, x: number, y: number) => {
      personSnoozeShown.current = false;
      setPersonSnooze({ thread, x, y });
      setPersonSnoozeSignal((n) => n + 1);
    },
    []
  );

  const togglePersonPin = React.useCallback((row: PersonRow) => {
    const pinned = toggleMailPersonPin(row.key);
    toast(pinned ? `${row.name} pinned to the top` : `${row.name} unpinned`);
  }, []);

  /**
   * The picker's own report that it opened or closed. Closed before it was
   * ever shown is its report on mount, and is ignored.
   */
  const onPersonSnoozeOpenChange = React.useCallback((open: boolean) => {
    if (open) {
      personSnoozeShown.current = true;
      return;
    }
    if (!personSnoozeShown.current) return;
    personSnoozeShown.current = false;
    setPersonSnooze(null);
  }, []);

  return {
    personMenuAt,
    setPersonMenuAt,
    personSnooze,
    setPersonSnooze,
    personSnoozeSignal,
    askPersonSnooze,
    onPersonSnoozeOpenChange,
    togglePersonPin,
  };
}
