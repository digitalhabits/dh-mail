/*
 * Which of a thread's messages a page shows, and whether more lie either
 * side. Pure: it works on the message ids in order, oldest first.
 *
 * The Gmail reader (inbox-thread.ts) and the local copy's reader
 * (local-thread.ts) both page a thread this way; the rules live here once.
 *
 *   around  the message and up to THREAD_AROUND_RADIUS either side; an id
 *           the thread does not hold falls back to the newest page
 *   after   the page after that message; nothing after the last one
 *   oldest  the first page
 *   before  the page before that message; nothing before the first one
 *   (none)  the newest page
 *
 * Null means the page asked for is empty: there is nothing after the last
 * message, or before the first, or the id named is not in the thread. A
 * reader answers it with emptyThreadDetail, also here.
 */

import { THREAD_AROUND_RADIUS } from "@/lib/mail/thread-classify";
import type { MailThreadDetail } from "@/lib/mail/types";

export type ThreadWindowOptions = {
  around?: string;
  after?: string;
  oldest?: boolean;
  before?: string;
};

export type ThreadWindow = {
  /** First index shown. */
  start: number;
  /** One past the last index shown. */
  end: number;
  hasOlder: boolean;
  hasNewer: boolean;
};

export function threadWindow(
  ids: readonly string[],
  options: ThreadWindowOptions | undefined,
  limit: number
): ThreadWindow | null {
  const len = ids.length;
  const indexOf = (id: string | undefined) => (id ? ids.indexOf(id) : -1);
  let start: number;
  let end: number;
  if (options?.around) {
    const idx = indexOf(options.around);
    if (idx < 0) {
      start = Math.max(0, len - limit);
      end = len;
    } else {
      start = Math.max(0, idx - THREAD_AROUND_RADIUS);
      end = Math.min(len, idx + THREAD_AROUND_RADIUS + 1);
    }
  } else if (options?.after) {
    const idx = indexOf(options.after);
    if (idx < 0 || idx >= len - 1) return null;
    start = idx + 1;
    end = Math.min(len, start + limit);
  } else if (options?.oldest) {
    start = 0;
    end = Math.min(len, limit);
  } else if (options?.before) {
    const idx = indexOf(options.before);
    if (idx <= 0) return null;
    end = idx;
    start = Math.max(0, end - limit);
  } else {
    start = Math.max(0, len - limit);
    end = len;
  }
  return { start, end, hasOlder: start > 0, hasNewer: end < len };
}

/** The answer for a page with nothing in it: the thread, and no messages. */
export function emptyThreadDetail(
  account: string,
  threadId: string
): MailThreadDetail {
  return {
    account,
    threadId,
    subject: "(no subject)",
    participants: [],
    messages: [],
    hasOlder: false,
    hasNewer: false,
    reply: {
      inReplyTo: "",
      references: "",
      to: [],
      cc: [],
      allTo: [],
      allCc: [],
    },
  };
}
