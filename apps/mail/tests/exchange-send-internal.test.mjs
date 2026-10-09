/**
 * Sending from an Exchange (EWS) mailbox (phase 4, section 13 of
 * docs/mail-exchange-ews.md).
 *
 * The MIME is the same the Gmail path builds, and it goes to Rust whole,
 * with the Bcc addresses beside it (the server can drop a Bcc header). This
 * decodes what Rust would get and reads it: the headers of a reply, the
 * forward below the words, a file, and the name on From from the copy of
 * Sent Items. Send later is refused (section 17.1: on KU a held message
 * cannot be cancelled), and held messages still list, cancel, and go now
 * (section 16.4). Nothing goes over
 * fetch.
 *
 * Built as the internal app.
 */

import { invalidateConnectedMailAccountsCache } from "@/lib/mail/connected-accounts-cache";
import {
  cancelScheduledMailMessage,
  listAllScheduledMailMessages,
  listScheduledMailMessages,
  sendMailMessage,
  sendScheduledMailMessageNow,
} from "@/lib/mail/inbox";

import { check, suite } from "./harness.mjs";

const EX = "someone@mail.example.com";

const fetched = [];
globalThis.fetch = async (url) => {
  fetched.push(String(url));
  return new Response("{}", { status: 500 });
};

const sent = [];
const later = [];
const heldCalls = [];
function storeCall(op, args) {
  switch (op) {
    case "accounts.exists":
      return args.provider === "exchange" && args.email === EX;
    case "accounts.listForOwner":
    case "accounts.listAll":
      return args.provider === "exchange" ? [{ email: EX, ownerId: "local", historyId: null, lastSyncedAt: null, lastSyncError: null, inMailTab: true }] : [];
    case "messages.list":
      // The newest message in Sent Items, for the name on From.
      return args.view === "sent"
        ? { threads: [{ latest: { fromEmail: EX, fromName: "Sam Example", to: [], snippet: "", sentAt: 1, unread: false, messageId: "s1" } }], nextBefore: null }
        : { threads: [], nextBefore: null };
    case "settings.get":
      return args.key.startsWith("mail_signature") ? JSON.stringify({ signature: "Sam Example\nThe Workshop" }) : null;
    case "sync.list":
      return [{ account: EX, folder: "", phase: "live" }];
    default:
      return null;
  }
}

globalThis.window = {
  __TAURI__: {
    core: {
      invoke: async (cmd, args) => {
        if (cmd === "mail_store_call") return storeCall(args.op, args.args);
        if (cmd === "mail_ews_send") {
          sent.push(args);
          return { sent: true };
        }
        if (cmd === "mail_ews_send_later") {
          later.push(args);
          return null;
        }
        if (cmd === "mail_ews_held") {
          return [
            {
              id: "held-1", sendAt: "2026-10-01T08:00:00Z", conversationId: "conv-1", subject: "The plan",
              to: [{ name: "Dana Example", email: "dana@example.com" }], cc: [], preview: "Monday is fine.",
              text: "Monday is fine.\nSee you.", html: "<p>Monday is fine.</p><p>See you.</p>",
            },
          ];
        }
        if (cmd === "mail_ews_cancel_held" || cmd === "mail_ews_send_held_now") {
          heldCalls.push({ cmd, ...args });
          return { itemId: "draft-1" };
        }
        throw new Error(`no such command in this test: ${cmd}`);
      },
    },
  },
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
};

const decode = (b64) => Buffer.from(b64, "base64").toString("utf8");
const header = (mime, name) => mime.split("\r\n\r\n")[0].split("\r\n").find((l) => l.toLowerCase().startsWith(`${name.toLowerCase()}:`)) ?? "";
/** Every base64 part's text, decoded, so the words can be read. */
const parts = (mime) =>
  [...mime.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)(?:\r\n--|$)/g)]
    .map((m) => Buffer.from(m[1].replace(/\s+/g, ""), "base64").toString("utf8"))
    .join("\n");

