/**
 * Running the rules for a sender (sender-rules.ts): moving the mail.
 *
 * After each read of a mailbox, the inbox of the local copy is looked
 * through. A conversation whose newest message is from a sender with a
 * rule, and came after the rule was made, is moved the way the reader
 * would move it by hand: through the same actions, so the copy, the
 * action queue and each provider's own path all work as they do for a
 * click. Each moved mail is noted, so a conversation the reader puts back
 * in the inbox stays there until its sender writes again.
 *
 * Only the newest message counts. A conversation the reader answered last
 * is theirs, and stays.
 *
 * A mailbox with no local copy yet has no rules run: they run from its
 * first rows on.
 */

import "server-only";

import { invalidateInboxCache } from "@/lib/mail/inbox-cache";
import { archiveMailThread, markMailThreadJunk, trashMailThread } from "@/lib/mail/inbox-actions";
import { moveMailThreadToFolder } from "@/lib/mail/folders";
import { localStoreServes, notifySyncChanged, SYNC_CHANGED_WINDOW_EVENT } from "@/lib/mail/local-store";
import {
  doneKey,
  domainOf,
  isSharedDomain,
  noteDone,
  readDone,
  readSenderRules,
  ruleFor,
  ruleTakes,
  type SenderRule,
} from "@/lib/mail/sender-rules";
import { mailStore } from "@/lib/mail/store";
import type { MailStoredThread } from "@/lib/mail/store/types";

/** How much of the inbox one pass looks through, newest first. */
const INBOX_LOOKED_AT = 300;

const lower = (text: string) => text.trim().toLowerCase();

/** Move one conversation the way its rule says. */
export async function moveByRule(rule: SenderRule, account: string, threadId: string): Promise<void> {
  if (rule.action === "junk") return markMailThreadJunk(account, threadId);
  if (rule.action === "archive") return archiveMailThread(account, threadId);
  if (rule.action === "trash") return trashMailThread(account, threadId);
  await moveMailThreadToFolder({ account, threadId, folderName: rule.folderName ?? "" });
}

/** What a pass needs from outside, so a test can give its own. */
export type RuleRunner = {
  move: typeof moveByRule;
  inbox: (account: string) => Promise<MailStoredThread[]>;
};

async function inboxOf(account: string): Promise<MailStoredThread[]> {
  if (!(await localStoreServes(account))) return [];
  const page = await mailStore().messages.list({ accounts: [account], view: "inbox", limit: INBOX_LOOKED_AT });
  return page.threads;
}

const REAL: RuleRunner = { move: moveByRule, inbox: inboxOf };

/** The conversation's newest message is from someone else. */
function newestIsIncoming(thread: MailStoredThread, account: string): boolean {
  const from = lower(thread.latest.fromEmail);
  return Boolean(from) && from !== lower(account) && !thread.isDraft;
}

/**
 * The inbox conversations a rule takes now: the newest message is from its
 * sender. This is "the N emails already here" of the rule dialog.
 */
export function takenNow(threads: readonly MailStoredThread[], rule: Pick<SenderRule, "match" | "value">, account: string) {
  const asRule = { ...rule, account: lower(account) } as SenderRule;
  return threads.filter((thread) => newestIsIncoming(thread, account) && ruleTakes(asRule, thread.latest.fromEmail));
}

/**
 * One pass over a mailbox's inbox. Returns how many conversations moved.
 *
 * `existing`: a rule just made, with "also move the mail already here":
 * that rule takes its mail whenever it came, once.
 */
export async function runSenderRules(
  account: string,
  options?: { existing?: SenderRule; runner?: RuleRunner }
): Promise<number> {
  const runner = options?.runner ?? REAL;
  const rules = (await readSenderRules()).filter((rule) => rule.account === lower(account));
  if (!rules.length) return 0;
  const threads = await runner.inbox(account);
  if (!threads.length) return 0;
  const done = await readDone();
  const moved: string[] = [];
  for (const thread of threads) {
    if (!newestIsIncoming(thread, account)) continue;
    const rule = ruleFor(rules, account, thread.latest.fromEmail);
    if (!rule) continue;
    const key = doneKey(account, thread.threadId, thread.latest.messageId);
    const asked = options?.existing?.id === rule.id;
    // Mail from before the rule stays, unless the reader asked for it. Mail
    // the rule moved once and the reader put back stays too.
    if (!asked && (thread.latest.sentAt < rule.createdAt || done.has(key))) continue;
    try {
      await runner.move(rule, account, thread.threadId);
      moved.push(key);
    } catch (err) {
      // Left in the inbox: the next pass tries again.
      console.warn(`[mail] ${account}: a sender rule could not move a conversation:`, err);
    }
  }
  await noteDone(moved);
  if (moved.length) {
    invalidateInboxCache();
    notifySyncChanged(account);
  }
  return moved.length;
}

