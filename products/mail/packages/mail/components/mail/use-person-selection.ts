"use client";

/*
 * Which person is selected in the people view, off useMailPage, and the
 * two rules that keep it right: the row that holds the open thread is the
 * selected person, and when the selected person's last conversation goes,
 * the next person opens.
 *
 * Two effects, in the order they ran. useMailPage calls this hook where
 * they stood.
 */

import * as React from "react";
import { successorAfterRemoving } from "@/lib/mail/successor";
import { type PersonRow } from "@/lib/mail/person-participants";
import { rowStandsFor } from "@/lib/mail/thread-copies";

import type { MailViewMode } from "@/components/mail/MailListControls";

type OpenThread = {
  account: string;
  threadId: string;
  inCrm: boolean;
  focusMessageId?: string;
};

export function usePersonSelection({
  viewMode,
  selected,
  personRows,
  selectedPersonKey,
  setSelectedPersonKey,
  landOnPerson,
}: {
  viewMode: MailViewMode;
  selected: OpenThread | null;
  personRows: PersonRow[];
  selectedPersonKey: string | null;
  setSelectedPersonKey: React.Dispatch<React.SetStateAction<string | null>>;
  landOnPerson: (row?: PersonRow | null) => void;
}) {
  /**
   * The open thread names the person row, on this paint.
   *
   * An effect was a frame late: the last person key still sat in state,
   * so the list marked somebody else while the reader kept the thread.
   * When a thread is open, the row that holds it is the selected person.
   */
  const personKeyFromOpenThread =
    viewMode === "people" && selected
      ? (personRows.find((r) =>
          r.threads.some((t) => rowStandsFor(t, selected))
        )?.key ?? null)
      : null;
  const paintedPersonKey = personKeyFromOpenThread ?? selectedPersonKey;
  const selectedPerson = paintedPersonKey
    ? (personRows.find((r) => r.key === paintedPersonKey) ?? null)
    : null;
  React.useLayoutEffect(() => {
    if (!personKeyFromOpenThread) return;
    if (personKeyFromOpenThread === selectedPersonKey) return;
    setSelectedPersonKey(personKeyFromOpenThread);
  }, [personKeyFromOpenThread, selectedPersonKey, setSelectedPersonKey]);
  /**
   * The person who was open has no mail left: open the next one.
   *
   * Archiving or deleting a whole person moves the selection on itself, and
   * always has. Doing it a thread at a time did not: the last conversation
   * with somebody leaves their row with nothing in it, the row goes, and the
   * key in hand names nobody — so the pane empties and the reader is left
   * looking at nothing, mid-pass, with no way to tell whether the last act
   * worked.
   *
   * Here rather than in each action, because every one of them ends the same
   * way — archived, deleted, filed in a folder, marked as junk, or moved by
   * a rule while the reader watched. What matters is that the row went, not
   * which verb sent it.
   */
  const paintedPeopleRef = React.useRef<PersonRow[]>([]);
  React.useEffect(() => {
    const painted = paintedPeopleRef.current;
    paintedPeopleRef.current = personRows;
    if (viewMode !== "people" || !selectedPersonKey) return;
    if (personRows.some((r) => r.key === selectedPersonKey)) return;
    const successor = successorAfterRemoving(
      painted,
      (r) => r.key === selectedPersonKey
    );
    // The painted row names who is next; the live row says what they still
    // have, which is what decides whether a thread opens.
    landOnPerson(
      successor
        ? (personRows.find((r) => r.key === successor.key) ?? successor)
        : null
    );
  }, [viewMode, personRows, selectedPersonKey, landOnPerson]);

  return { paintedPersonKey, selectedPerson };
}
