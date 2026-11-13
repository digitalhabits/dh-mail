/**
 * The list joins a conversation continued from another mailbox, through the
 * real list code: each mailbox is read on its own, as the page reads them,
 * and the page folds the rows. Addresses and ids are invented; the ids have
 * capital letters, as some servers write them.
 */

import { invalidateMailCaches, listUnifiedInbox } from "@/lib/mail/inbox";
import { forgetSyncStates } from "@/lib/mail/local-store";
import { dedupeThreadsByTip } from "@/lib/mail/thread-copies";
import { fakeMailStore, GMAIL, OUTLOOK, OWNER } from "./fake-mail.mjs";
import { check, suite } from "./harness.mjs";

const AT = Date.UTC(2026, 10, 5, 15, 0);
const LETTER = "<2763ABCD-E437-4787@Sender.Example>";
const ANSWER = "<e89ffb57@partner.example>";

const thread = (account, threadId, at, subject, latest) => ({
  account,
  threadId,
  subject,
  lastAt: at,
  messageCount: 1,
  unread: false,
  hasAttachments: false,
  starred: false,
  isDraft: false,
  labels: [],
  latest: { messageId: `${threadId}-m`, fromName: "Ann", fromEmail: "ann@partner.example", to: [], snippet: "", sentAt: at, unread: false, ...latest },
  participants: [],
  senders: [],
});

// The letter, sent from one mailbox. The answer to it came to the other, and the reader answered there.
const letter = thread(OUTLOOK, "o1", AT, "Monthly update + drop-in: now", { rfcMessageId: LETTER, inReplyTo: null, references: null });
const replies = thread(GMAIL, "g1", AT + 60_000, "Re: RE: Monthly update + drop-in: now", {
  rfcMessageId: "<mw3p@mail.example>",
  inReplyTo: ANSWER,
  references: `${LETTER} ${ANSWER}`,
});
replies.messageCount = 2;

suite(async () => {
  fakeMailStore();
  const inner = globalThis.window.__TAURI__.core.invoke;
  globalThis.window.__TAURI__.core.invoke = async (cmd, args) => {
    if (cmd === "mail_store_call" && args.op === "sync.list") {
      return [GMAIL, OUTLOOK].map((account) => ({ account, folder: "", phase: "live", fullSyncDone: 1, fullSyncTotal: 1, lastOkAt: AT }));
    }
    if (cmd === "mail_store_call" && args.op === "messages.search") {
      return { threads: args.args.accounts[0] === GMAIL ? [replies] : [letter], handled: true };
    }
    return inner(cmd, args);
  };
  forgetSyncStates();
  invalidateMailCaches();

  const fromGmail = await listUnifiedInbox({ clerkUserId: OWNER, account: GMAIL, q: "monthly update", fresh: true });
  const fromOutlook = await listUnifiedInbox({ clerkUserId: OWNER, account: OUTLOOK, q: "monthly update", fresh: true });
  const g = fromGmail.threads[0];
  const o = fromOutlook.threads[0];
  check("the newer half says which messages its newest one names", JSON.stringify(g?.tipRefs) === JSON.stringify(["2763abcd-e437-4787@sender.example", "e89ffb57@partner.example"]), JSON.stringify(g?.tipRefs));
  check("the older half's tip is written the same way", o?.tipId === "2763abcd-e437-4787@sender.example", o?.tipId);

  const rows = dedupeThreadsByTip([...fromOutlook.threads, ...fromGmail.threads]);
  check("the page shows one row for the two halves", rows.length === 1 && rows[0].threadId === "g1" && rows[0].messageCount === 3, JSON.stringify(rows.map((t) => [t.account, t.threadId, t.messageCount, t.subject])));
});