/** One pass at a time for a mailbox; a pass asked for meanwhile runs after it. */
const passes = new Map<string, Promise<unknown>>();
function inTurn(account: string, work: () => Promise<number>): Promise<number> {
  const key = lower(account);
  const next = (passes.get(key) ?? Promise.resolve()).then(work, work);
  passes.set(key, next.catch(() => undefined));
  return next;
}

/** A pass, after any pass under way for the mailbox. */
export function runSenderRulesSoon(account: string, existing?: SenderRule): Promise<number> {
  return inTurn(account, () => runSenderRules(account, existing ? { existing } : undefined));
}

/** Who wrote the newest incoming message of a conversation, or null when all of it is the reader's own. */
export async function senderOfThread(
  account: string,
  threadId: string
): Promise<{ name: string; email: string } | null> {
  const rows = await mailStore().messages.thread(account, threadId).catch(() => []);
  const incoming = rows
    .filter((row) => !row.isDraft && !row.labels?.includes("SENT") && lower(row.fromEmail) !== lower(account))
    .sort((a, b) => b.sentAt - a.sentAt)[0];
  if (!incoming?.fromEmail) return null;
  return { name: incoming.fromName || incoming.fromEmail, email: lower(incoming.fromEmail) };
}

/** What the rule menu shows for a row: the sender, their rule, and how much of their mail is in the inbox. */
export async function senderRuleState(account: string, threadId: string, fallbackEmail?: string) {
  const found = await senderOfThread(account, threadId);
  const sender = found ?? (fallbackEmail?.includes("@") ? { name: fallbackEmail, email: lower(fallbackEmail) } : null);
  if (!sender || sender.email === lower(account)) return { sender: null, domain: "", rule: null, here: { sender: 0, domain: 0 } };
  const domain = domainOf(sender.email);
  const rules = await readSenderRules();
  const inbox = await inboxOf(account).catch(() => []);
  return {
    sender,
    /** "" when a rule for the whole domain is not offered. */
    domain: domain && !isSharedDomain(domain) ? domain : "",
    rule: ruleFor(rules, account, sender.email),
    here: {
      sender: takenNow(inbox, { match: "sender", value: sender.email }, account).length,
      domain: domain ? takenNow(inbox, { match: "domain", value: domain }, account).length : 0,
    },
  };
}

/**
 * Run the rules whenever a mailbox's copy changes, and once now. Called
 * when the sync workers start; a second call adds mailboxes and nothing
 * else.
 */
const watched = new Set<string>();
let listening = false;
const WAIT_MS = 1500;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function soon(account: string): void {
  const key = lower(account);
  if (!watched.has(key)) return;
  clearTimeout(timers.get(key));
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      void runSenderRulesSoon(key).catch((err: unknown) => console.warn(`[mail] ${key}: sender rules did not run:`, err));
    }, WAIT_MS)
  );
}

export function startSenderRules(accounts: readonly string[]): void {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  for (const account of accounts) watched.add(lower(account));
  if (!listening) {
    listening = true;
    const accountOf = (payload: unknown) => {
      const account = (payload as { account?: unknown } | null)?.account;
      return typeof account === "string" ? account : "";
    };
    // The Outlook and Exchange workers run in this window; Gmail's says so from the shell.
    window.addEventListener(SYNC_CHANGED_WINDOW_EVENT, (event) => soon(accountOf((event as CustomEvent).detail)));
    const tauri = (window as unknown as { __TAURI__?: { event?: { listen?: (name: string, on: (e: { payload: unknown }) => void) => Promise<unknown> } } }).__TAURI__;
    void tauri?.event?.listen?.("mail-sync-changed", (event) => soon(accountOf(event.payload)))?.catch(() => undefined);
  }
  for (const account of accounts) soon(account);
}

/** A removed mailbox: its rules stay kept, and stop running. */
export function stopSenderRules(account: string): void {
  watched.delete(lower(account));
}
