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

  // ---- The same shape from both -------------------------------------------------
  const g = await getMailThread(GMAIL, "g1", { markRead: false });
  const o = await getMailThread(OUTLOOK, "o1", { markRead: false });
  const shape = (t) => Object.keys(t).sort().join(",");
  check("both providers answer the same fields",
    shape(g) === shape(o), `${shape(g)} / ${shape(o)}`);

  // ---- A thread that is not there ---------------------------------------------
  let refused = null;
  try {
    await getMailThread(OUTLOOK, "nope", { markRead: false });
  } catch (err) {
    refused = err;
  }
  check("outlook: an empty conversation is not found", refused?.status === 404,
    `${refused?.status} ${refused?.message}`);
});
