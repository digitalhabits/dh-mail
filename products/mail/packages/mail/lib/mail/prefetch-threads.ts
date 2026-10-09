/**
 * Warm the thread-body cache for the top of the on-screen list so open /
 * post-delete successor selection can paint without waiting on the network.
 * Writes through RAM + IndexedDB via setCachedMailThread.
 */

import {
  isMailThreadCacheFresh,
  loadCachedMailThread,
  setCachedMailThread,
} from "@/lib/mail/thread-cache";
import type { MailThreadDetail, MailThreadSummary } from "@/lib/mail/types";
import { mailApiFetch } from "@/lib/mail/api";

/** First-screen threads — enough for instant open of the visible top. */
export const MAIL_THREAD_PREFETCH_COUNT = 15;
const PREFETCH_IDLE_MS = 300;
/**
 * Warm a few threads at once. One at a time made the whole sweep as slow as
 * the sum of every round trip, so a new message often stayed cold until long
 * after it appeared in the list.
 */
const PREFETCH_CONCURRENCY = 3;

function threadKey(t: { account: string; threadId: string }): string {
  return `${t.account}|${t.threadId}`;
}

async function fetchThreadNoMarkRead(
  account: string,
  threadId: string,
  messageCount: number
): Promise<MailThreadDetail> {
  const params = new URLSearchParams({
    account,
    id: threadId,
    markRead: "0",
  });
  // Short threads then cost one Gmail call instead of one per message.
  if (messageCount > 0) params.set("count", String(messageCount));
  const res = await mailApiFetch(`/api/mail/thread?${params.toString()}`);
  let json: { thread?: MailThreadDetail; error?: string };
  try {
    json = (await res.json()) as { thread?: MailThreadDetail; error?: string };
  } catch {
    throw new Error(res.ok ? "Invalid JSON response" : "Request failed");
  }
  if (!res.ok || !json.thread) {
    throw new Error(json.error || "Request failed");
  }
  return json.thread;
}

/**
 * Sequentially prefetch thread bodies for `summaries` (already ordered).
 * Skips RAM/disk-fresh entries. Failures are silent.
 */
export async function prefetchMailThreadBodies(
  summaries: readonly MailThreadSummary[],
  options?: {
    isCancelled?: () => boolean;
    signal?: AbortSignal;
    limit?: number;
  }
): Promise<void> {
  const limit = options?.limit ?? MAIL_THREAD_PREFETCH_COUNT;
  const seen = new Set<string>();
  const queue: MailThreadSummary[] = [];
  for (const t of summaries) {
    const key = threadKey(t);
    if (seen.has(key)) continue;
    seen.add(key);
    queue.push(t);
    if (queue.length >= limit) break;
  }

  // Workers pull from the front, so the top of the list still warms first.
  let next = 0;
  const stopped = () =>
    Boolean(options?.isCancelled?.() || options?.signal?.aborted);

  /*
   * A cancelled sweep finishes what it has started, and keeps it.
   *
   * Cancelling stops the *next* fetch from beginning; it does not abort the
   * one in flight, and it does not throw the answer away. Both used to
   * happen, and neither did what it looked like it did. The abort never
   * reached the provider — the route takes no signal, so Gmail did every
   * bit of the work and its quota was spent either way. And the answer,
   * arriving a moment after the cancel, was dropped rather than cached, so
   * the next sweep asked Gmail the same question again.
   *
   * The sweep runs on every change to the top of the list, and archiving
   * changes the top of the list. Archive faster than a fetch takes and it
   * cancelled itself on every keystroke: three fetches burned, three
   * answers dropped, no thread ever cached, and the same three fetched
   * again a second later. That is what ran a mailbox into Gmail's
   * per-minute limit during an afternoon of clearing the inbox.
   */
  const worker = async () => {
    while (next < queue.length) {
      if (stopped()) return;
      const t = queue[next];
      next += 1;
      const cached = await loadCachedMailThread(t.account, t.threadId);
      if (cached && isMailThreadCacheFresh(cached, t.lastAt)) continue;
      try {
        const thread = await fetchThreadNoMarkRead(
          t.account,
          t.threadId,
          t.messageCount
        );
        // Kept even if the sweep was cancelled while this was out: the
        // provider has already answered, and the answer is what a later
        // sweep or a real open would otherwise have to ask for again.
        setCachedMailThread(t.account, t.threadId, thread, t.lastAt);
      } catch {
        // Best-effort warm — real open will fetch normally.
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(PREFETCH_CONCURRENCY, queue.length) }, worker)
  );
}

/**
 * Schedule prefetch after the list settles; returns a cancel function.
 *
 * Cancel means "start nothing more" — a fetch already out is allowed to
 * land and be kept. See the note on the worker for why.
 */
export function scheduleMailThreadPrefetch(
  summaries: readonly MailThreadSummary[],
  options?: { delayMs?: number; limit?: number }
): () => void {
  const controller = new AbortController();
  const delay = options?.delayMs ?? PREFETCH_IDLE_MS;
  const timer = window.setTimeout(() => {
    void prefetchMailThreadBodies(summaries, {
      signal: controller.signal,
      isCancelled: () => controller.signal.aborted,
      limit: options?.limit,
    });
  }, delay);
  return () => {
    window.clearTimeout(timer);
    controller.abort();
  };
}
