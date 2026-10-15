/**
 * The runner for the action queue of the providers whose worker is in the
 * interface (Outlook, Exchange). The Gmail worker runs its own, in Rust.
 *
 * Each provider gives how to carry one action to its server (`deliver`) and
 * what an error says (`classify`). The rest is the same for both, and is
 * here:
 *
 * - One flush at a time for each mailbox; a second waits for the first.
 * - In order. An action that cannot get through for a reason that says
 *   nothing about it (no network) keeps its place, and the flush stops. A
 *   refusal is counted; until it is given up, the thread's later actions
 *   wait too, so they never reach the server before it.
 * - Refused for good, or gone: the rows go back as the action's `before`
 *   says, and the reader is told (`mail-sync-action-failed`).
 * - A refused password (`stop`) stops the mailbox's queue until `resume`.
 * - A move that changed item ids is done, and those ids written into the
 *   later actions, in one store step (`actions.doneRenaming`).
 * - Undo of an action that has not gone out takes it back
 *   (`cancelInverse`): neither goes to the server.
 */

import { invalidateInboxCache } from "@/lib/mail/inbox-cache";
import { notifySyncChanged, reportActionRefused } from "@/lib/mail/local-store";
import { mailStore } from "@/lib/mail/store";
import type { MailPendingAction } from "@/lib/mail/store/types";

/**
 * What an error says. `transient`: nothing about the action; it waits and
 * the try is not counted. `gone`: what it was about is no longer there.
 * `refused`: the server's word on the action, counted. `stop`: the sign-in
 * was refused; the queue stops until the reader connects again.
 */
export type QueueFailure = "transient" | "gone" | "refused" | "stop";

export type QueueDelivery = {
  /** Items to put back as they were, and why: `all`, or some by id. */
  putBack?: { ids: string[] | "all"; error: string } | null;
  /** Old item id to new, from a move. */
  newIds?: Record<string, string>;
};

export type QueueProvider = {
  /** For the log. */
  name: string;
  /** The kinds this provider queues. Any other is dropped. */
  kinds: ReadonlySet<string>;
  /** The action on the server. Throws when the whole request failed. */
  deliver(email: string, action: MailPendingAction): Promise<QueueDelivery>;
  classify(err: unknown): QueueFailure;
};

export type ActionQueue = {
  /** Carry the mailbox's queue to the server. Throws only after `stop`. */
  flush(account: string): Promise<void>;
  /**
   * When `kind` undoes the thread's newest queued action, and that one has
   * not gone out, take it back. True: taken back; queue nothing.
   */
  cancelInverse(account: string, threadId: string, kind: string, payload?: Record<string, unknown>): Promise<boolean>;
  /** Go on after a `stop`: a new connect. */
  resume(account: string): void;
};

/** Each action and the one that takes it back. */
const INVERSE: Record<string, string> = {
  archive: "unarchive",
  unarchive: "archive",
  trash: "untrash",
  untrash: "trash",
  junk: "notjunk",
  notjunk: "junk",
  read: "unread",
  unread: "read",
  star: "unstar",
  unstar: "star",
  move: "unmove",
  unmove: "move",
};

const key = (account: string) => account.trim().toLowerCase();

/** The item ids a payload names, renamed. Its `before` follows. */
function renamed(payload: Record<string, unknown>, newIds: Record<string, string>): Record<string, unknown> {
  const out = { ...payload };
  if (Array.isArray(payload.ids)) out.ids = payload.ids.map((id) => newIds[String(id)] ?? id);
  if (payload.before && typeof payload.before === "object") {
    out.before = Object.fromEntries(Object.entries(payload.before).map(([id, was]) => [newIds[id] ?? id, was]));
  }
  return out;
}

