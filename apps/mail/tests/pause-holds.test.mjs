/**
 * What a paused mailbox holds back, on every path that shows mail.
 *
 * A tester saw a colleague's reply in the Sent list of a paused mailbox
 * (2026-11-12): the row had the reply's time and first words, and the open
 * conversation did not have the reply. The review that followed found more
 * paths with no cut-off. Each has a check here. The store's own checks (the
 * Sent list, marking read) are in the crate. All names are invented.
 */

import { holdPausedFolderCounts, bumpHeldFolderCount } from "@/lib/mail/folder-counts";
import { readUpTo } from "@/lib/mail/live-read";
import { detailWithoutHeldBack, threadFromLocalStore } from "@/lib/mail/local-thread";
import { pauseCutOff, readLastLiveReads, writeLiveReads } from "@/lib/mail/pause-cut-off";
import { MAIL_LAST_LIVE_READ_KEY, MAIL_PAUSE_KEY } from "@/lib/mail/storage-keys";
import { setMailStore } from "@/lib/mail/store";
import { setOwnMailIdentity } from "@/lib/own-addresses";

import { check, suite } from "./harness.mjs";

const me = "vera@faculty.test";
const colleague = { name: "Bo Colleague", email: "bo@faculty.test" };
const items = new Map();
globalThis.window = globalThis.window ?? {};
globalThis.window.localStorage = {
  getItem: (k) => (items.has(k) ? items.get(k) : null),
  setItem: (k, v) => void items.set(k, String(v)),
  removeItem: (k) => void items.delete(k),
};

const HOUR = 60 * 60 * 1000;
const cut = Date.now() - 2 * HOUR;
const pause = () => items.set(MAIL_PAUSE_KEY, JSON.stringify({ pausedUntil: Date.now() + HOUR, quietHours: [] }));
const resume = () => items.set(MAIL_PAUSE_KEY, JSON.stringify({ quietHours: [] }));

function row(id, at, from, extra = {}) {
  return {
    messageId: id,
    threadId: "t1",
    fromName: from.name,
    fromEmail: from.email,
    to: [{ name: "Vera", email: me }],
    cc: [],
    bcc: [],
    subject: "Exam question",
    snippet: "",
    sentAt: at,
    hasAttachments: false,
    unread: false,
    starred: false,
    isDraft: false,
    labels: ["INBOX"],
    rfcMessageId: `<${id}@x.test>`,
    body: { text: `body of ${id}`, html: null, inlineImages: {}, attachments: [] },
    ...extra,
  };
}

// An old letter, the reader's answer sent in the pause from another address
// of theirs, and a colleague's reply that came in during the pause.
const rows = [
  row("m1", cut - HOUR, colleague, { unread: true }),
  row("m2", cut + 10, { name: "Vera", email: "vera.alias@faculty.test" }, { labels: ["SENT"], to: [colleague] }),
  row("m3", cut + 20, colleague, { unread: true }),
];

const marks = [];
let newest = cut - HOUR;
setMailStore({
  settings: { get: async () => "on", set: async () => {} },
  sync: { list: async () => [{ account: me, folder: "", phase: "live" }], set: async () => {} },
  messages: {
    thread: async () => rows,
    list: async () => ({ threads: newest == null ? [] : [{ lastAt: newest }], nextBefore: null }),
    setUnread: async (account, threadId, unread, asOf) => {
      marks.push({ account, threadId, unread, asOf: asOf ?? null });
    },
  },
  chats: { findBinding: async () => null, reconcilePartCount: async () => {} },
});

