/**
 * Exchange (EWS) actions that wait for the server: read, unread, flag,
 * archive, trash, junk, and a move, with their undos.
 *
 * The reader's action changes the copy at once and goes into the queue the
 * Gmail worker keeps (`pending_actions`, through the store's `actions.*`).
 * This module carries the queue to the server, in order: at once after the
 * action, and before each pass of the worker (`exchange-sync.ts`). A pass
 * writes what the server says over the copy, so the queue is put back on
 * top after it (`replayExchangeActions`). With no network the action stays
 * in the queue, and in the copy, until the server can be reached.
 *
 * Each queued action names its items and the folder a move goes to, as
 * they were when the reader acted. EWS gives a moved item a new id, so a
 * delivered move writes the new ids into the actions after it. The order,
 * the retries and the undo are the shared runner's (`action-queue.ts`).
 *
 * A refused password stops the queue at once and until a new connect, as
 * it stops the worker: another try is another failed sign-in, and enough of
 * those lock the account (docs/mail-exchange-ews.md, section 4.7). Delete
 * forever and snooze are not queued: they go to the server first, as before.
 */

import {
  exchangeErrorCode,
  moveExchangeItems,
  setExchangeFlag,
  setExchangeRead,
} from "@/lib/mail/exchange-native";
import { createActionQueue, type QueueDelivery, type QueueFailure } from "@/lib/mail/action-queue";
import { invalidateInboxCache } from "@/lib/mail/inbox-cache";
import { notifySyncChanged } from "@/lib/mail/local-store";
import { mailStore } from "@/lib/mail/store";
import type { MailPendingAction, MailStoredMessage } from "@/lib/mail/store/types";

type Row = MailStoredMessage;

/** The actions that wait in the queue. */
export const QUEUED_EXCHANGE_KINDS = new Set([
  "read",
  "unread",
  "star",
  "unstar",
  "archive",
  "unarchive",
  "trash",
  "untrash",
  "junk",
  "notjunk",
  "move",
  "unmove",
]);

/** How a message was before the action, to put it back if refused. */
type Before = { labels: string[]; unread: boolean; starred: boolean };

/** What a queued Exchange action keeps, beside the caller's own payload. */
type QueuedPayload = Record<string, unknown> & {
  /** The items, by their EWS ids. */
  ids: string[];
  /** The folder a move goes to. Null for read and flag. */
  target: string | null;
  /** The label rows wear in that folder. Null for Archive, and for read and flag. */
  targetLabel: string | null;
  before: Record<string, Before>;
};

/** A store row for writing: no body. */
export function asRow(row: Row & { body?: unknown }, change: Partial<Row>): Row {
  const { body: _body, ...rest } = row;
  void _body;
  return { ...rest, ...change };
}

/** The labels of a row moved to the folder that wears `folderLabel`. */
export function relabel(row: Row, folderLabel: string | null): string[] {
  const keep = row.labels.filter((l) => l === "STARRED" || (l === "DRAFT" && row.isDraft && folderLabel !== "DRAFT"));
  return folderLabel ? [folderLabel, ...keep] : keep;
}

function isFlagKind(kind: string): boolean {
  return kind === "read" || kind === "unread" || kind === "star" || kind === "unstar";
}

/** A row as the action leaves it. */
function changed(kind: string, row: Row, targetLabel: string | null): Row {
  switch (kind) {
    case "read":
      return asRow(row, { unread: false });
    case "unread":
      return asRow(row, { unread: true });
    case "star":
      return asRow(row, { starred: true, labels: [...row.labels.filter((l) => l !== "STARRED"), "STARRED"] });
    case "unstar":
      return asRow(row, { starred: false, labels: row.labels.filter((l) => l !== "STARRED") });
    default:
      return asRow(row, { labels: relabel(row, targetLabel) });
  }
}

function same(a: Row, b: Row): boolean {
  return a.unread === b.unread && a.starred === b.starred && a.labels.join("\u0000") === b.labels.join("\u0000");
}

/**
 * The rows of one thread that the actions change, in order, as they leave
 * them. The rows as the store has them now.
 */
function changedRows(rows: Row[], actions: { kind: string; payload: QueuedPayload }[]): Row[] {
  const now = new Map(rows.map((r) => [r.messageId, asRow(r, {})]));
  const start = new Map(now);
  for (const { kind, payload } of actions) {
    for (const id of payload.ids ?? []) {
      const row = now.get(id);
      if (row) now.set(id, changed(kind, row, payload.targetLabel ?? null));
    }
  }
  return [...now.values()].filter((r) => !same(r, start.get(r.messageId)!));
}

/**
 * The reader's action: into the queue and into the copy, in one store step,
 * so the two cannot disagree. Its items and target are found by the caller
 * (`exchange-actions.ts`). An undo of an action still queued takes that one
 * back instead. Then one try to deliver, which never throws: what the server
 * says comes back through the queue's own rules.
 */
