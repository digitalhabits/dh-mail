"use client";

/*
 * Opening a row of the Drafts view, and the next row when a draft goes.
 *
 * In the inbox a delete lands on the conversation below (see
 * lib/mail/successor.ts). The Drafts view used to drop to the empty pane
 * instead, so a reader clearing out old drafts had to click each next one.
 * Now a discarded draft opens the one below it, or the one above at the end
 * of the list, by the same rule.
 *
 * No state of its own: the page's setters come in, and the rows are the ones
 * the Drafts list paints, in the same order.
 */

import { draftRowKey, hideDraftRows, unhideDraftRows } from "@/components/mail/draft-selection-store";
import { isComposeDraftKey } from "@/lib/mail/local-drafts";
import { DISCARD_UNDO_MS } from "@/lib/mail/pending-discard";
import { successorAfterRemoving } from "@/lib/mail/successor";
import type { MailDraftRow } from "@/lib/mail/types";

export type DraftOpeners = {
  setSelected: (
    open: { account: string; threadId: string; inPeople: boolean } | null
  ) => void;
  setSelectedPersonKey: (key: string | null) => void;
  startCompose: (seed: {
    to: string[];
    subject: string;
    continuedFromLabel: string;
    draftKey?: string;
    keepFocus?: boolean;
  }) => void;
  closeCompose: () => void;
};

/** True for a row that has no thread to open — a new message, not a reply. */
export function isStandaloneDraft(row: MailDraftRow): boolean {
  if (row.origin === "here") return isComposeDraftKey(row.id);
  return !row.threadId;
}

/**
 * Whose drafts the view shows. A Drafts row under an account in the rail
 * names one mailbox; otherwise the mailbox tabs decide (`picked`, or null
 * when they pick all), as they do for every other list. The tabs were not
 * read here first, so with one mailbox picked the Drafts view still listed
 * every mailbox's drafts.
 */
export function draftsScope(
  activeFolder: { role?: string | null; account?: string | null } | null,
  picked: string[] | null
): string | string[] | null {
  if (activeFolder?.role === "drafts" && activeFolder.account) return activeFolder.account;
  return picked;
}

/**
 * The rows the Drafts view shows: every mailbox's, or those in scope, and
 * only those the search box matches. The scope is one mailbox (a Drafts row
 * under an account in the rail), the mailboxes the tabs have picked, or null
 * for all of them.
 *
 * The box says "Search drafts", and typing in it filtered nothing. Every
 * word typed has to be found somewhere in the row — the subject, the
 * recipients, the text, or the mailbox — in any case.
 */