suite(async () => {
  invalidateConnectedMailAccountsCache();

  // ---- A reply to all, with a file --------------------------------------------------
  await sendMailMessage({
    account: EX,
    to: ["dana@example.com"],
    cc: ["kim@example.com"],
    bcc: ["hidden@example.com"],
    subject: "Re: The plan",
    body: "Monday is fine.",
    html: "<p>Monday is fine.</p>",
    inReplyTo: "<m1@mail.example.com>",
    references: "<m0@mail.example.com> <m1@mail.example.com>",
    attachments: [{ filename: "plan.pdf", mimeType: "application/pdf", contentBase64: "JVBERi0x" }],
  });
  check("one send over EWS", sent.length === 1);
  const mime = decode(sent[0]?.mime ?? "");
  check("From has the name from Sent Items", header(mime, "From").includes("Sam Example") && header(mime, "From").includes(EX), header(mime, "From"));
  check("To and Cc are in the MIME", header(mime, "To").includes("dana@example.com") && header(mime, "Cc").includes("kim@example.com"));
  check("Bcc is in the MIME", header(mime, "Bcc").includes("hidden@example.com"));
  check("and beside it, for a server that drops the header", sent[0]?.bcc?.join(",") === "hidden@example.com");
  check("a reply names what it answers", header(mime, "In-Reply-To") === "In-Reply-To: <m1@mail.example.com>");
  check("and its thread", header(mime, "References").includes("<m0@mail.example.com>"));
  check("the file is a part of its own", /Content-Disposition: attachment; filename="plan.pdf"/.test(mime));
  check("the words and the signature are in the body", parts(mime).includes("Monday is fine.") && parts(mime).includes("The Workshop"));

  // ---- A forward -----------------------------------------------------------------------
  sent.length = 0;
  await sendMailMessage({
    account: EX,
    to: ["kim@example.com"],
    subject: "Fwd: The plan",
    body: "For you.",
    forward: { fromName: "Dana Example", fromEmail: "dana@example.com", date: "21 Sep 2026", subject: "The plan", to: [EX], text: "The plan for Monday." },
  });
  check("a forward carries the message below the words", parts(decode(sent[0]?.mime ?? "")).includes("The plan for Monday."));

  // ---- Send later (section 16.4) -----------------------------------------------------
  sent.length = 0;
  let refused = "";
  try {
    await sendMailMessage({ account: EX, to: ["dana@example.com"], subject: "Later", body: "x", sendAt: new Date(Date.now() + 3_600_000).toISOString() });
  } catch (err) {
    refused = err.message;
  }
  check("send later from Exchange is refused, and nothing goes", refused.includes("Send later") && later.length === 0 && sent.length === 0, refused);

  const all = await listAllScheduledMailMessages({ clerkUserId: "local" });
  const row = all.find((r) => r.account === EX);
  check("the held message is in the group at the top", row?.id === "held-1" && row.sendAt === "2026-10-01T08:00:00.000Z");
  check("with its thread, its words, and who it goes to", row?.threadId === "conv-1" && row.bodyHtml?.includes("See you.") && row.toName === "Dana Example");
  check("and under its thread", (await listScheduledMailMessages({ account: EX, threadId: "conv-1" })).length === 1);
  check("but not under another", (await listScheduledMailMessages({ account: EX, threadId: "conv-2" })).length === 0);
  await cancelScheduledMailMessage({ account: EX, id: "held-1" });
  check("cancel goes over EWS", heldCalls.at(-1)?.cmd === "mail_ews_cancel_held" && heldCalls.at(-1)?.itemId === "held-1");
  await sendScheduledMailMessageNow({ account: EX, id: "held-1" });
  check("send now goes over EWS", heldCalls.at(-1)?.cmd === "mail_ews_send_held_now");

  check("nothing went over fetch", fetched.length === 0, fetched.join(", "));
});
