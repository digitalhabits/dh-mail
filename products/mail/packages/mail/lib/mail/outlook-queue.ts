/**
 * Outlook (Graph) actions that wait for the server: read, unread, archive,
 * trash, junk, and a move, with their undos.
 *
 * The reader's action changes the copy and goes into the queue in one step
 * (the store's `actions.enqueue`, which also keeps how each message of the
 * thread was). This module carries the queue to Graph, in order: at once
 * after the action, and at the start of each pass of the worker
 * (`outlook-sync.ts`), which ends by putting what is still queued back on
 * the copy (`actions.replay`). With no network the action stays in the
 * queue and in the copy until Graph can be reached.
 *
 * A moved message gets a new id from Graph; `moveOutlookMessage` notes it
 * (`noteOutlookMove`), so the copy does not lose the row between folders.
 * The order, the retries and the undo are the shared runner's
 * (`action-queue.ts`); a queued action names a conversation, not items.
 * Delete forever is not queued: it cannot be undone, and goes to Graph first.
 */

import "server-only";

import { createActionQueue, type QueueDelivery, type QueueFailure } from "@/lib/mail/action-queue";
import { invalidateInboxCache } from "@/lib/mail/inbox-cache";
import { localStoreServes, notifySyncChanged } from "@/lib/mail/local-store";
import { outlookAccessTokenFor } from "@/lib/mail/outlook-token";
import { mailStore } from "@/lib/mail/store";
import type { MailPendingAction } from "@/lib/mail/store/types";
import { listConversationMessages, markOutlookMessageRead, moveOutlookConversation } from "@/lib/outlook/api";

export type OutlookQueuedKind =
  | "read"
  | "unread"
  | "archive"
  | "unarchive"
  | "trash"
  | "untrash"
  | "junk"
  | "notjunk"
  | "move"
  | "unmove";

const KINDS = new Set<string>(["read", "unread", "archive", "unarchive", "trash", "untrash", "junk", "notjunk", "move", "unmove"]);

/** Where each move goes: a well-known folder, or the payload's folder id. */
function destination(action: MailPendingAction): string {
  switch (action.kind) {
    case "archive":
      return "archive";
    case "trash":
      return "deleteditems";
    case "junk":
      return "junkemail";
    case "move": {
      const id = action.payload.folderId;
      if (typeof id !== "string" || !id) throw Object.assign(new Error("No folder to move to."), { status: 400 });
      return id;
    }
    default:
      return "inbox";
  }
}

/**
 * The reader's action, when the copy serves the mailbox: into the copy and
 * the queue, then one try to deliver it. An undo of an action still queued
 * takes that one back instead. False: the copy does not serve it yet, and
 * the caller goes to Graph as before. Never throws for the network.
 *
 * `payload.label` is what the copy calls the folder of a move (its path);
 * `payload.folderId` is Graph's id for it.
 */
export async function queueOutlookAction(
  account: string,
  threadId: string,
  kind: OutlookQueuedKind,
  payload: Record<string, unknown> = {}
): Promise<boolean> {
  const email = account.trim().toLowerCase();
  if (!(await localStoreServes(email))) return false;
  if (await queue.cancelInverse(email, threadId, kind, payload)) return true;
  await mailStore().actions.enqueue({ account: email, threadId, kind, payload, apply: true });
  invalidateInboxCache();
  notifySyncChanged(email);
  await flushOutlookActions(email).catch((err: unknown) => {
    console.warn(`[mail-sync] ${email}: the action stays queued: ${err instanceof Error ? err.message : String(err)}`);
  });
  return true;
}

/**
 * What a failure says. `transient`: nothing about the action — no network,
 * a busy server, a sign-in to renew. The queue waits and keeps its order,
 * and the try is not counted. `gone`: the mail is no longer there.
 * `refused`: Graph's word on the action, counted toward the tries.
 */
export function outlookFailure(err: unknown): QueueFailure {
  const message = err instanceof Error ? err.message : String(err);
  const status = (err as { status?: number } | null)?.status;
  if (/invalid_grant|reconnect|AADSTS/i.test(message)) return "transient";
  if (status == null) return "transient";
  if (status === 401 || status === 408 || status === 429 || status >= 500) return "transient";
  if (status === 404) return "gone";
  return "refused";
}

/** The action on Graph. Nothing found: the conversation is gone. */
async function deliver(email: string, action: MailPendingAction): Promise<QueueDelivery> {
  const token = await outlookAccessTokenFor(email);
  let found: boolean;
  if (action.kind === "read") {
    const page = await listConversationMessages(token, action.threadId, { top: 100 });
    // One PATCH for each message that is unread, and none for the rest.
    await Promise.all(page.messages.filter((m) => m.isRead === false).map((m) => markOutlookMessageRead(token, m.id, true)));
    found = page.messages.length > 0;
  } else if (action.kind === "unread") {
    const page = await listConversationMessages(token, action.threadId, { top: 1 });
    const newest = page.messages[page.messages.length - 1];
    if (newest) await markOutlookMessageRead(token, newest.id, false);
    found = Boolean(newest);
  } else {
    found = (await moveOutlookConversation(token, action.threadId, destination(action))) > 0;
  }
  return found ? {} : { putBack: { ids: "all", error: "The conversation is no longer in the mailbox." } };
}

const queue = createActionQueue({ name: "outlook", kinds: KINDS, deliver, classify: outlookFailure });

/** Carry the mailbox's queue to Graph, in order. */
export function flushOutlookActions(account: string): Promise<void> {
  return queue.flush(account);
}

/** Put the queue back on top of the copy, after a pass wrote Graph's view. */
export async function replayOutlookActions(account: string): Promise<void> {
  const email = account.trim().toLowerCase();
  if ((await mailStore().actions.replay(email)) > 0) {
    invalidateInboxCache();
    notifySyncChanged(email);
  }
}
