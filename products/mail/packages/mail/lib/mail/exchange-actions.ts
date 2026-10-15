/**
 * The actions on an Exchange (EWS) thread: read, unread, flag, archive,
 * move, trash, junk, and delete forever (phase 3 of
 * `docs/mail-exchange-ews.md`, section 12).
 *
 * An action names a thread. The local copy says which items of the thread
 * are in which folder, by the label the worker gave each row
 * (`exchangeLabelFor`). Each action takes only the items it is about (the
 * table in section 12.2).
 *
 * Read, flag, archive, trash, junk and a move change the copy at once and
 * wait in the queue for the server (`exchange-queue.ts`), so they work with
 * no network. Delete forever and snooze go to the server first, then to the
 * copy: the one cannot be undone, and the other moves to a folder the app
 * makes.
 *
 * A move gets the new id of each item in the answer (`ReturnNewItemIds`),
 * so the row takes its new id at once: no hold as for Graph
 * (`outlook-moves.ts`).
 */

import {
  deleteExchangeForever,
  moveExchangeItems,
  type ExchangeFailure,
} from "@/lib/mail/exchange-native";
import {
  exchangeFolderRows,
  exchangeLabelFor,
  readExchangeFolders,
  type ExchangeFolderState,
} from "@/lib/mail/exchange-folders";
import { asRow, cancelExchangeInverse, queueExchangeAction, QUEUED_EXCHANGE_KINDS, relabel } from "@/lib/mail/exchange-queue";
import { wakeExchangeSync } from "@/lib/mail/exchange-sync";
import { invalidateInboxCache } from "@/lib/mail/inbox-cache";
import { notifySyncChanged } from "@/lib/mail/local-store";
import { resolveMailProvider } from "@/lib/mail/providers";
import { mailStore } from "@/lib/mail/store";
import type { MailStoredMessage } from "@/lib/mail/store/types";

export type ExchangeActionKind =
  | "read"
  | "unread"
  | "star"
  | "unstar"
  | "archive"
  | "unarchive"
  | "trash"
  | "untrash"
  | "junk"
  | "notjunk"
  | "move"
  | "unmove"
  | "snooze"
  | "deleteForever";

type Row = MailStoredMessage;

/** The labels the worker gives the managed folders. */
const MANAGED = new Set(["INBOX", "SENT", "DRAFT", "TRASH", "SPAM"]);

/** Where a thread's items are, and where the folders are. */
export type ThreadPlace = {
  rows: Row[];
  /** Folder id by the label its rows wear. Archive is under "". */
  folderOf: Map<string, string>;
  /** Folder id by EWS name, for the managed folders. */
  wellKnown: Record<string, string>;
  /**
   * Folder id by path, in lower case, as the rail names folders. A drop on
   * "Inbox" under the account names the folder by path, and the Inbox's rows
   * wear INBOX, not "Inbox".
   */
  byPath: Map<string, string>;
};

/** The folder label of a row: its first folder label, or "" for Archive. */
export function folderLabelOf(row: Row, folderOf: Map<string, string>): string {
  return row.labels.find((l) => l !== "STARRED" && (MANAGED.has(l) || folderOf.has(l))) ?? "";
}

export function placeOf(tree: ExchangeFolderState, rows: Row[]): ThreadPlace {
  const folderOf = new Map<string, string>();
  const byPath = new Map<string, string>();
  for (const folder of exchangeFolderRows(tree)) {
    folderOf.set(exchangeLabelFor(folder) ?? "", folder.id);
    byPath.set(folder.path.toLowerCase(), folder.id);
  }
  return { rows, folderOf, wellKnown: tree.wellKnown, byPath };
}

function newest(rows: Row[]): Row[] {
  const sorted = [...rows].sort((a, b) => b.sentAt - a.sentAt);
  return sorted.length ? [sorted[0]] : [];
}

/** The items an action is about, from the table in section 12.2. */
export function itemsFor(kind: ExchangeActionKind, place: ThreadPlace, payload: Record<string, unknown> = {}): Row[] {
  const where = (row: Row) => folderLabelOf(row, place.folderOf);
  const inAny = (...labels: string[]) => place.rows.filter((r) => labels.includes(where(r)));
  const notIn = (...labels: string[]) => place.rows.filter((r) => !labels.includes(where(r)));
  switch (kind) {
    case "read":
      return place.rows.filter((r) => r.unread);
    case "unread":
      return newest(place.rows);
    case "star":
      return newest(place.rows);
    case "unstar":
      return place.rows.filter((r) => r.starred);
    case "archive":
    case "junk":
    case "snooze":
      return inAny("INBOX");
    case "unarchive":
      return inAny("");
    case "untrash":
      return inAny("TRASH");
    case "notjunk":
      return inAny("SPAM");
    case "trash":
      return notIn("SENT", "DRAFT", "TRASH");
    case "move":
      // Not the items that are in that folder already.
      return notIn("SENT", "DRAFT", "TRASH", String(payload.label ?? ""));
    case "unmove":
      return inAny(String(payload.label ?? ""));
    case "deleteForever":
      return inAny(payload.from === "junk" ? "SPAM" : "TRASH");
  }
}

