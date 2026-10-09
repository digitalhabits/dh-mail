/**
 * Opening an Outlook thread marks it read, and it stays read.
 *
 * Graph has no conversation-level read flag. The thread list calls a
 * conversation unread when any message in it is, so clearing that means
 * patching every unread message — not just the newest. Marking only the
 * newest looked right until the next sync read the rest of the conversation
 * and put the row back in bold, which is exactly what it did.
 */

import {
  conversationIsUnread,
  unreadMessageIds,
} from "@/lib/outlook/api";

import { check, suite } from "./harness.mjs";

/** Newest last, the order a conversation page comes back in. */
const THREAD = [
  { id: "m1", isRead: false },
  { id: "m2", isRead: true },
  { id: "m3", isRead: false },
];

/** What the old code did: the newest message, and only that one. */
function markNewestOnly(messages) {
  const last = messages[messages.length - 1];
  return messages.map((m) => (m.id === last?.id ? { ...m, isRead: true } : m));
}

function markAll(messages, ids) {
  const set = new Set(ids);
  return messages.map((m) => (set.has(m.id) ? { ...m, isRead: true } : m));
}

suite(async () => {
  check(
    "one unread message makes the conversation unread",
    conversationIsUnread(THREAD) === true
  );
  check(
    "every message read makes it read",
    conversationIsUnread([{ isRead: true }, { isRead: true }]) === false
  );
  // Graph leaves isRead off when it was not asked for. Absent is not unread —
  // guessing otherwise would send a patch for every message in every thread.
  check(
    "a message that never said is not counted as unread",
    conversationIsUnread([{ id: "m1" }]) === false &&
      unreadMessageIds([{ id: "m1" }]).length === 0
  );

  check(
    "the ones to patch are the unread ones",
    unreadMessageIds(THREAD).join(",") === "m1,m3"
  );
  check(
    "a thread already read needs no request at all",
    unreadMessageIds([{ id: "m1", isRead: true }]).length === 0
  );

  // The bug, in two lines.
  check(
    "marking only the newest leaves the conversation unread",
    conversationIsUnread(markNewestOnly(THREAD)) === true
  );
  check(
    "marking every unread one clears it",
    conversationIsUnread(markAll(THREAD, unreadMessageIds(THREAD))) === false
  );
});
