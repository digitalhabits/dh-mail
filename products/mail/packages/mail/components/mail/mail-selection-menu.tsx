"use client";

/**
 * The right-click menu on a selection of rows.
 *
 * A right-click on a row that is one of two or more selected acts on all of
 * them, as every list does: mark them read or unread, snooze them, pin
 * them, pop them out, archive or delete them. It acted on the one row under
 * the pointer before, which read as the menu ignoring the selection (Ulrik,
 * 2026-10-10).
 *
 * The same menu as a person with several conversations (`PersonRowMenu`):
 * what is offered for a pile is what is offered for a selection. In the
 * thread view the selection is conversations; in the people view it is
 * people, and pinning pins the people, as the hover pin does there.
 */

import * as React from "react";

import { PersonRowMenu } from "@/components/mail/ThreadListRow";
import { SnoozeMenu } from "@/components/mail/SnoozeMenu";
import type { MailPageModel } from "@/components/mail/use-mail-page";
import { isMailPersonPinned } from "@/lib/mail/person-pins";
import { threadKey } from "@/lib/mail/thread-copies";
import type { MailThreadSummary } from "@/lib/mail/types";

export type SelectionMenuAt = { x: number; y: number };

/** Whether a right-click on this row should open the selection's menu. */
export function rowInSelection(m: MailPageModel, rowKey: string): boolean {
  return m.multiKeys.size >= 2 && m.multiKeys.has(rowKey);
}

export function SelectionRowMenu({
  m,
  at,
  onClose,
}: {
  m: MailPageModel;
  at: SelectionMenuAt | null;
  onClose: () => void;
}) {
  const {
    actOnSelection,
    askDeleteForever,
    multiKeys,
    personRows,
    pinKeySet,
    purgeFrom,
    rowMenuActions,
    selectedThreadsNow,
    snooze,
    t,
    togglePersonPin,
    togglePin,
    toggleRead,
    unsnooze,
    viewMode,
  } = m;
  /*
    The times, hung where the menu was. The menu closes as the picker
    opens, so the picker cannot live inside it; the threads are read when
    the menu is used, and kept for the picker.
  */
  const [snoozing, setSnoozing] = React.useState<{
    threads: MailThreadSummary[];
    x: number;
    y: number;
  } | null>(null);
  const [snoozeSignal, setSnoozeSignal] = React.useState(0);
  /*
    Whether the times have been up yet. The picker reports itself closed
    once as it mounts, and a picker that went away on that report would
    never appear — the same guard as the person menu's (use-person-menu).
  */
  const snoozeShown = React.useRef(false);

  const people = viewMode === "people";
  const rows = people ? personRows.filter((row) => multiKeys.has(row.key)) : [];

  const picker = snoozing ? (
    <SnoozeMenu
      onSnooze={(untilIso) => {
        for (const thread of snoozing.threads) void snooze(thread, untilIso);
        setSnoozing(null);
      }}
      openSignal={snoozeSignal}
      onCancelSnooze={
        snoozing.threads.some((th) => th.snoozedUntil)
          ? () => {
              for (const th of snoozing.threads) if (th.snoozedUntil) void unsnooze(th);
              setSnoozing(null);
            }
          : undefined
      }
      onOpenChange={(open) => {
        if (open) {
          snoozeShown.current = true;
          return;
        }
        if (!snoozeShown.current) return;
        snoozeShown.current = false;
        setSnoozing(null);
      }}
      trigger={
        <span
          aria-hidden
          className="fixed h-px w-px"
          style={{ left: snoozing.x, top: snoozing.y }}
        />
      }
    />
  ) : null;

  if (!at) return picker;
  const threads = selectedThreadsNow();
  if (!threads.length) return picker;

  // Pinned when every one is: then the line takes the pins off; otherwise
  // it pins the ones that are not.
  const allPinned = people
    ? rows.every((row) => isMailPersonPinned(row.key))
    : threads.every((th) => pinKeySet.has(threadKey(th)));
  const togglePins = () => {
    if (people) {
      for (const row of rows) {
        if (allPinned || !isMailPersonPinned(row.key)) togglePersonPin(row);
      }
      return;
    }
    for (const th of threads) {
      if (allPinned || !pinKeySet.has(threadKey(th))) togglePin(th);
    }
  };
  // A person pops out as their newest conversation, as their own menu does.
  const popOut = () => {
    const each = people ? rows.map((row) => row.threads[0]).filter(Boolean) : threads;
    for (const th of each) rowMenuActions(th).onAction("popOut");
  };
  const count = threads.length;

  return (
    <>
      <PersonRowMenu
        x={at.x}
        y={at.y}
        name={t("conversationsMany", { count })}
        count={count}
        unread={threads.some((th) => th.unread)}
        pinned={allPinned}
        snoozed={threads.some((th) => th.snoozedUntil)}
        onToggleRead={() => void toggleRead(threads, t("conversationsMany", { count }))}
        onSnooze={() => {
          snoozeShown.current = false;
          setSnoozing({ threads, x: at.x, y: at.y });
          setSnoozeSignal((n) => n + 1);
        }}
        onCancelSnooze={() => {
          for (const th of threads) if (th.snoozedUntil) void unsnooze(th);
        }}
        onTogglePin={togglePins}
        onPopOut={popOut}
        // In Trash the mail is deleted already: only "forever" is left.
        onArchiveAll={purgeFrom === "trash" ? undefined : () => void actOnSelection("archive")}
        onDeleteAll={purgeFrom === "trash" ? undefined : () => void actOnSelection("trash")}
        onDeleteForever={askDeleteForever ? () => askDeleteForever(threads) : undefined}
        onDismiss={onClose}
      />
      {picker}
    </>
  );
}
