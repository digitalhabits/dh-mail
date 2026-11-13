/**
 * A conversation started in one mailbox and answered from another is one
 * conversation: one row in the list, every message in the conversation
 * view, and an action on the row takes both halves.
 *
 * No message is in both mailboxes, so the two halves were two rows. They
 * are joined by the reply headers alone, as Thunderbird's index joins mail,
 * with one guard: the same subject, once "Re:" and the like are off. Inside
 * one mailbox the server's grouping stands. All addresses are invented.
 */

import { threadFromLocalStore } from "@/lib/mail/local-thread";
import { baseSubject } from "@/lib/mail/reply-subject";
import { setMailStore } from "@/lib/mail/store";
import { dedupeThreadsByTip, everyCopy } from "@/lib/mail/thread-copies";

import { check, suite } from "./harness.mjs";

const HOME = "vera@home.example";
const WORK = "vera@work.example";
const ann = { name: "Ann Sender", email: "ann@partner.example" };

/** A list row. `tip` is its newest message; `refs` are the messages that one names. */
const summary = (account, threadId, at, tip, refs, extra = {}) => ({
  account,
  threadId,
  subject: "RE: Exam question",
  fromName: "Ann Sender",
  fromEmail: ann.email,
  snippet: "",
  lastAt: new Date(at).toISOString(),
  unread: false,
  messageCount: 2,
  tab: "other",
  tipId: tip,
  ...(refs.length ? { tipRefs: refs } : null),
  ...extra,
});

