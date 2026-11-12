/**
 * A thread read while its mailbox was paused leaves out the mail the pause
 * held back. When the pause ends, the conversation and the list's tip are
 * the same as before, so the cached thread must not be used: it would keep
 * the new mail out for good (reported 2026-11-11). All data is invented.
 */

import { MAIL_LAST_LIVE_READ_KEY, MAIL_PAUSE_KEY } from "@/lib/mail/storage-keys";
import { getCachedMailThread, setCachedMailThread } from "@/lib/mail/thread-cache";
import { check, suite } from "./harness.mjs";

const ACCOUNT = "vera@mail.test";
const items = new Map();
globalThis.window = globalThis.window ?? {};
globalThis.window.localStorage = {
  getItem: (k) => (items.has(k) ? items.get(k) : null),
  setItem: (k, v) => void items.set(k, String(v)),
  removeItem: (k) => void items.delete(k),
};

const thread = {
  account: ACCOUNT,
  threadId: "t1",
  subject: "Plans",
  participants: ["You"],
  messages: [{ id: "m1", fromName: "You", fromEmail: ACCOUNT, toEmails: [], ccEmails: [], sentAt: "2026-11-10T14:53:00Z", bodyText: "Hi", own: true }],
};

suite(async () => {
  // Paused for an hour from now, last read live yesterday afternoon.
  items.set(MAIL_PAUSE_KEY, JSON.stringify({ pausedUntil: Date.now() + 60 * 60 * 1000, quietHours: [] }));
  items.set(MAIL_LAST_LIVE_READ_KEY, JSON.stringify({ [ACCOUNT]: Date.now() - 20 * 60 * 60 * 1000 }));
  setCachedMailThread(ACCOUNT, "t1", thread, "2026-11-10T21:07:00Z");
  check("during the pause, the thread read under it is used", getCachedMailThread(ACCOUNT, "t1") != null);

  items.set(MAIL_PAUSE_KEY, JSON.stringify({ quietHours: [] }));
  check("after the pause, it is not: the held-back mail must be read", getCachedMailThread(ACCOUNT, "t1") == null);

  setCachedMailThread(ACCOUNT, "t1", thread, "2026-11-10T21:07:00Z");
  check("a thread read with no pause is used with no pause", getCachedMailThread(ACCOUNT, "t1") != null);
});
