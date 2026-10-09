/**
 * The "Older mail" rows under a search: what the provider found that the
 * local results do not hold already. Apart from older-search.ts, which
 * asks the provider, so the list can import it. See older-search.ts.
 */

import { threadKey } from "@/lib/mail/thread-copies";
import type { MailThreadSummary } from "@/lib/mail/types";

/**
 * Why some mailbox gave no older results: it is offline, or its server
 * search failed. Null when every mailbox asked has answered.
 */
export type OlderMailMiss = "offline" | "failed" | null;

/**
 * The older results to show under the local ones: each thread once, and
 * none that the local results hold already, newest first.
 */
export function olderMailBelow(
  local: readonly { account: string; threadId: string }[],
  older: readonly MailThreadSummary[]
): MailThreadSummary[] {
  const seen = new Set(local.map(threadKey));
  const out: MailThreadSummary[] = [];
  for (const t of older) {
    const key = threadKey(t);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out.sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt));
}

/**
 * When to ask the server again: a new search, a new mailbox scope, or a
 * change in which mailboxes are shown. The search runs once for each key.
 * It was keyed on the words alone, so a mailbox shown again after the words
 * were typed (hidden on a schedule, then shown early) was never searched.
 * "" for no search.
 */
export function olderSearchKey(
  query: string,
  account: string | undefined,
  mailboxes: readonly string[]
): string {
  if (!query) return "";
  const shown = [...mailboxes].map((e) => e.toLowerCase()).sort().join(",");
  return `${account ?? ""}|${shown}|${query}`;
}