function row(id, threadId, at, from, extra = {}) {
  return {
    messageId: `${threadId}-${id}`,
    threadId,
    fromName: from.name,
    fromEmail: from.email,
    to: [{ name: "Vera", email: HOME }],
    cc: [],
    bcc: [],
    subject: "RE: Exam question",
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

// HOME has Ann's two letters. WORK has the answer sent from there, and Ann's answer to it.
const threads = {
  [`${HOME}|h`]: [row("a1", "h", 1_000, ann), row("a2", "h", 2_000, ann, { inReplyTo: "<a1@x.test>", references: "<a1@x.test>" })],
  [`${WORK}|w`]: [
    row("r1", "w", 3_000, { name: "Vera", email: WORK }, { labels: ["SENT"], to: [ann], inReplyTo: "<a2@x.test>", references: "<a1@x.test> <a2@x.test>" }),
    row("a3", "w", 4_000, ann, { to: [{ name: "Vera", email: WORK }], subject: "SV: Exam question", inReplyTo: "<r1@x.test>", references: "<a1@x.test> <a2@x.test> <r1@x.test>" }),
  ],
};
const asked = [];
setMailStore({
  settings: { get: async () => "on", set: async () => {} },
  sync: { list: async () => [HOME, WORK].map((account) => ({ account, folder: "", phase: "live" })), set: async () => {} },
  messages: {
    thread: async (account, threadId) => threads[`${account}|${threadId}`] ?? [],
    // The store's own search is checked in the crate; here it answers as it would.
    copies: async (account, rfcIds, links) => {
      asked.push({ account, rfcIds, links });
      if (account === WORK && links?.refIds.includes("<a2@x.test>")) return [{ account: HOME, threadId: "h", linked: true }];
      if (account === HOME && rfcIds.includes("<a2@x.test>")) return [{ account: WORK, threadId: "w", linked: true }];
      return [];
    },
    setUnread: async () => {},
  },
  chats: { findBinding: async () => null, reconcilePartCount: async () => {} },
});

suite(async () => {
  // ---- The subject two halves share ---------------------------------------
  check("marks come off a subject, whatever their case or language", baseSubject("Re: RE: SV:  Exam   question") === "exam question" && baseSubject("Fwd: AW: Plans") === "plans");
  check("a word that only looks like a mark stays", baseSubject("Result: passed") === "result: passed");

  // ---- One row in the list -------------------------------------------------
  const older = summary(HOME, "h", 2_000, "a2@x.test", ["a1@x.test"], { unread: true });
  const newer = summary(WORK, "w", 4_000, "a3@x.test", ["a1@x.test", "a2@x.test", "r1@x.test"], { subject: "SV: Exam question" });
  const list = dedupeThreadsByTip([older, newer]);
  check("the two halves are one row, the newer one", list.length === 1 && list[0].threadId === "w", list.map((t) => t.threadId));
  check("the row remembers the other half", JSON.stringify(list[0].alsoIn) === JSON.stringify([{ account: HOME, threadId: "h" }]));
  check("it is unread when either half is, and counts both", list[0].unread === true && list[0].messageCount === 4);
  const acted = everyCopy({ account: WORK, threadId: "w" }, list).map((c) => `${c.account}|${c.threadId}`);
  check("an action on the row takes both halves", acted.join(",") === `${WORK}|w,${HOME}|h`, acted.join(","));

  // Put together again from the folded row and the same half fresh from its mailbox.
  const again = dedupeThreadsByTip([...list, older]);
  check("a half already folded is not a row again, and is not counted twice", again.length === 1 && again[0].messageCount === 4, JSON.stringify(again.map((t) => [t.threadId, t.messageCount])));

  // The guards.
  const sameBox = dedupeThreadsByTip([summary(HOME, "h", 2_000, "a2@x.test", []), summary(HOME, "h2", 4_000, "a3@x.test", ["a2@x.test"])]);
  check("inside one mailbox the server's grouping stands", sameBox.length === 2);
  const newTopic = dedupeThreadsByTip([older, { ...newer, subject: "Budget for next year" }]);
  check("a reply that starts another topic is another conversation", newTopic.length === 2);
  const unrelated = dedupeThreadsByTip([older, summary(WORK, "x", 4_000, "z9@x.test", ["z1@x.test"])]);
  check("rows with no header in common stay apart", unrelated.length === 2);

  // Someone else answered the same letter under a new subject, and later. It must
  // not stand in the way: the older half still joins the conversation it belongs to.
  const offTopic = summary("vera@third.example", "s", 9_000, "s1@x.test", ["a2@x.test"], { subject: "Re: sad news" });
  const withOffTopic = dedupeThreadsByTip([older, newer, offTopic]);
  check(
    "a newer reply under another subject does not keep the two halves apart",
    withOffTopic.length === 2 && withOffTopic.find((t) => t.threadId === "w")?.alsoIn?.[0].threadId === "h" && !withOffTopic.find((t) => t.threadId === "s")?.alsoIn,
    JSON.stringify(withOffTopic.map((t) => [t.threadId, t.alsoIn]))
  );

  // Three halves: each names the one before.
  const third = summary("vera@third.example", "t", 6_000, "c1@x.test", ["a3@x.test"]);
  const chain = dedupeThreadsByTip([older, third, newer]);
  check("a conversation that went through three mailboxes is one row", chain.length === 1 && chain[0].threadId === "t" && chain[0].alsoIn.length === 2, JSON.stringify(chain.map((t) => t.alsoIn)));

  // ---- Every message in the conversation ----------------------------------
  const fromWork = await threadFromLocalStore(WORK, "w", { markRead: false });
  check("opened from the newer half, the conversation has all four messages in order", fromWork.messages.map((m) => m.rfcMessageId).join(",") === "<a1@x.test>,<a2@x.test>,<r1@x.test>,<a3@x.test>", fromWork.messages.map((m) => m.rfcMessageId));
  const sentLinks = asked.find((a) => a.account === WORK)?.links;
  check("the store is asked for the messages the conversation names and does not hold", sentLinks?.refIds.sort().join(",") === "<a1@x.test>,<a2@x.test>" && sentLinks.subject === "SV: Exam question", JSON.stringify(sentLinks));
  check("the messages of the other half say which mailbox they are in", fromWork.messages[0].account === HOME && fromWork.messages[3].account === undefined);
  check("a reply answers the newest message, from the mailbox that has it", fromWork.reply.inReplyTo === "<a3@x.test>" && fromWork.reply.from === undefined && fromWork.reply.to.join(",") === ann.email, JSON.stringify(fromWork.reply));

  const fromHome = await threadFromLocalStore(HOME, "h", { markRead: false });
  check("opened from the older half, it has all four too", fromHome.messages.length === 4 && fromHome.totalMessageCount === 4);
  check("and a reply goes from the mailbox the conversation moved to", fromHome.reply.from === WORK && fromHome.reply.inReplyTo === "<a3@x.test>", JSON.stringify(fromHome.reply));
});
