/**
 * One inbox from two providers.
 *
 * A Gmail mailbox and an Outlook mailbox, each served by a fake of the API it
 * really talks to, listed through the real core. What is checked is what the
 * reader sees: that a contact files the same way whichever mailbox it came
 * to, that a mail sent to both mailboxes is one row, that a snoozed thread
 * leaves the list and comes back on the Snoozed tab with the same row — and
 * that a thread which references a conversation is offered to the chat store
 * for adoption. That last one ran for nobody between 13 August and the day a
 * guard was read closely: it tested `!folder`, and the folder always has a
 * name.
 *
 * The mailboxes, people and words are invented. See AGENTS.md.
 */

import { listSnoozedThreads, listUnifiedInbox } from "@/lib/mail/inbox";
import {
  fakeMailProviders,
  fakeMailStore,
  GMAIL,
  OUTLOOK,
  OWNER,
} from "./fake-mail.mjs";
import { check, suite } from "./harness.mjs";

let storeCalls;
let requests;

suite(async () => {
  ({ calls: storeCalls } = fakeMailStore());
  ({ requests } = fakeMailProviders());

  const { threads, accounts } = await listUnifiedInbox({
    clerkUserId: OWNER, fresh: true,
  });
  const byId = new Map(threads.map((t) => [`${t.account}|${t.threadId}`, t]));

  check("both mailboxes are listed", accounts.length === 2, accounts.join(","));
  check("one row per conversation, the shared one folded",
    threads.length === 4, threads.map((t) => `${t.account}|${t.threadId}`).join(" "));

  // ---- One rule for both providers ---------------------------------------
  const g1 = byId.get(`${GMAIL}|g1`);
  const o1 = byId.get(`${OUTLOOK}|o1`);
  check("a contact files under People on Gmail", g1?.tab === "people", g1?.tab);
  check("and under People on Outlook", o1?.tab === "people", o1?.tab);
  check("with the same affiliation on both",
    g1?.crmName === "Alma Aagaard" && o1?.crmName === g1?.crmName,
    `${g1?.crmName} / ${o1?.crmName}`);
  check("a stranger files under Other",
    (byId.get(`${GMAIL}|g2`) ?? byId.get(`${OUTLOOK}|o2`))?.tab === "other");

  const g3 = byId.get(`${GMAIL}|g3`);
  check("our own reply faces the person we wrote to, not us",
    g3?.fromEmail === "alma@example.org", g3?.fromEmail);
  check("and the row carries the whole thread's count", g3?.messageCount === 2);

  // ---- A mail that reached both mailboxes -----------------------------------
  const shared = threads.filter((t) => t.tipId === "shared-1@example.net");
  check("the same message in two mailboxes is one row", shared.length === 1, shared.length);
  check("the row keeps the newest copy",
    shared[0]?.lastAt === "2026-08-16T12:00:00.000Z", shared[0]?.lastAt);
  check("and is unread if either copy is", shared[0]?.unread === true);

  // ---- Adoption runs for the inbox ------------------------------------------
  const offered = storeCalls.find((c) => c.op === "chats.findByMessageIds");
  check("a thread that answers an older message is offered to the chat store",
    offered != null && offered.args.messageIds.includes("<g3m1@example.org>"),
    JSON.stringify(offered?.args));

  // ---- Snoozed -------------------------------------------------------------
  ({ calls: storeCalls } = fakeMailStore({ snoozes: [
    { accountEmail: GMAIL, threadId: "g1", snoozedUntil: "2026-08-30T08:00:00.000Z",
      tipMessageId: "g1m1@example.org" },
    { accountEmail: OUTLOOK, threadId: "o1", snoozedUntil: "2026-08-31T08:00:00.000Z",
      tipMessageId: "o1m2@example.org" },
  ] }));
  ({ requests } = fakeMailProviders());
  const after = await listUnifiedInbox({ clerkUserId: OWNER, fresh: true });
  check("a snoozed thread leaves the inbox",
    !after.threads.some((t) => t.threadId === "g1" || t.threadId === "o1"),
    after.threads.map((t) => t.threadId).join(","));

  const snoozed = await listSnoozedThreads({ clerkUserId: OWNER });
  const sg = snoozed.threads.find((t) => t.threadId === "g1");
  const so = snoozed.threads.find((t) => t.threadId === "o1");
  check("and is on the Snoozed tab, from either provider",
    sg != null && so != null, snoozed.threads.map((t) => t.threadId).join(","));
  check("as the same row the inbox showed",
    sg?.tab === g1?.tab && sg?.fromName === g1?.fromName && sg?.crmName === g1?.crmName &&
      so?.tab === o1?.tab && so?.fromName === o1?.fromName,
    JSON.stringify({ sg, so }));
  check("with its wake time",
    sg?.snoozedUntil === "2026-08-30T08:00:00.000Z" &&
      so?.snoozedUntil === "2026-08-31T08:00:00.000Z",
    `${sg?.snoozedUntil} ${so?.snoozedUntil}`);
  check("the snoozed list does not mark the Outlook thread read",
    !requests.some((r) => r.method === "PATCH"),
    requests.filter((r) => r.method !== "GET").map((r) => r.url).join(" "));

  // ---- A search finds what is asleep -----------------------------------------
  const found = await listUnifiedInbox({ clerkUserId: OWNER, fresh: true, q: "good news" });
  const asleep = found.threads.find((t) => t.threadId === "g1");
  check("a search shows a snoozed thread",
    asleep != null, found.threads.map((t) => t.threadId).join(","));
  check("with its wake time on the row",
    asleep?.snoozedUntil === "2026-08-30T08:00:00.000Z", asleep?.snoozedUntil);
  const narrowed = await listSnoozedThreads({ clerkUserId: OWNER, q: "good news" });
  check("the Snoozed tab keeps the rows the search names",
    narrowed.threads.length === 1 && narrowed.threads[0].threadId === "g1",
    narrowed.threads.map((t) => t.threadId).join(","));
  const none = await listSnoozedThreads({ clerkUserId: OWNER, q: "jetblue" });
  check("and none when no row has the words", none.threads.length === 0);
  const clipped = await listSnoozedThreads({ clerkUserId: OWNER, q: "has:attachment" });
  check("a filter alone leaves the list whole", clipped.threads.length === snoozed.threads.length);
});
