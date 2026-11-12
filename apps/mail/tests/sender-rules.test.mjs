/**
 * Rules for a sender: which mail a rule takes, how rules are kept, and what
 * a pass over the inbox moves. All names and addresses are invented.
 */

import {
  doneKey,
  isSharedDomain,
  makeRule,
  parseRules,
  readSenderRules,
  removeSenderRule,
  ruleFor,
  saveSenderRule,
  withRule,
} from "@/lib/mail/sender-rules";
import { runSenderRules, senderOfThread, takenNow } from "@/lib/mail/sender-rules-run";
import { setMailStore } from "@/lib/mail/store";

import { check, suite } from "./harness.mjs";

const ME = "vera@mail.example";
const DESK = "desk@college.example";
const DEAN = "dean@college.example";
const MADE = 10_000;

const settings = new Map();
let threadRows = [];
setMailStore({
  settings: { get: async (key) => settings.get(key) ?? null, set: async (key, value) => void settings.set(key, value) },
  sync: { list: async () => [{ account: ME, folder: "", phase: "live" }], set: async () => {} },
  messages: { thread: async () => threadRows },
});

/** An inbox conversation whose newest message is from `from`, at `at`. */
const thread = (id, from, at, extra = {}) => ({
  account: ME,
  threadId: id,
  subject: id,
  lastAt: at,
  messageCount: 1,
  unread: true,
  hasAttachments: false,
  starred: false,
  isDraft: false,
  labels: ["INBOX"],
  latest: { messageId: `${id}-m`, fromName: from, fromEmail: from, to: [], snippet: "", sentAt: at, unread: true },
  participants: [],
  senders: [],
  ...extra,
});

suite(async () => {
  // ---- What a rule is ------------------------------------------------------
  const sender = makeRule({ account: ME, match: "sender", value: " Desk@College.Example ", action: "junk", name: "Help Desk", now: MADE });
  check("a rule keeps its address in lower case", sender?.value === DESK && sender.account === ME && sender.name === "Help Desk");
  check("a folder rule needs a folder", makeRule({ account: ME, match: "sender", value: DESK, action: "folder" }) === null);
  check("a rule for the mailbox's own address is not made", makeRule({ account: ME, match: "sender", value: ME, action: "trash" }) === null);
  check("nor one for everyone at a domain that strangers share", makeRule({ account: ME, match: "domain", value: "gmail.com", action: "trash" }) === null && isSharedDomain("Outlook.com"));
  const domain = makeRule({ account: ME, match: "domain", value: "@college.example", action: "archive", now: MADE });
  check("a domain rule keeps the domain with no @", domain?.value === "college.example");

  // ---- Which rule takes a mail --------------------------------------------
  const both = [domain, sender];
  check("a rule for the address comes before one for its domain", ruleFor(both, ME, "DESK@college.example")?.action === "junk");
  check("the domain rule takes the others there", ruleFor(both, ME, DEAN)?.action === "archive");
  check("mail from elsewhere has no rule", ruleFor(both, ME, "ann@elsewhere.example") === null);
  check("a domain is the part after the @, not a longer one that ends alike", ruleFor(both, ME, "x@notcollege.example") === null);
  check("another mailbox's rules are not this one's", ruleFor(both, "bo@mail.example", DESK) === null);
  const toTrash = makeRule({ account: ME, match: "sender", value: DESK, action: "trash", now: MADE });
  check("a new rule for the same mail takes the old one's place", withRule(both, toTrash).filter((r) => r.value === DESK).length === 1);
  check("kept text that is not a rule is left out", parseRules('[{"id":"a"},7,null]').length === 0 && parseRules("not json").length === 0);

  // ---- Kept in the store ---------------------------------------------------
  await saveSenderRule(sender);
  await saveSenderRule(domain);
  check("rules are read back as they were kept", (await readSenderRules()).length === 2);

  // ---- A pass over the inbox ----------------------------------------------
  const moves = [];
  const inbox = [
    thread("new-from-desk", DESK, MADE + 5),
    thread("old-from-desk", DESK, MADE - 5),
    thread("new-from-dean", DEAN, MADE + 6),
    thread("from-ann", "ann@elsewhere.example", MADE + 7),
    thread("answered", ME, MADE + 8),
  ];
  const runner = { inbox: async () => inbox, move: async (rule, account, threadId) => void moves.push(`${rule.action}:${threadId}`) };
  const moved = await runSenderRules(ME, { runner });
  check("new mail from a sender with a rule is moved, each by its own rule", moved === 2 && moves.join(",") === "junk:new-from-desk,archive:new-from-dean", moves.join(","));
  check("mail from before the rule stays", !moves.some((m) => m.endsWith("old-from-desk")));
  check("a conversation the reader answered last stays", !moves.some((m) => m.endsWith("answered")));

  // The reader puts one back in the inbox: the same mail is not moved again.
  moves.length = 0;
  await runSenderRules(ME, { runner });
  check("mail the rule moved once, put back by hand, stays", moves.length === 0, moves.join(","));
  inbox[0] = thread("new-from-desk", DESK, MADE + 50, { latest: { ...inbox[0].latest, messageId: "new-from-desk-m2", sentAt: MADE + 50 } });
  await runSenderRules(ME, { runner });
  check("until the sender writes again", moves.join(",") === "junk:new-from-desk", moves.join(","));

  // "Also move the mail already here": the rule just made takes its old mail, once.
  moves.length = 0;
  check("the dialog counts the mail a rule would take now", takenNow(inbox, { match: "sender", value: DESK }, ME).length === 2 && takenNow(inbox, { match: "domain", value: "college.example" }, ME).length === 3);
  await runSenderRules(ME, { existing: sender, runner });
  check("asked to, a rule takes the mail from before it too", moves.includes("junk:old-from-desk"), moves.join(","));
  check("and only that rule's", !moves.some((m) => m.startsWith("archive:")), moves.join(","));

  // A move that fails is tried again at the next pass.
  moves.length = 0;
  inbox.push(thread("fails-once", DEAN, MADE + 60));
  let failing = true;
  const flaky = { inbox: async () => inbox, move: async (rule, account, threadId) => { if (failing) throw new Error("no network"); moves.push(threadId); } };
  check("a move that fails is not counted", (await runSenderRules(ME, { runner: flaky })) === 0);
  failing = false;
  await runSenderRules(ME, { runner: flaky });
  check("and is tried again", moves.includes("fails-once"), moves.join(","));

  // ---- The sender of a row -------------------------------------------------
  const stored = (id, from, at, labels) => ({ messageId: id, fromName: "", fromEmail: from, sentAt: at, isDraft: false, labels });
  threadRows = [stored("a", DESK, 1, ["INBOX"]), stored("b", ME, 2, ["SENT"]), stored("c", DEAN, 3, ["INBOX"]), stored("d", ME, 4, ["SENT"])];
  check("the sender is who wrote the newest incoming message", (await senderOfThread(ME, "t"))?.email === DEAN);
  threadRows = [stored("b", ME, 2, ["SENT"])];
  check("a conversation that is all the reader's own has no sender", (await senderOfThread(ME, "t")) === null);

  // ---- Taken away ----------------------------------------------------------
  await removeSenderRule(sender.id);
  moves.length = 0;
  inbox.push(thread("after-removal", DESK, MADE + 99));
  await runSenderRules(ME, { runner });
  check("a removed rule moves nothing; the domain rule now takes that sender", moves.join(",") === "archive:after-removal", moves.join(","));
  check("a moved mail is named by mailbox, conversation and message", doneKey("Vera@Mail.Example", "t", "m") === "vera@mail.example|t|m");
});