export function draftsInView(
  drafts: MailDraftRow[],
  draftsAccount: string | readonly string[] | null,
  search = ""
): MailDraftRow[] {
  const scope = draftsAccount == null ? null : typeof draftsAccount === "string" ? [draftsAccount] : draftsAccount;
  const accounts = scope ? new Set(scope.map((a) => a.toLowerCase())) : null;
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  return drafts.filter((row) => {
    if (accounts && !accounts.has(row.account.toLowerCase())) return false;
    if (!words.length) return true;
    const text = [row.subject, row.snippet, row.account, ...row.to]
      .join(" ")
      .toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/**
 * The row of the draft that is open, by its id, for the list to mark.
 *
 * A new message is open by its key. A reply is open by its thread — and its
 * row's id is the draft's key, not the thread's id, so matching the two
 * marked no reply draft as open at all.
 */
export function openDraftRowId(
  rows: MailDraftRow[],
  open: {
    composeKey: string | null;
    thread: { account: string; threadId: string } | null;
    /**
     * The row last opened, by a click or the arrow keys. Several drafts can
     * belong to one thread (a reply written here, and the provider's own),
     * and the thread alone names the first of them: the list marked that
     * one, and Down went on from there, back up the list. The row picked
     * wins while it is still the one open.
     */
    chosen?: string | null;
  }
): string | null {
  const picked = open.chosen ? rows.find((row) => row.id === open.chosen) : undefined;
  if (picked) {
    if (open.composeKey ? picked.id === open.composeKey : open.thread && isThreadDraftRow(picked, open.thread)) {
      return picked.id;
    }
  }
  if (open.composeKey) {
    return rows.find((row) => row.id === open.composeKey)?.id ?? null;
  }
  const thread = open.thread;
  if (!thread) return null;
  return rows.find((row) => isThreadDraftRow(row, thread))?.id ?? null;
}

/**
 * Open one draft.
 *
 * A reply opens its thread, where the composer picks the draft up — ours
 * from IndexedDB, the provider's from the thread itself. A new message has
 * no thread worth reading, so it opens straight into a composer on its own
 * key. A provider draft that is not a reply still belongs to a thread of its
 * own; opening it shows an empty thread with the draft in the composer.
 */
export function openDraftRow(
  row: MailDraftRow,
  open: DraftOpeners,
  /** From the arrow keys: the caret stays in the list, for the next press. */
  options: { keepFocus?: boolean } = {}
): void {
  if (row.threadId && !isStandaloneDraft(row)) {
    openDraftThread(row.account, row.threadId, open);
    return;
  }
  if (row.origin === "here") {
    open.startCompose({
      to: row.to,
      subject: row.subject,
      continuedFromLabel: "",
      draftKey: row.id,
      ...(options.keepFocus ? { keepFocus: true } : {}),
    });
    return;
  }
  if (row.threadId) openDraftThread(row.account, row.threadId, open);
}

function openDraftThread(
  account: string,
  threadId: string,
  open: DraftOpeners
): void {
  // A composer on screen hides the thread, so it closes first.
  open.closeCompose();
  open.setSelectedPersonKey(null);
  open.setSelected({ account, threadId, inPeople: false });
}

/**
 * After a draft is discarded: open the row below it, or the one above.
 *
 * `rows` is the list as it was before the discard, so the gone row is still
 * in it and marks the place. One thread can stand in two rows — our draft
 * and the provider's — and both go with it, so the rows that went are taken
 * out before the successor is chosen. With no other draft left the pane
 * empties.
 */
export function openDraftAfter(
  rows: MailDraftRow[],
  isGone: (row: MailDraftRow) => boolean,
  open: DraftOpeners,
  accounts?: readonly string[]
): void {
  // The first row that went stays as the marker of the place; the others
  // are dropped, so neither neighbour can be one of them. Nor can a reply
  // whose mailbox is not connected: it would open to an error.
  const marker = rows.find(isGone);
  const kept = rows.filter(
    (row) => row === marker || (!isGone(row) && draftOpensHere(row, accounts))
  );
  const next = successorAfterRemoving(kept, (row) => row === marker);
  if (next) {
    openDraftRow(next, open);
    return;
  }
  open.closeCompose();
  open.setSelected(null);
}

/**
 * Whether a row can open in this window. A reply opens its thread, which
 * needs its mailbox connected; a new message opens in a composer of its own.
 * Without the list of mailboxes every row counts as openable.
 */
export function draftOpensHere(
  row: MailDraftRow,
  accounts?: readonly string[]
): boolean {
  if (!accounts || !row.threadId || isStandaloneDraft(row)) return true;
  const account = row.account.toLowerCase();
  return accounts.some((a) => a.toLowerCase() === account);
}

/** The row a reply draft stands for: its thread, in its mailbox. */
export function isThreadDraftRow(
  row: MailDraftRow,
  thread: { account: string; threadId: string }
): boolean {
  return (
    row.threadId === thread.threadId &&
    row.account.toLowerCase() === thread.account.toLowerCase()
  );
}

/** The provider's draft behind this thread, as the Drafts list has it. */
export function providerDraftRefFor(
  rows: MailDraftRow[],
  thread: { account: string; threadId: string }
): string | undefined {
  return rows.find((row) => row.origin !== "here" && isThreadDraftRow(row, thread))?.id;
}

/**
 * After a reply draft is discarded in the Drafts view: its rows go at once,
 * the next draft opens, and the list is read again once the Undo has run
 * out.
 *
 * The provider's copy is only told to go when the Undo runs out, so its row
 * would stand until then. It comes back on that second reading only if the
 * reader took the discard back.
 */
export function landAfterThreadDraftDiscarded(input: {
  rows: MailDraftRow[];
  thread: { account: string; threadId: string };
  open: DraftOpeners;
  refresh: () => void;
  accounts?: readonly string[];
}): void {
  const isGone = (row: MailDraftRow) => isThreadDraftRow(row, input.thread);
  const gone = input.rows.filter(isGone).map(draftRowKey);
  hideDraftRows(gone);
  window.setTimeout(() => {
    unhideDraftRows(gone);
    input.refresh();
  }, DISCARD_UNDO_MS + 3_000);
  openDraftAfter(input.rows, isGone, input.open, input.accounts);
  input.refresh();
}

/**
 * The number at the head of the rail beside "Drafts": the drafts of the
 * mailboxes the tabs picked (null: every tab), as the Drafts view shows
 * them. It counted every mailbox's (found in the KU test, 2026-09-26).
 */
export function draftCountForTabs(drafts: MailDraftRow[], picked: string[] | null): number | null {
  return draftsInView(drafts, picked).length || null;
}

