/**
 * The thread view from the local copy must look exactly like the one from
 * the provider: the same window, the same reply target, the same names.
 */

import { threadFromLocalStore } from "@/lib/mail/local-thread";
import { setMailStore } from "@/lib/mail/store";

import { check, suite } from "./harness.mjs";

const me = "vera@example.com";

function row(id, at, from, extra = {}) {
  return {
    messageId: id,
    threadId: "t1",
    fromName: from.name,
    fromEmail: from.email,
    to: [{ name: "Vera", email: me }],
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

const ann = { name: "Ann Sender", email: "ann@sender.test" };
const rows = [
  row("m1", 1_000, ann),
  row("m2", 2_000, { name: "Vera", email: me }, { to: [{ name: "Ann", email: ann.email }] }),
  row("m3", 3_000, ann, {
    unread: true,
    body: {
      text: "see file",
      html: "<p>see file</p>",
      inlineImages: {},
      attachments: [{ section: "2", filename: "plan.pdf", mimeType: "application/pdf", size: 9 }],
    },
  }),
  row("d1", 4_000, { name: "Vera", email: me }, {
    isDraft: true,
    labels: ["DRAFT"],
    to: [{ name: "Ann", email: ann.email }],
    body: { text: "half a reply", html: null, inlineImages: {}, attachments: [] },
  }),
];

const marks = [];
setMailStore({
  settings: { get: async () => "on", set: async () => {} },
  sync: { list: async () => [{ account: me, folder: "", phase: "live" }], set: async () => {} },
  messages: {
    thread: async () => rows,
    setUnread: async (account, threadId, unread) => {
      marks.push({ account, threadId, unread });
    },
  },
  chats: {
    findBinding: async () => null,
    reconcilePartCount: async () => {},
  },
});

suite(async () => {
  const detail = await threadFromLocalStore(me, "t1");
  check("every message of a short thread is in the window", detail.messages.length === 3, detail.messages.length);
  check("the newest message from Ann makes her the reply target", detail.reply.to.join(",") === ann.email, detail.reply.to);
  check("reply-all keeps Ann and drops the mailbox itself", detail.reply.allTo.join(",") === ann.email, detail.reply.allTo);
  check("the thread's references end with the newest Message-ID", detail.reply.references.endsWith("<m3@x.test>"), detail.reply.references);
  check("participants name Ann and You", detail.participants.join(",") === "Ann Sender,You", detail.participants);
  check("the mailbox's own message is marked own", detail.messages[1].own === true && detail.messages[0].own === false);
  check("a file is named by its IMAP section", detail.messages[2].attachments[0].attachmentId === "imap:2", detail.messages[2].attachments);
  check("opening marks the thread read in the copy", marks.length === 1 && marks[0].unread === false, JSON.stringify(marks));
  check("the count is the whole thread, drafts left out", detail.totalMessageCount === 3);
  check("the thread's draft is offered back to the composer", detail.providerDraft?.ref === "d1" && detail.providerDraft.bodyText === "half a reply", JSON.stringify(detail.providerDraft));

  const paged = await threadFromLocalStore(me, "t1", { limit: 2, markRead: false });
  check("a limit keeps the newest and says more lie older", paged.messages.map((m) => m.id).join(",") === "m2,m3" && paged.hasOlder === true && paged.hasNewer === false);
  const older = await threadFromLocalStore(me, "t1", { before: "m2", limit: 5, markRead: false });
  check("before pages back", older.messages.map((m) => m.id).join(",") === "m1" && older.hasNewer === true);
  const around = await threadFromLocalStore(me, "t1", { around: "m2", markRead: false });
  check("around centres on the message", around.messages.length === 3);
  check("paging does not mark read", marks.length === 1);
});
