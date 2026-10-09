/**
 * Opening a thread, on each provider.
 *
 * What the reader sees when a row is opened: the messages in order with
 * their bodies, which ones are ours, whom a reply goes to, and what the
 * provider is told about read state. Gmail and Graph answer these from
 * different shapes, and the thread pane must not be able to tell which.
 */

import { getMailThread } from "@/lib/mail/inbox";
import {
  ALMA,
  fakeMailProviders,
  fakeMailStore,
  GMAIL,
  GMAIL_THREADS,
  gmailMessage,
  GRAPH_MESSAGES,
  graphMessage,
  OUTLOOK,
} from "./fake-mail.mjs";
import { check, suite } from "./harness.mjs";

suite(async () => {
  // ---- Gmail -----------------------------------------------------------------
  fakeMailStore();
  let { requests } = fakeMailProviders();
  let thread = await getMailThread(GMAIL, "g3", { messageCountHint: 2 });

  check("gmail: every message, oldest first",
    thread.messages.map((m) => m.id).join(",") === "g3m1,g3m2",
    thread.messages.map((m) => m.id).join(","));
  check("gmail: the body is decoded from the part",
    thread.messages[0].bodyText === "Does Thursday work?", thread.messages[0].bodyText);
  check("gmail: the html part comes along",
    thread.messages[0].bodyHtml === "<p>Does <b>Thursday</b> work?</p>");
  check("gmail: our reply is marked as ours",
    thread.messages[0].own === false && thread.messages[1].own === true);
  check("gmail: the count is the whole thread", thread.totalMessageCount === 2);
  check("gmail: a reply to our own last message goes to whom we wrote",
    thread.reply.to.join(",") === ALMA.email, thread.reply.to.join(","));
  check("gmail: and threads under the tip",
    thread.reply.inReplyTo === "<g3m2@gmail.com>" &&
      thread.reply.references === "<g3m1@example.org> <g3m2@gmail.com>",
    thread.reply.references);
  check("gmail: the participants name the other side, then You",
    thread.participants.join("|") === "Alma Aagaard|You", thread.participants.join("|"));
  check("gmail: a short thread costs one call",
    requests.filter((r) => r.method === "GET" && r.url.includes("/threads/g3")).length === 1,
    requests.filter((r) => r.url.includes("/threads/")).map((r) => r.url).join(" "));

  // Read state travels as a label change on the thread. Give the void call a
  // tick to land in the request log.
  await new Promise((r) => setTimeout(r, 0));
  const modify = requests.find((r) => r.url.endsWith("/threads/g3/modify"));
  check("gmail: opening marks the thread read",
    modify?.method === "POST" && modify.body.removeLabelIds.includes("UNREAD"),
    JSON.stringify(modify?.body));

  ({ requests } = fakeMailProviders());
  await getMailThread(GMAIL, "g1", { markRead: false });
  await new Promise((r) => setTimeout(r, 0));
  check("gmail: a prefetch leaves the unread badge alone",
    !requests.some((r) => r.url.endsWith("/modify")));

  // ---- A Gmail thread with a draft, split from an older one -----------------------
  // Only for these checks, and taken out after. Its first message answers
  // one in another thread (Gmail split the conversation), and Gmail holds
  // an unsent reply in it.
  const draft = gmailMessage("g9d", "g9", {
    From: GMAIL, To: "Alma Aagaard <alma@example.org>", Subject: "Re: Keys",
    Date: "Tue, 18 Aug 2026 10:00:00 +0000", "Message-ID": "<g9d@gmail.com>",
  }, { text: "Half written." });
  draft.labelIds = ["DRAFT"];
  GMAIL_THREADS.g9 = [
    gmailMessage("g9m1", "g9", {
      From: "Alma Aagaard <alma@example.org>", To: GMAIL, Subject: "Re: Keys",
      Date: "Tue, 18 Aug 2026 09:00:00 +0000", "Message-ID": "<g9m1@example.org>",
      "In-Reply-To": "<keys-0@example.org>", References: "<keys-0@example.org>",
    }, { text: "Found them." }),
    draft,
  ];
  const ids = (t) => t.messages.map((m) => m.id).join(",");
  for (const [how, extra] of [["in one call", { messageCountHint: 1 }], ["from the id list", {}]]) {
    const store = fakeMailStore();
    fakeMailProviders();
    const g9 = await getMailThread(GMAIL, "g9", { markRead: false, ...extra });
    check(`gmail: the draft is not a message (${how})`, ids(g9) === "g9m1", ids(g9));
    check(`gmail: the draft Gmail holds comes with the thread (${how})`,
      g9.providerDraft?.ref === "g9d" && g9.providerDraft?.bodyText === "Half written." &&
        g9.providerDraft?.to.join() === ALMA.email,
      JSON.stringify(g9.providerDraft));
    const lookup = store.calls.find((c) => c.op === "chats.findByMessageIds");
    check(`gmail: a thread that answers older mail asks for the conversation it belongs to (${how})`,
      String(JSON.stringify(lookup?.args?.messageIds ?? null)).includes("<keys-0@example.org>"),
      JSON.stringify(lookup));
  }
  delete GMAIL_THREADS.g9;

  // ---- Outlook -------------------------------------------------------------------
  fakeMailStore();
  ({ requests } = fakeMailProviders());
  thread = await getMailThread(OUTLOOK, "o1");

  check("outlook: every message, oldest first",
    thread.messages.map((m) => m.id).join(",") === "o1m1,o1m2",
    thread.messages.map((m) => m.id).join(","));
  // Graph answers html only, so the text comes from it. An inline tag
  // leaves nothing behind: not "Friday .", which it was for a year.
  check("outlook: the body text is the html, stripped",
    thread.messages[1].bodyText === "Make that Friday.", thread.messages[1].bodyText);
  check("outlook: and the html is kept",
    thread.messages[1].bodyHtml === "<p>Make that <i>Friday</i>.</p>");
  check("outlook: the count is known when the window is the whole conversation",
    thread.totalMessageCount === 2, thread.totalMessageCount);
  check("outlook: a reply goes to the sender",
    thread.reply.to.join(",") === ALMA.email, thread.reply.to.join(","));
  check("outlook: and threads under the tip",
    thread.reply.inReplyTo === "<o1m2@example.org>", thread.reply.inReplyTo);
  check("outlook: the participants name the other side",
    thread.participants.join("|") === "Alma Aagaard", thread.participants.join("|"));

  await new Promise((r) => setTimeout(r, 0));
  const patched = requests.filter((r) => r.method === "PATCH");
  check("outlook: opening marks every unread message read, not only the newest",
    patched.length === 1 && patched[0].url.endsWith("/me/messages/o1m2") &&
      patched[0].body.isRead === true,
    patched.map((r) => r.url).join(" "));

  ({ requests } = fakeMailProviders());
  await getMailThread(OUTLOOK, "o1", { markRead: false });
  await new Promise((r) => setTimeout(r, 0));
  check("outlook: a prefetch leaves the unread badge alone",
    !requests.some((r) => r.method === "PATCH"));

  // A conversation of three for this check alone: two unread from Alma,
  // then our own answer. Taken out again after, so no other check sees it.
  const extra = [
    graphMessage("o9m1", "o9", { subject: "Keys", from: ALMA.email, fromName: ALMA.name, to: [OUTLOOK], at: "2026-08-17T09:00:00Z", rfcId: "<o9m1@example.org>", html: "<p>Keys?</p>", read: false }),
    graphMessage("o9m2", "o9", { subject: "Re: Keys", from: ALMA.email, fromName: ALMA.name, to: [OUTLOOK], at: "2026-08-17T10:00:00Z", rfcId: "<o9m2@example.org>", html: "<p>Found them.</p>", read: false }),
    graphMessage("o9m3", "o9", { subject: "Re: Keys", from: OUTLOOK, fromName: "Me", to: [ALMA.email], at: "2026-08-17T11:00:00Z", rfcId: "<o9m3@example.org>", html: "<p>Good.</p>" }),
  ];
  GRAPH_MESSAGES.push(...extra);
  ({ requests } = fakeMailProviders());
  const keys = await getMailThread(OUTLOOK, "o9");
  await new Promise((r) => setTimeout(r, 0));
  const keysPatched = requests.filter((r) => r.method === "PATCH").map((r) => r.url.split("/").pop()).sort();
  check("outlook: with two unread, opening marks both read",
    keysPatched.join(",") === "o9m1,o9m2", keysPatched.join(","));
  check("outlook: the participants are the other side, then You",
    keys.participants.join("|") === "Alma Aagaard|You", keys.participants.join("|"));
  check("outlook: our own last message is answered to the other side",
    keys.reply.to.join(",") === ALMA.email, keys.reply.to.join(","));
  GRAPH_MESSAGES.splice(GRAPH_MESSAGES.length - extra.length, extra.length);

  // ---- The same shape from both -------------------------------------------------
  const g = await getMailThread(GMAIL, "g1", { markRead: false });
  const o = await getMailThread(OUTLOOK, "o1", { markRead: false });
  const shape = (t) => Object.keys(t).sort().join(",");
  check("both providers answer the same fields",
    shape(g) === shape(o), `${shape(g)} / ${shape(o)}`);

  // ---- A page of a Gmail thread ---------------------------------------------------
  // g3 holds two messages, oldest first. A page of one shows the one asked for.
  const newest = await getMailThread(GMAIL, "g3", { markRead: false, limit: 1 });
  check("gmail: a page of one is the newest message, with an older one behind it",
    ids(newest) === "g3m2" && newest.hasOlder === true && newest.hasNewer === false,
    `${ids(newest)} older:${newest.hasOlder}`);
  const oldest = await getMailThread(GMAIL, "g3", { markRead: false, limit: 1, oldest: true });
  check("gmail: the oldest page is the first message",
    ids(oldest) === "g3m1" && oldest.hasNewer === true, ids(oldest));
  const before = await getMailThread(GMAIL, "g3", { markRead: false, limit: 1, before: "g3m2" });
  check("gmail: before a message, the one before it", ids(before) === "g3m1", ids(before));
  const after = await getMailThread(GMAIL, "g3", { markRead: false, limit: 1, after: "g3m2" });
  check("gmail: after the last message, nothing", after.messages.length === 0, ids(after));

  let refused = null;
  // ---- A page of an Outlook conversation ------------------------------------------
  // The fake Graph answers the whole conversation whatever the filter, so
  // these check what is asked, and the flags the page is given.
  const plainUrls = (rs) => rs.map((r) => decodeURIComponent(r.url.replace(/\+/g, " ")));
  ({ requests } = fakeMailProviders());
  const olderPage = await getMailThread(OUTLOOK, "o1", { markRead: false, before: "o1m2" });
  check("outlook: before a message asks for what came before its time",
    plainUrls(requests).some((u) => /conversationId eq 'o1'/.test(u) && /receivedDateTime lt 2026-08-15T11:00:00Z/.test(u)),
    plainUrls(requests).join("\n"));
  check("outlook: and that page has newer messages after it", olderPage.hasNewer === true);
  check("outlook: a page back offers no draft", olderPage.providerDraft === undefined);

  ({ requests } = fakeMailProviders());
  const newerPage = await getMailThread(OUTLOOK, "o1", { markRead: false, after: "o1m1" });
  check("outlook: after a message asks for what came after its time",
    plainUrls(requests).some((u) => /receivedDateTime gt 2026-08-15T10:00:00Z/.test(u)),
    plainUrls(requests).join("\n"));
  check("outlook: and that page has older messages before it", newerPage.hasOlder === true);

  ({ requests } = fakeMailProviders());
  const aroundPage = await getMailThread(OUTLOOK, "o1", { markRead: false, around: "o1m1" });
  check("outlook: around a search hit reads the hit itself",
    requests.some((r) => /\/me\/messages\/o1m1(\?|$)/.test(r.url)) && aroundPage.messages.some((m) => m.id === "o1m1"),
    ids(aroundPage));

  refused = null;
  try {
    await getMailThread(OUTLOOK, "o1", { markRead: false, oldest: true });
  } catch (err) {
    refused = err;
  }
  check("outlook: the oldest page is refused, not guessed", refused?.status === 501, `${refused?.status} ${refused?.message}`);

  // ---- A thread that is not there ---------------------------------------------
  refused = null;
  try {
    await getMailThread(OUTLOOK, "nope", { markRead: false });
  } catch (err) {
    refused = err;
  }
  check("outlook: an empty conversation is not found", refused?.status === 404,
    `${refused?.status} ${refused?.message}`);
});
