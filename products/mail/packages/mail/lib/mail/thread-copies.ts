/**
 * One row per conversation, whichever of our mailboxes it came to.
 *
 * A mail cc'd to two of the reader's addresses arrives twice, once in each
 * mailbox, and the list would show it twice. It is one conversation to the
 * reader, so it is one row: the newest copy stands for it, and the others
 * are folded in — remembered on the row as `alsoIn`, so that whatever is
 * done to the row can be done to every copy. Deleting only the row's own
 * copy left the other to take its place on the next refresh, the same
 * subject in the same spot; the reader deleted again, and by then the
 * selection had moved on to a conversation they never meant to touch.
 *
 * No React in here, so a test can read it.
 */

import type { MailThreadSummary } from "@/lib/mail/types";

export type ThreadRef = { account: string; threadId: string };

export function threadKey(t: ThreadRef): string {
  // The mailbox in lower case: a row's account comes from the store and
  // the open thread's from wherever it was opened, and a key that differs
  // only in case is a row that survives its own deletion.
  return `${t.account.toLowerCase()}|${t.threadId}`;
}

/**
 * Collapse cc'd copies of the same conversation across mailboxes, mirroring
 * the server's unified dedupe: newest-first, first copy wins the row, any
 * copy being unread / carrying an invite marks the kept row.
 */
export function dedupeThreadsByTip(rows: MailThreadSummary[]): MailThreadSummary[] {
  const sorted = [...rows].sort(
    (a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt)
  );
  const indexByKey = new Map<string, number>();
  const out: MailThreadSummary[] = [];
  for (const t of sorted) {
    const key = t.tipId || threadKey(t);
    const index = indexByKey.get(key);
    if (index == null) {
      indexByKey.set(key, out.length);
      out.push(t);
      continue;
    }
    const kept = out[index];
    const unread = kept.unread || t.unread;
    const hasCalendarInvite = kept.hasCalendarInvite || t.hasCalendarInvite;
    const hasAttachments = kept.hasAttachments || t.hasAttachments;
    const calendarInviteWhen = kept.calendarInviteWhen ?? t.calendarInviteWhen;
    // The folded copy is remembered on the row that stands for it, so an
    // action on the row can reach it — see `alsoIn` on the type.
    const copy = { account: t.account, threadId: t.threadId };
    const alsoIn =
      threadKey(copy) === threadKey(kept) ||
      kept.alsoIn?.some((c) => threadKey(c) === threadKey(copy))
        ? kept.alsoIn
        : [...(kept.alsoIn ?? []), copy, ...(t.alsoIn ?? [])];
    if (
      unread !== kept.unread ||
      hasCalendarInvite !== kept.hasCalendarInvite ||
      hasAttachments !== kept.hasAttachments ||
      calendarInviteWhen !== kept.calendarInviteWhen ||
      alsoIn !== kept.alsoIn
    ) {
      out[index] = {
        ...kept,
        unread,
        hasCalendarInvite,
        hasAttachments,
        calendarInviteWhen,
        alsoIn,
      };
    }
  }
  return out;
}

/**
 * One bubble per message, however many copies of it the mailbox holds.
 *
 * Cc yourself and Exchange keeps two items: one in Sent Items, one in the
 * Inbox. They are the same message — one RFC 822 Message-ID, one thing the
 * reader wrote — but two ids, and the conversation is queried across the
 * whole mailbox, so both came back and the thread showed the message twice,
 * side by side, both drawn as outgoing because both are from the reader.
 *
 * Gmail never did this: it keeps one message and hangs both SENT and INBOX
 * on it. So the same account, cc'd to itself, read correctly on one provider
 * and doubled on the other — which is the part that made it a bug rather
 * than a choice. This is what makes the two agree.
 *
 * Order is kept, and the first copy of a message wins. Which one that is
 * does not show: the two are the same words from the same sender at the same
 * moment, and `own` is read off the From address, so they draw identically.
 *
 * A message with no Message-ID stands for itself. Some mailboxes have one,
 * and folding those together by a missing key would hide real messages.
 */
export function dedupeMessagesByRfcId<
  T extends { id: string; rfcMessageId?: string },
>(messages: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const message of messages) {
    const rfcId = message.rfcMessageId?.trim().toLowerCase();
    if (rfcId) {
      if (seen.has(rfcId)) continue;
      seen.add(rfcId);
    }
    out.push(message);
  }
  return out;
}

/**
 * Whether this row is the one that stands for that conversation.
 *
 * Not the same question as key equality. A conversation cc'd into two of
 * our mailboxes is one row, and which copy wins the row is decided by a
 * sort whose ties fall to fetch order — so the row's own key can change
 * between two polls while the row looks exactly the same. Anything that
 * matches the open thread against the list by key alone — the highlight,
 * the arrow keys, the copies an action gathers — quietly loses the row
 * when that happens, and every one of those losses has been a way to act
 * on a conversation the reader never chose. The row stands for its own
 * key and for every copy folded into it, and this is the question to ask.
 */
export function rowStandsFor(
  row: MailThreadSummary,
  ref: ThreadRef
): boolean {
  const key = threadKey(ref);
  if (threadKey(row) === key) return true;
  return row.alsoIn?.some((c) => threadKey(c) === key) ?? false;
}

/**
 * The row and every copy behind it: what an action on the row acts on.
 *
 * `t` may be a bare {account, threadId} — the open thread, say — so the
 * copies are read off the row in the list that stands for it. Found by
 * what the row stands for, not by its key: when the row is standing on
 * its other copy, the action must still take both, or the row survives
 * its own deletion and invites a second press that lands on a
 * conversation the reader never meant to touch. Deduplicated, and the
 * asked-for copy first.
 */
export function everyCopy(
  t: { account: string; threadId: string },
  rows: MailThreadSummary[]
): { account: string; threadId: string }[] {
  const key = threadKey(t);
  const row = rows.find((x) => rowStandsFor(x, t));
  const out: { account: string; threadId: string }[] = [
    { account: t.account, threadId: t.threadId },
  ];
  const seen = new Set([key]);
  const copies = row
    ? [{ account: row.account, threadId: row.threadId }, ...(row.alsoIn ?? [])]
    : [];
  for (const c of copies) {
    const k = threadKey(c);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ account: c.account, threadId: c.threadId });
  }
  return out;
}