/** The folder an action moves to, by label or EWS name. Null: no move. */
export function targetFor(kind: ExchangeActionKind, place: ThreadPlace, payload: Record<string, unknown> = {}): string | null {
  const known = (name: string) => {
    const id = place.wellKnown[name];
    if (!id) throw new Error(`ews:invalid: This mailbox has no ${name} folder.`);
    return id;
  };
  switch (kind) {
    case "archive":
      return known("archive");
    case "trash":
      return known("deleteditems");
    case "junk":
      return known("junkemail");
    case "unarchive":
    case "untrash":
    case "notjunk":
    case "unmove":
      return known("inbox");
    case "snooze":
    case "move": {
      const label = String(payload.label ?? "");
      const id = place.folderOf.get(label) ?? place.byPath.get(label.toLowerCase());
      if (!id || !payload.label) throw new Error(`ews:invalid: This mailbox has no folder "${String(payload.label ?? "")}".`);
      return id;
    }
    default:
      return null;
  }
}

/** The label of the folder a row lands in. Archive has none. */
function labelOfFolder(place: ThreadPlace, folderId: string): string | null {
  for (const [label, id] of place.folderOf) if (id === folderId) return label || null;
  return null;
}

function failures(list: ExchangeFailure[]): void {
  if (list.length) throw new Error(list[0].error);
}

async function applyMove(account: string, place: ThreadPlace, items: Row[], target: string): Promise<void> {
  const result = await moveExchangeItems(account, items.map((r) => r.messageId), target);
  const label = labelOfFolder(place, target);
  const byId = new Map(items.map((r) => [r.messageId, r]));
  const store = mailStore();
  const gone = result.moved.map((m) => m.id);
  if (gone.length) await store.messages.removeMessages(account, gone);
  const arrived = result.moved
    .filter((m) => m.newId && byId.has(m.id))
    .map((m) => asRow(byId.get(m.id)!, { messageId: m.newId!, labels: relabel(byId.get(m.id)!, label) }));
  if (arrived.length) await store.messages.upsertMany(account, arrived);
  failures(result.failed);
}

async function applyDelete(account: string, items: Row[]): Promise<void> {
  const change = await deleteExchangeForever(account, items.map((r) => r.messageId));
  if (change.done.length) await mailStore().messages.removeMessages(account, change.done);
  failures(change.failed);
}

/**
 * Do an action on an Exchange thread. Most go into the copy and the queue
 * (see the top of this file); delete forever and snooze go to the server,
 * then the copy. Then the worker is woken. Nothing to do (no item it is
 * about) is not an error. A folder that is not there is, before anything
 * changes.
 */
export async function exchangeThreadAction(
  account: string,
  threadId: string,
  kind: ExchangeActionKind,
  payload: Record<string, unknown> = {}
): Promise<void> {
  const email = account.trim().toLowerCase();
  // An undo of an action that has not gone out: both are dropped, and the
  // copy is as it was. The server never hears of either.
  if (QUEUED_EXCHANGE_KINDS.has(kind) && (await cancelExchangeInverse(email, threadId, kind, payload))) return;
  const rows = (await mailStore().messages.thread(email, threadId)) as Row[];
  const place = placeOf(await readExchangeFolders(email), rows);
  const items = itemsFor(kind, place, payload);
  if (!items.length) return;
  if (QUEUED_EXCHANGE_KINDS.has(kind)) {
    const target = targetFor(kind, place, payload);
    await queueExchangeAction({
      account: email,
      threadId,
      kind,
      items,
      target,
      targetLabel: target ? labelOfFolder(place, target) : null,
      payload,
    });
    // What the server has now comes in with the next pass.
    wakeExchangeSync(email, kind === "read" || kind === "unread" ? "inbox" : "all");
    return;
  }
  try {
    if (kind === "deleteForever") await applyDelete(email, items);
    else await applyMove(email, place, items, targetFor(kind, place, payload)!);
  } finally {
    invalidateInboxCache();
    notifySyncChanged(email);
    // Both touch a folder that is not the inbox.
    wakeExchangeSync(email, "all");
  }
}

/**
 * For the action functions of every provider: when the account is an
 * Exchange mailbox, do the action here and answer true. False: not an
 * Exchange mailbox, and the caller goes on its own way.
 */
export async function runIfExchange(
  account: string,
  threadId: string,
  kind: ExchangeActionKind,
  payload?: Record<string, unknown>
): Promise<boolean> {
  if ((await resolveMailProvider(account).catch(() => null)) !== "exchange") return false;
  await exchangeThreadAction(account, threadId, kind, payload);
  return true;
}