export async function queueExchangeAction(input: {
  account: string;
  threadId: string;
  kind: string;
  items: Row[];
  target: string | null;
  targetLabel: string | null;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const email = input.account.trim().toLowerCase();
  const before: Record<string, Before> = {};
  for (const r of input.items) before[r.messageId] = { labels: r.labels, unread: r.unread, starred: r.starred };
  const payload: QueuedPayload = {
    ...(input.payload ?? {}),
    ids: input.items.map((r) => r.messageId),
    target: input.target,
    targetLabel: input.targetLabel,
    before,
  };
  const rows = changedRows(input.items, [{ kind: input.kind, payload }]);
  await mailStore().actions.enqueue({ account: email, threadId: input.threadId, kind: input.kind, payload, apply: false, rows });
  invalidateInboxCache();
  notifySyncChanged(email);
  await flushExchangeActions(email).catch((err: unknown) => {
    console.warn(`[mail-sync] ${email}: the action stays queued: ${err instanceof Error ? err.message : String(err)}`);
  });
}

/** True for an error that stops the queue until the reader connects again. */
export function isSignInRefusal(message: string): boolean {
  const code = exchangeErrorCode(message);
  return code === "ews:refused" || code === "ews:no-account";
}

/**
 * True for an error that says nothing about the action: no network, a busy
 * server, a page that is not EWS. Not counted toward the tries; the queue
 * waits and keeps its order. A fault, a parse error or an invalid request is
 * the server's word on the action, and is counted.
 */
export function isTransient(message: string): boolean {
  const code = exchangeErrorCode(message);
  return code === "ews:network" || code === "ews:busy" || code === "ews:http" || code === "ews:unavailable" || code === "ews:no-scheme";
}

/*
  A refused password stops the queue (`stop`) until a new connect starts a
  worker (`resumeExchangeActions`, from startExchangeSync). The Rust client
  keeps its own latch as well, so nothing is sent even if this were missed.
*/
function classify(err: unknown): QueueFailure {
  const message = err instanceof Error ? err.message : String(err);
  if (isSignInRefusal(message)) return "stop";
  if (isTransient(message)) return "transient";
  return "refused";
}

const queue = createActionQueue({ name: "exchange", kinds: QUEUED_EXCHANGE_KINDS, deliver, classify });

/**
 * Carry the mailbox's queue to the server, in order. Throws only for a
 * refused password, so the worker stops as it does for its own refusal.
 */
export function flushExchangeActions(account: string): Promise<void> {
  return queue.flush(account);
}

export function resumeExchangeActions(account: string): void {
  queue.resume(account);
}

/** When `kind` undoes the thread's newest queued action: take it back. */
export function cancelExchangeInverse(account: string, threadId: string, kind: string, payload?: Record<string, unknown>): Promise<boolean> {
  return queue.cancelInverse(account, threadId, kind, payload);
}

/** The action on the server. Throws when the whole request failed. */
async function deliver(email: string, action: MailPendingAction): Promise<QueueDelivery> {
  const payload = action.payload as QueuedPayload;
  const ids = payload.ids ?? [];
  if (!ids.length) return {};
  if (isFlagKind(action.kind)) {
    const change =
      action.kind === "read" || action.kind === "unread"
        ? await setExchangeRead(email, ids, action.kind === "read")
        : await setExchangeFlag(email, ids, action.kind === "star");
    return { putBack: back(change.failed, change.gone ?? []) };
  }
  if (!payload.target) throw new Error(`ews:invalid: No folder to move to.`);
  const result = await moveExchangeItems(email, ids, payload.target);
  const newIds: Record<string, string> = {};
  for (const m of result.moved) if (m.newId) newIds[m.id] = m.newId;
  const gone = result.moved.filter((m) => !m.newId).map((m) => m.id);
  // The rows take their new ids now, in the folder they went to.
  const moved = Object.keys(newIds);
  if (moved.length) {
    const store = mailStore();
    const rows = ((await store.messages.thread(email, action.threadId)) as Row[]).filter((r) => r.messageId in newIds);
    await store.messages.removeMessages(email, moved);
    const arrived = rows.map((r) => asRow(r, { messageId: newIds[r.messageId], labels: relabel(r, payload.targetLabel ?? null) }));
    if (arrived.length) await store.messages.upsertMany(email, arrived);
  }
  return { putBack: back(result.failed, gone), newIds };
}

/** The items the server refused, or found gone: put back, and why. */
function back(failed: { id: string; error: string }[], gone: string[]): QueueDelivery["putBack"] {
  const ids = [...failed.map((f) => f.id), ...gone];
  if (!ids.length) return null;
  return { ids, error: failed[0]?.error ?? "The message is no longer on the server." };
}

/**
 * Put the queue back on top of the copy, after a pass wrote what the server
 * said over it. The server has not heard of these actions yet.
 */
export async function replayExchangeActions(account: string): Promise<void> {
  const email = account.trim().toLowerCase();
  const store = mailStore();
  const pending = (await store.actions.pending(email)).filter((a) => QUEUED_EXCHANGE_KINDS.has(a.kind));
  if (!pending.length) return;
  const byThread = new Map<string, MailPendingAction[]>();
  for (const a of pending) byThread.set(a.threadId, [...(byThread.get(a.threadId) ?? []), a]);
  let changedAny = false;
  for (const [threadId, actions] of byThread) {
    const rows = (await store.messages.thread(email, threadId)) as Row[];
    const write = changedRows(rows, actions.map((a) => ({ kind: a.kind, payload: a.payload as QueuedPayload })));
    if (write.length) {
      await store.messages.upsertMany(email, write);
      changedAny = true;
    }
  }
  if (changedAny) {
    invalidateInboxCache();
    notifySyncChanged(email);
  }
}
