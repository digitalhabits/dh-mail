/**
 * Exchange (EWS) drafts, bodies in the background, and search (phase 5,
 * section 14 of docs/mail-exchange-ews.md).
 *
 * A draft here has a copy on the server. A new version replaces the old
 * one: saved first, the old one deleted after, soft. A draft sent or
 * discarded here takes its copy with it. The Drafts view lists the server's
 * drafts less this app's own copies. A draft discarded there goes to
 * Deleted Items, and never for good. The bodies of the last year come a
 * batch at a time, and stop on a busy server.
 *
 * The commands are faked at the shell. Built as the internal app.
 */

import { invalidateConnectedMailAccountsCache } from "@/lib/mail/connected-accounts-cache";
import { fillExchangeBodies, forgetExchangeBodyFill } from "@/lib/mail/exchange-bodies";
import { deleteExchangeDraftCopy, saveExchangeDraftCopy } from "@/lib/mail/exchange-drafts";
import { discardProviderDraft, listProviderDrafts, sendMailMessage } from "@/lib/mail/inbox";

import { installExchangeDraftCopy } from "../src/exchange-draft-copy";
import { check, suite } from "./harness.mjs";

const EX = "someone@mail.example.com";

const settings = {};
const commands = [];
let saves = 0;
let bodyAnswers = [];
/** A held step: while set, "accounts.exists" waits on it (a save in flight). */
let hold = null;
/** What "messages.thread" answers. */
let threadRows = [];
function storeCall(op, args) {
  switch (op) {
    case "messages.thread":
      return { messages: threadRows };
    case "accounts.exists":
      return args.provider === "exchange" && args.email === EX;
    case "accounts.listForOwner":
    case "accounts.listAll":
      return args.provider === "exchange" ? [{ email: EX, ownerId: "local", historyId: null, lastSyncedAt: null, lastSyncError: null, inMailTab: true }] : [];
    case "settings.get":
      return settings[args.key] ?? null;
    case "settings.set":
      settings[args.key] = args.value;
      return null;
    case "messages.list":
      if (args.view !== "drafts") return { threads: [], nextBefore: null };
      return {
        threads: ["draft-1", "their-draft"].map((id) => ({
          threadId: `c-${id}`, subject: "Plan", latest: { messageId: id, to: [], snippet: "", sentAt: 1, fromEmail: EX, fromName: "" },
        })),
        nextBefore: null,
      };
    case "sync.list":
      return [{ account: EX, folder: "", phase: "live" }];
    default:
      return null;
  }
}

const listeners = new Map();
globalThis.window = {
  __TAURI__: {
    core: {
      invoke: async (cmd, args) => {
        commands.push({ cmd, ...args });
        if (cmd === "mail_store_call") {
          if (hold && args.op === "accounts.exists") await hold;
          return storeCall(args.op, args.args);
        }
        if (cmd === "mail_ews_save_draft") return { itemId: `draft-${++saves}` };
        if (cmd === "mail_ews_delete_draft" || cmd === "mail_ews_send") return null;
        if (cmd === "mail_ews_fetch_missing_bodies") {
          const next = bodyAnswers.shift();
          if (next instanceof Error) throw next;
          return next ?? { kept: 0, more: false };
        }
        throw new Error(`no such command in this test: ${cmd}`);
      },
    },
  },
  addEventListener: (name, fn) => listeners.set(name, [...(listeners.get(name) ?? []), fn]),
  removeEventListener: () => {},
  dispatchEvent: (event) => {
    for (const fn of listeners.get(event.type) ?? []) fn(event);
    return true;
  },
};
globalThis.CustomEvent ??= class extends Event {
  constructor(type, init) {
    super(type);
    this.detail = init?.detail;
  }
};

const of = (name) => commands.filter((c) => c.cmd === name);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const decode = (b64) => Buffer.from(b64, "base64").toString("utf8");