suite(async () => {
  // A colleague is on the reader's own domain. That must not make their mail
  // the reader's own: a pause holds it back like any mail that comes in.
  setOwnMailIdentity({ addresses: [me], domains: ["faculty.test"] });
  pause();
  writeLiveReads({ [me]: cut });

  const paused = await threadFromLocalStore(me, "t1");
  check(
    "a colleague's reply that came in during the pause is not in the conversation",
    paused.messages.map((m) => m.id).join(",") === "m1,m2",
    paused.messages.map((m) => m.id)
  );
  check("mail the mailbox sent in the pause shows, from an alias too", paused.messages.some((m) => m.id === "m2"));
  check("the count leaves the held-back reply out", paused.totalMessageCount === 2, paused.totalMessageCount);
  check("a reply answers the newest message that shows", paused.reply.inReplyTo === "<m2@x.test>", paused.reply.inReplyTo);
  check(
    "opening it marks read only up to the cut-off, so the reply is still unread after the pause",
    marks.length === 1 && marks[0].unread === false && marks[0].asOf === cut,
    JSON.stringify(marks)
  );

  resume();
  marks.length = 0;
  const open = await threadFromLocalStore(me, "t1");
  check("with no pause, the reply is there", open.messages.map((m) => m.id).join(",") === "m1,m2,m3");
  check("and the whole thread is marked read", marks.length === 1 && marks[0].asOf === null, JSON.stringify(marks));

  // ---- A thread the provider answered (Outlook, or Gmail's API) -----------
  const iso = (at) => new Date(at).toISOString();
  const message = (id, at, from, to) => ({
    id,
    fromName: from,
    fromEmail: from,
    toEmails: to,
    ccEmails: [],
    sentAt: iso(at),
    bodyText: id,
    own: from === me,
    rfcMessageId: `<${id}@x.test>`,
  });
  const detail = {
    account: me,
    threadId: "t9",
    subject: "Exam question",
    participants: ["You", "bo"],
    messages: [
      message("p1", cut - HOUR, colleague.email, [me]),
      message("p2", cut - 10, me, [colleague.email]),
      message("p3", cut + 30, "dean@faculty.test", [me, colleague.email]),
    ],
    hasOlder: false,
    hasNewer: false,
    totalMessageCount: 3,
    reply: { inReplyTo: "<p3@x.test>", references: "<p3@x.test>", to: ["dean@faculty.test"], cc: [], allTo: ["dean@faculty.test", colleague.email], allCc: [] },
  };
  check("with no pause, a provider's thread is left as it is", detailWithoutHeldBack(detail).detail === detail);
  pause();
  const cutDetail = detailWithoutHeldBack(detail);
  check("paused, the provider's thread loses the mail held back", cutDetail.held === 1 && cutDetail.detail.messages.map((m) => m.id).join(",") === "p1,p2");
  check("its count follows", cutDetail.detail.totalMessageCount === 2);
  check(
    "and a reply does not go to the sender of the held-back mail",
    cutDetail.detail.reply.inReplyTo === "<p2@x.test>" && !cutDetail.detail.reply.to.includes("dean@faculty.test"),
    JSON.stringify(cutDetail.detail.reply)
  );

  // ---- A paused mailbox that was never read live --------------------------
  const before = Date.now();
  const first = pauseCutOff("new@faculty.test");
  check("a paused mailbox never read live gets a cut-off at its first look", first != null && first >= before, first);
  check("and keeps it", pauseCutOff("new@faculty.test") === first && readLastLiveReads()["new@faculty.test"] === first);
  resume();
  check("a mailbox that is not paused has no cut-off, and none is noted", pauseCutOff("other@faculty.test") === null && readLastLiveReads()["other@faculty.test"] === undefined);

  // The settings cannot be written (private mode): the note is kept in the window.
  const set = window.localStorage.setItem;
  window.localStorage.setItem = () => {
    throw new Error("no storage");
  };
  writeLiveReads({ "private@faculty.test": 42 });
  window.localStorage.setItem = set;
  check("a read that cannot be saved is still kept for this window", readLastLiveReads()["private@faculty.test"] === 42);
  check("the saved reads are not lost by it", JSON.parse(items.get(MAIL_LAST_LIVE_READ_KEY))[me] === cut);

  // ---- How far a live read reached ----------------------------------------
  const now = Date.now();
  check("a read from the copy reached the copy's newest mail, not the time of the read", (await readUpTo(me, "gmail", now)) === newest + 1);
  newest = now + HOUR;
  check("never later than the read itself", (await readUpTo(me, "gmail", now)) === now);
  newest = null;
  check("an empty copy: the time of the read", (await readUpTo(me, "gmail", now)) === now);
  check("a mailbox with no copy: the time of the read", (await readUpTo("nocopy@faculty.test", "gmail", now)) === now);

  // ---- Folder counts ------------------------------------------------------
  const held = new Map();
  const folders = (count) => [{ account: me, name: "Exams", count }];
  let pausedNow = false;
  const isPaused = () => pausedNow;
  check("a live mailbox shows the count it is given", holdPausedFolderCounts(folders(4), held, isPaused)[0].count === 4);
  pausedNow = true;
  check("paused, mail filed in a folder does not move its count", holdPausedFolderCounts(folders(6), held, isPaused)[0].count === 4);
  check("a list with no counts in it takes the held count too", holdPausedFolderCounts(folders(0), held, isPaused, false)[0].count === 4);
  bumpHeldFolderCount(held, me, "Exams", 1);
  check("the reader's own move still counts", holdPausedFolderCounts(folders(7), held, isPaused)[0].count === 5);
  pausedNow = false;
  check("after the pause, the count is the real one", holdPausedFolderCounts(folders(7), held, isPaused)[0].count === 7);
});
