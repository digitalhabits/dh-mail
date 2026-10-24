/**
 * The unread switch at the end of the tabs: one switch for every tab.
 *
 * On, a tab lists its unread conversations. A conversation that was unread
 * while the switch was on stays listed after it is read, so the one being
 * read does not leave the list under the reader, and the next one is where
 * it was. They go when the switch, the tab or the mailboxes change.
 *
 * No React here: the rules are the part a suite reads.
 */

import { threadKey } from "@/lib/mail/thread-copies";

type Row = { account: string; threadId: string; unread: boolean };

/** What one stretch of reading keeps, and which stretch it belongs to. */
export type UnreadKeep = { scope: string; keys: ReadonlySet<string> };

/**
 * The keep after this paint: the unread rows added, or a fresh keep for a
 * new stretch. The same object when nothing changed, so a caller that
 * holds it in state can tell.
 */
export function nextUnreadKeep(keep: UnreadKeep | null, scope: string, rows: readonly Row[]): UnreadKeep {
  const same = keep?.scope === scope ? keep : null;
  const add = rows.filter((r) => r.unread && !same?.keys.has(threadKey(r))).map(threadKey);
  if (same && !add.length) return same;
  return { scope, keys: new Set([...(same?.keys ?? []), ...add]) };
}

/** The rows the switch lets through: unread now, or unread earlier in this stretch. */
export function unreadRows<T extends Row>(rows: readonly T[], keep: UnreadKeep): T[] {
  return rows.filter((r) => r.unread || keep.keys.has(threadKey(r)));
}