export function createActionQueue(provider: QueueProvider): ActionQueue {
  const chains = new Map<string, Promise<void>>();
  const paused = new Set<string>();
  /** The action each mailbox's flush has on the server now. */
  const inFlight = new Map<string, number>();
  /** Taken back while a flush that had already read the queue was running. */
  const cancelled = new Set<number>();

  async function putBack(email: string, action: MailPendingAction, ids: string[] | "all", error: string): Promise<void> {
    const before = (action.payload.before ?? {}) as Record<string, unknown>;
    const back = ids === "all" ? before : Object.fromEntries(ids.filter((id) => id in before).map((id) => [id, before[id]]));
    console.warn(`[mail-sync] ${email}: ${action.kind} on ${action.threadId} refused for good: ${error}`);
    if (Object.keys(back).length) await mailStore().actions.restore(email, back);
    invalidateInboxCache();
    notifySyncChanged(email);
    reportActionRefused({ account: email, threadId: action.threadId, kind: action.kind, error });
  }

  /**
   * What a failed delivery does to the queue. `stop`: end this flush and
   * keep the order. `next`: go on to the next action.
   */
  async function failed(email: string, action: MailPendingAction, err: unknown, held: Set<string>): Promise<"stop" | "next"> {
    const store = mailStore();
    const message = err instanceof Error ? err.message : String(err);
    switch (provider.classify(err)) {
      case "stop":
        paused.add(email);
        await store.actions.failed(action.id, message, true);
        throw err;
      case "transient":
        await store.actions.failed(action.id, message, true);
        return "stop";
      case "gone":
        await store.actions.done(action.id);
        await putBack(email, action, "all", message);
        return "next";
      case "refused": {
        const { givenUp } = await store.actions.failed(action.id, message, false);
        if (givenUp) await putBack(email, action, "all", message);
        else held.add(action.threadId);
        return "next";
      }
    }
  }

  /** One action on the server, marked in flight while it is. Null: it failed. */
  async function attempt(email: string, action: MailPendingAction, held: Set<string>): Promise<QueueDelivery | "stop" | null> {
    inFlight.set(email, action.id);
    try {
      return await provider.deliver(email, action);
    } catch (err) {
      return (await failed(email, action, err, held)) === "stop" ? "stop" : null;
    } finally {
      inFlight.delete(email);
    }
  }

  async function flushNow(email: string): Promise<void> {
    if (paused.has(email)) return;
    const store = mailStore();
    const pending = await store.actions.pending(email);
    /** Threads with an earlier action still waiting: their later ones wait too. */
    const held = new Set<string>();
    let delivered = false;
    try {
      for (const [at, action] of pending.entries()) {
        if (cancelled.delete(action.id)) continue;
        if (!provider.kinds.has(action.kind)) {
          await store.actions.done(action.id);
          continue;
        }
        if (held.has(action.threadId)) continue;
        const result = await attempt(email, action, held);
        if (result === "stop") return;
        if (!result) continue;
        delivered = true;
        const newIds = result.newIds ?? {};
        if (Object.keys(newIds).length) {
          await store.actions.doneRenaming(action.id, newIds);
          for (const later of pending.slice(at + 1)) later.payload = renamed(later.payload, newIds);
        } else {
          await store.actions.done(action.id);
        }
        if (result.putBack) await putBack(email, action, result.putBack.ids, result.putBack.error);
      }
    } finally {
      if (delivered) {
        invalidateInboxCache();
        notifySyncChanged(email);
      }
    }
  }

  return {
    flush(account) {
      const email = key(account);
      const next = (chains.get(email) ?? Promise.resolve()).then(() => flushNow(email));
      const settled = next.catch(() => undefined);
      chains.set(email, settled);
      void settled.then(() => {
        if (chains.get(email) === settled) chains.delete(email);
      });
      return next;
    },

    async cancelInverse(account, threadId, kind, payload = {}) {
      const email = key(account);
      const store = mailStore();
      const last = (await store.actions.pending(email)).filter((a) => a.threadId === threadId).at(-1);
      if (!last || INVERSE[last.kind] !== kind) return false;
      if ((kind === "move" || kind === "unmove") && String(last.payload.label ?? "") !== String(payload.label ?? "")) return false;
      // On the server right now: too late to take back; the undo is queued.
      // No await between this test and the mark, so a flush cannot start it
      // in between; one that read the queue before skips it by the mark.
      if (inFlight.get(email) === last.id) return false;
      cancelled.add(last.id);
      if (!(await store.actions.cancel(last.id))) {
        cancelled.delete(last.id);
        return false;
      }
      invalidateInboxCache();
      notifySyncChanged(email);
      return true;
    },

    resume(account) {
      paused.delete(key(account));
    },
  };
}
