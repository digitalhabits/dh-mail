/**
 * A conversation that reached two mailboxes shows every message.
 *
 * The list shows such a conversation as one row, and the thread view read
 * only that row's mailbox. A tester's reply, sent from his work mailbox,
 * was in that mailbox's Sent folder and not in his Gmail copy, so it was
 * missing from the conversation (2026-10-19). Now the other mailboxes'
 * copies are read too, and merged by Message-ID. Invented addresses.
 */

import { threadFromLocalStore, withLocalCopies } from "@/lib/mail/local-thread";
import { setMailStore } from "@/lib/mail/store";
import { replyFields } from "@/lib/mail/thread-composer-state";

import { check, suite } from "./harness.mjs";

const gmail = "tester@gmail.example";
const work = "tester@work.example";
const outlook = "tester@outlook.example";
const ann = { name: "Ann Sender", email: "ann@partner.example" };

function row(id, threadId, at, from, extra = {}) {
  return {
    messageId: `${threadId}-${id}`,
    threadId,
    fromName: from.name,
    fromEmail: from.email,
    to: [{ name: "Tester", email: work }],
    cc: [],
    bcc: [],
    subject: "Plans",
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

// Gmail has Ann's mail and her auto-reply; work has those and the reply.
const threads = {
  [`${gmail}|g`]: [row("m1", "g", 1_000, ann), row("m3", "g", 3_000, ann, { unread: true })],
  [`${work}|k`]: [
    row("m1", "k", 1_000, ann),
    row("m2", "k", 2_000, { name: "Tester", email: work }, {
      to: [{ name: "Ann", email: ann.email }, { name: "Tester", email: gmail }],
      labels: ["SENT"],
      unread: true,
    }),
    row("m3", "k", 3_000, ann),
  ],
};

const marks = [];
let copiesAsked = [];
function install(newestOnlyAtWork) {
  if (newestOnlyAtWork) {
    // The reply is the newest: Ann's auto-reply is gone from both.
    threads[`${gmail}|g`] = threads[`${gmail}|g`].filter((r) => !r.messageId.endsWith("m3"));
    threads[`${work}|k`] = threads[`${work}|k`].filter((r) => !r.messageId.endsWith("m3"));
  }
  setMailStore({
    settings: { get: async () => "on", set: async () => {} },
    sync: {
      list: async () => [
        { account: gmail, folder: "", phase: "live" },
        { account: work, folder: "", phase: "live" },
      ],
      set: async () => {},
    },
    messages: {
      thread: async (account, threadId) => threads[`${account}|${threadId}`] ?? [],
      copies: async (account, rfcIds) => {
        copiesAsked.push({ account, rfcIds });
        return (account === gmail || account === outlook) && rfcIds.includes("<m1@x.test>")
          ? [{ account: work, threadId: "k" }]
          : [];
      },
      setUnread: async (account, threadId, unread) => {
        marks.push({ account, threadId, unread });
      },
    },
    chats: { findBinding: async () => null, reconcilePartCount: async () => {} },
  });
}

suite(async () => {
  install(false);
  const detail = await threadFromLocalStore(gmail, "g");
  const ids = detail.messages.map((m) => m.rfcMessageId).join(",");
  check("the reply only the work mailbox has is in the conversation", ids === "<m1@x.test>,<m2@x.test>,<m3@x.test>", ids);
  const reply = detail.messages.find((m) => m.rfcMessageId === "<m2@x.test>");
  check("it carries the mailbox it is in", reply?.account === work, reply?.account);
  check("and is the reader's own", reply?.own === true);
  check("a message both mailboxes have is shown once, as this mailbox's", detail.messages.filter((m) => m.rfcMessageId === "<m1@x.test>").length === 1 && !detail.messages[0].account);
  check("the count is the whole conversation", detail.totalMessageCount === 3, detail.totalMessageCount);
  check("the newest message is in both: the reply goes from this mailbox", detail.reply.from === undefined, detail.reply.from);
  const read = marks.map((m) => `${m.account}|${m.threadId}`).sort().join(",");
  check("opening reads the conversation in both mailboxes", read === `${gmail}|g,${work}|k`, read);

  install(true);
  const later = await threadFromLocalStore(gmail, "g", { markRead: false });
  check("when the reader's reply is the newest, the reply goes from its mailbox", later.reply.from === work, later.reply.from);
  check("to the people that reply went to, not to this mailbox", later.reply.to.join(",") === ann.email, later.reply.to);
  const fields = replyFields(later.reply, false);
  check("Reply opens with that mailbox as From", fields.fromAccount === work && fields.toList.map((r) => r.email).join(",") === ann.email, JSON.stringify(fields));
  check("with no other mailbox to go from, From is left as it is", !("fromAccount" in replyFields(detail.reply, true)));
  check("and reply-all leaves this mailbox out too", !later.reply.allTo.includes(gmail) && later.reply.allTo.includes(ann.email), later.reply.allTo);

  // A thread read from the provider, not the copy: Outlook over Graph.
  install(false);
  const fromGraph = (messages, hasOlder = false) => ({
    account: outlook,
    threadId: "o",
    subject: "Plans",
    participants: [],
    messages,
    hasOlder,
    hasNewer: false,
    totalMessageCount: messages.length,
    reply: { inReplyTo: "<m3@x.test>", references: "", to: [ann.email], cc: [], allTo: [], allCc: [] },
  });
  const graphMessage = (id, at) => ({
    id: `o-${id}`,
    rfcMessageId: `<${id}@x.test>`,
    fromName: ann.name,
    fromEmail: ann.email,
    sentAt: new Date(at).toISOString(),
  });
  const live = await withLocalCopies(fromGraph([graphMessage("m1", 1_000), graphMessage("m3", 3_000)]));
  const liveIds = live.messages.map((m) => m.rfcMessageId).join(",");
  check("a thread read from Outlook gains the reply only the work mailbox has", liveIds === "<m1@x.test>,<m2@x.test>,<m3@x.test>", liveIds);
  check("in its place in time, and counted", live.totalMessageCount === 3, live.totalMessageCount);
  const older = await withLocalCopies(fromGraph([graphMessage("m3", 3_000)], true));
  check("a window of the newest messages gains nothing older than it shows", older.messages.length === 1, older.messages.map((m) => m.rfcMessageId).join(","));
  const page = await withLocalCopies(fromGraph([graphMessage("m1", 1_000)]), { before: "o-m3" });
  check("a page of older messages is left as it came", page.messages.length === 1);
});
