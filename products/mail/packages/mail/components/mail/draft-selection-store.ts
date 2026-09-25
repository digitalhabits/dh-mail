/*
 * Selecting more than one draft in the Drafts view.
 *
 * The inbox has had this: Shift-click takes a range, Cmd-click adds a row or
 * takes it out. The Drafts list opened one draft per click and nothing more.
 * The rules are the inbox's own (lib/mail/multi-select.ts); this holds the
 * state, because the list and the reading pane both need it and the page's
 * model has no room left for it.
 *
 * Also held here: the rows being discarded. A draft at Gmail or Outlook is
 * only told to go once the Undo has run out, so the list hides those rows
 * until then, and shows them again on Undo.
 */

import { nextMultiSelection } from "@/lib/mail/multi-select";
import type { MailDraftRow } from "@/lib/mail/types";

export type DraftSelection = {
  /** More than one means the selection pane; one or none means a draft is open. */
  keys: ReadonlySet<string>;
  /** The row the next Shift-click counts from. */
  anchor: string | null;
  /** Rows gone from view while their discard waits. */
  hidden: ReadonlySet<string>;
};

let state: DraftSelection = { keys: new Set(), anchor: null, hidden: new Set() };
const listeners = new Set<() => void>();

function set(next: Partial<DraftSelection>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** For the hook in draft-selection.ts, and for a suite. */
export function subscribeDraftSelection(listener: () => void): () => void {
  return subscribe(listener);
}

export function draftSelectionNow(): DraftSelection {
  return state;
}

/** One row's key, the same the list keys its rows by. */
export function draftRowKey(row: MailDraftRow): string {
  return `${row.origin}:${row.id}`;
}

/**
 * A click on a row. Returns true when it was a plain click, and the caller
 * opens the draft; false when it changed a selection of several.
 *
 * `openKey` is the row open now. It stands in as the anchor when none was
 * set, so a Shift-click after a draft opened by itself — the next one after
 * a discard — counts from that draft.
 */
export function clickDraftRow(
  row: MailDraftRow,
  modifiers: { shift: boolean; toggle: boolean },
  order: () => string[],
  openKey: string | null
): boolean {
  const key = draftRowKey(row);
  if (!modifiers.shift && !modifiers.toggle) {
    set({ keys: new Set(), anchor: key });
    return true;
  }
  // An anchor no longer in the list — the draft was discarded, and the
  // next one opened by itself — gives way to the draft that is open.
  const anchor =
    state.anchor && order().includes(state.anchor) ? state.anchor : openKey;
  const keys = nextMultiSelection(
    new Set(state.keys),
    key,
    anchor,
    modifiers.shift,
    order
  );
  set({ keys, anchor: modifiers.shift ? anchor : key });
  return false;
}

export function clearDraftSelection(): void {
  if (!state.keys.size) return;
  set({ keys: new Set() });
}

export function hideDraftRows(keys: readonly string[]): void {
  set({ hidden: new Set([...state.hidden, ...keys]) });
}

export function unhideDraftRows(keys: readonly string[]): void {
  const hidden = new Set(state.hidden);
  for (const key of keys) hidden.delete(key);
  set({ hidden });
}
