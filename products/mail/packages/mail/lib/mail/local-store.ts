/**
 * The local copy of the mail, as the interface sees it: the question of
 * whether a mailbox can be read from it yet.
 *
 * The copy is always on. The worker that fills it lives in Rust and is
 * started by the host app for every mailbox (see apps/mail/src/local-store.ts).
 * This module is the part the mail package can know about without knowing
 * the host. See docs/mail-local-store.md.
 */

import { resolveMailProvider } from "@/lib/mail/providers";
import { mailStore } from "@/lib/mail/store";
import { tauriInvoke } from "@/lib/mail/store/tauri";
import type { MailSyncState } from "@/lib/mail/store/types";

/**
 * Whether the copy answers for this mailbox.
 *
 * From the moment its first sync starts. The worker reads newest first,
 * two hundred at a time, and the list reloads as each batch lands, so
 * the inbox is on screen within seconds and fills from there. Asking
 * the provider meanwhile was worse: a large mailbox's first minutes put
 * every list call on the API at once, which tripped its request limit
 * and put "could not be read" over a mailbox that was being read.
 */
export function stateServes(state: MailSyncState | undefined): boolean {
  if (!state) return false;
  return state.phase === "live" || state.phase === "full";
}

let statesCache: { at: number; states: MailSyncState[] } | null = null;
const STATES_TTL_MS = 3_000;

/** Every mailbox's sync state, read at most every few seconds. */
export async function syncStates(): Promise<MailSyncState[]> {
  const now = Date.now();
  if (statesCache && now - statesCache.at < STATES_TTL_MS) return statesCache.states;
  try {
    // A host without a sync worker answers null; that is no states.
    const listed = await mailStore().sync.list();
    const states = Array.isArray(listed) ? listed : [];
    statesCache = { at: now, states };
    return states;
  } catch {
    return statesCache?.states ?? [];
  }
}

/** The actions the worker can carry. Mirrors `actions::KINDS` in the crate. */
export type MailLocalActionKind =
  | "archive"
  | "unarchive"
  | "trash"
  | "untrash"
  | "junk"
  | "notjunk"
  | "read"
  | "unread"
  | "star"
  | "unstar"
  | "move"
  | "unmove"
  | "discardDraft";

/**
 * Queue an action on a thread when the copy serves its mailbox: applied to
 * the copy at once, carried to the server by the worker. True when queued;
 * false when the caller should do it the provider's way.
 */
export async function queueLocalAction(
  account: string,
  threadId: string,
  kind: MailLocalActionKind,
  payload?: Record<string, unknown>
): Promise<boolean> {
  const invoke = tauriInvoke();
  if (!invoke) return false;
  // Only a Gmail worker carries the queue. An Outlook mailbox's own call is
  // made first, then the copy is told — see applyLocalAction.
  if ((await resolveMailProvider(account)) !== "gmail") return false;
  if (!(await localStoreServes(account))) return false;
  await invoke("mail_sync_action", { account, threadId, kind, payload: payload ?? {} });
  return true;
}

/**
 * Apply an action to the copy only, after the provider has been told: the
 * list shows the result now rather than at the next delta.
 */
export async function applyLocalAction(
  account: string,
  threadId: string,
  kind: MailLocalActionKind,
  payload?: Record<string, unknown>
): Promise<void> {
  if (!(await localStoreServes(account))) return;
  await mailStore()
    .messages.applyAction({ account, threadId, kind, payload })
    .catch(() => undefined);
  notifySyncChanged(account);
}

/** Window events the pane listens to beside the worker's Tauri events. */
export const SYNC_STATE_WINDOW_EVENT = "redd-mail-sync-state";
export const SYNC_CHANGED_WINDOW_EVENT = "redd-mail-sync-changed";

export function notifySyncState(state: MailSyncState): void {
  forgetSyncStates();
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SYNC_STATE_WINDOW_EVENT, { detail: state }));
}

export function notifySyncChanged(account: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SYNC_CHANGED_WINDOW_EVENT, { detail: { account } }));
}

/**
 * Whether a side folder of the copy — "trash" or "spam" — is live for the
 * mailbox. Those are synced after All Mail, and only when the server has
 * them, so a view of them asks separately.
 */
export async function localStoreServesFolder(account: string, folder: "trash" | "spam"): Promise<boolean> {
  const states = await syncStates();
  const state = states.find(
    (s) => s.account.toLowerCase() === account.toLowerCase() && s.folder === folder
  );
  return state?.phase === "live";
}

export function forgetSyncStates(): void {
  statesCache = null;
}

/**
 * Whether the list for this mailbox should come from the copy: the
 * mailbox's sync has rows. Before the first rows, and for a mailbox the
 * worker cannot read, the provider answers as it always has.
 */
export async function localStoreServes(account: string): Promise<boolean> {
  const states = await syncStates();
  const state = states.find((s) => s.account.toLowerCase() === account.toLowerCase());
  return stateServes(state);
}

/**
 * Whether the copy holds the whole mailbox: the first sync is done.
 *
 * The list and a search read a copy that is still filling: the newest
 * mail is in first, and the list says how far the read has come. A
 * thread cannot, since its older messages may not be in yet; that asks
 * the provider until the sync is through.
 */
export async function localStoreComplete(account: string): Promise<boolean> {
  const states = await syncStates();
  const state = states.find((s) => s.account.toLowerCase() === account.toLowerCase());
  return state?.phase === "live";
}