suite(async () => {
  invalidateConnectedMailAccountsCache();

  // ---- The copy: save, replace, delete ------------------------------------------------
  await saveExchangeDraftCopy("compose:a", EX, "Subject: One\r\n\r\nx", []);
  await saveExchangeDraftCopy("compose:a", EX, "Subject: Two\r\n\r\nx", ["hidden@example.com"]);
  const draftSaves = of("mail_ews_save_draft");
  check("the first save replaces nothing", draftSaves[0]?.replaces === null);
  check("the second replaces the first", draftSaves[1]?.replaces === "draft-1" && draftSaves[1].bcc[0] === "hidden@example.com");
  check("the old version is not deleted here: Rust deletes it after the new save", of("mail_ews_delete_draft").length === 0);
  await deleteExchangeDraftCopy("compose:a");
  const dropped = of("mail_ews_delete_draft").at(-1);
  check("a draft deleted here takes its copy, soft", dropped?.itemId === "draft-2" && dropped.discard === false);
  await deleteExchangeDraftCopy("compose:a");
  check("and only once", of("mail_ews_delete_draft").length === 1);

  // ---- The Drafts view --------------------------------------------------------------------
  commands.length = 0;
  await saveExchangeDraftCopy("compose:b", EX, "Subject: Mine\r\n\r\nx", []);
  settings["dh-mail-exchange-draft-copies"] = JSON.stringify({ "compose:b": { account: EX, itemId: "draft-1" } });
  const rows = await listProviderDrafts(EX);
  check("the view lists the server's drafts less this app's copies", rows.map((r) => r.id).join(",") === "their-draft", rows.map((r) => r.id).join(","));
  check("as Exchange drafts", rows.every((r) => r.origin === "exchange"));
  await discardProviderDraft({ account: EX, ref: "their-draft" });
  check("a draft discarded in the view goes to Deleted Items", of("mail_ews_delete_draft").at(-1)?.discard === true);
  await discardProviderDraft({ account: EX, ref: "draft-1" });
  check("this app's own copy goes soft", of("mail_ews_delete_draft").at(-1)?.discard === false);
  check("and its link goes", !JSON.parse(settings["dh-mail-exchange-draft-copies"])["compose:b"]);

  // ---- A send from a server draft ----------------------------------------------------------
  commands.length = 0;
  await sendMailMessage({ account: EX, to: ["dana@example.com"], subject: "Plan", body: "Go.", discardProviderDraft: "their-draft" });
  const order = commands.map((c) => c.cmd).filter((c) => c.startsWith("mail_ews_"));
  check("the draft goes after the send, soft", order.join(",") === "mail_ews_send,mail_ews_delete_draft" && of("mail_ews_delete_draft")[0].discard === false, order.join(","));

  // ---- The listener: a draft written here gets a copy ------------------------------------
  commands.length = 0;
  installExchangeDraftCopy(globalThis.window, 20);
  const draft = {
    kind: "compose", key: "compose:c", updatedAt: 1, from: EX, subject: "Budget", body: "<p>First words.</p>",
    toList: [{ kind: "email", email: "dana@example.com" }], ccList: [],
    bccList: [], showCc: false, showBcc: false, includeSignature: true, attachments: [],
  };
  window.dispatchEvent(new CustomEvent("dh-mail-draft-written", { detail: { draft } }));
  window.dispatchEvent(new CustomEvent("dh-mail-draft-written", { detail: { draft: { ...draft, body: "<p>First words, and more.</p>" } } }));
  await wait(120);
  const copies = of("mail_ews_save_draft");
  check("one copy for a burst of writes", copies.length === 1, copies.length);
  const mime = decode(copies[0]?.mime ?? "");
  check("the copy has the subject, the recipient, and the last words", /Subject: Budget/.test(mime) && /To: dana@example.com/.test(mime) && Buffer.from(mime.split("base64\r\n\r\n")[1]?.split("\r\n")[0] ?? "", "base64").toString().includes("and more"));
  window.dispatchEvent(new CustomEvent("dh-mail-draft-written", { detail: { draft: { ...draft, body: "<p>First words, and more.</p>", caret: 5 } } }));
  await wait(80);
  check("a caret move saves nothing", of("mail_ews_save_draft").length === 1);
  window.dispatchEvent(new CustomEvent("dh-mail-draft-deleted", { detail: { key: "compose:c" } }));
  await wait(50);
  check("a draft deleted here takes its copy", of("mail_ews_delete_draft").some((c) => c.discard === false));

  // ---- A sent draft does not come back -------------------------------------------------------
  commands.length = 0;
  let release;
  hold = new Promise((r) => (release = r));
  window.dispatchEvent(new CustomEvent("dh-mail-draft-written", { detail: { draft: { ...draft, key: "compose:d", body: "<p>Sent soon.</p>" } } }));
  await wait(40); // the wait is over: the save has started, and is held at its first step
  window.dispatchEvent(new CustomEvent("dh-mail-draft-deleted", { detail: { key: "compose:d" } })); // Send
  release();
  hold = null;
  await wait(60);
  check("a save under way when the draft was sent writes no copy", of("mail_ews_save_draft").length === 0, of("mail_ews_save_draft").length);

  commands.length = 0;
  await saveExchangeDraftCopy("compose:e", EX, "Subject: E\r\n\r\nx", []);
  const eId = of("mail_ews_save_draft").length ? JSON.parse(settings["dh-mail-exchange-draft-copies"])["compose:e"].itemId : null;
  await deleteExchangeDraftCopy("compose:e");
  const removed = commands.find((c) => c.cmd === "mail_store_call" && c.op === "messages.removeMessages");
  check("a deleted copy leaves the local copy at once", removed?.args?.messageIds?.[0] === eId, JSON.stringify(removed?.args));

  commands.length = 0;
  await saveExchangeDraftCopy("thread:elsewhere", EX, "Subject: Re: Plan\r\n\r\nx", []);
  const ownId = JSON.parse(settings["dh-mail-exchange-draft-copies"])["thread:elsewhere"].itemId;
  threadRows = [
    { messageId: "m-1", isDraft: false },
    { messageId: ownId, isDraft: true },
    { messageId: "someone-elses-draft", isDraft: true },
  ];
  commands.length = 0;
  await sendMailMessage({ account: EX, to: ["dana@example.com"], subject: "Re: Plan", body: "Done.", threadId: "c-plan" });
  const gone = of("mail_ews_delete_draft").map((c) => c.itemId);
  check("a send in a thread takes this app's own copy still in it", gone.includes(ownId), gone.join(","));
  check("and never a draft it did not save", !gone.includes("someone-elses-draft"), gone.join(","));
  threadRows = [];

  // ---- Bodies in the background ------------------------------------------------------------
  commands.length = 0;
  forgetExchangeBodyFill();
  bodyAnswers = [{ kept: 10, more: true }, { kept: 10, more: true }, { kept: 3, more: false }];
  await fillExchangeBodies(EX, () => false, 5);
  const batches = of("mail_ews_fetch_missing_bodies");
  check("bodies come a batch at a time until none is left", batches.length === 3);
  check("for the last year", batches.every((b) => Date.now() - b.since > 364 * 24 * 3600 * 1000));
  commands.length = 0;
  bodyAnswers = [new Error("ews:busy: The server is busy. Try again after 60000 ms.")];
  await fillExchangeBodies(EX, () => false, 5);
  await fillExchangeBodies(EX, () => false, 5);
  check("a busy server stops it until the wait is over", of("mail_ews_fetch_missing_bodies").length === 1);
  forgetExchangeBodyFill();
  commands.length = 0;
  bodyAnswers = [{ kept: 10, more: true }];
  await fillExchangeBodies(EX, () => true, 5);
  check("a stopped worker asks for none", of("mail_ews_fetch_missing_bodies").length === 0);
});
