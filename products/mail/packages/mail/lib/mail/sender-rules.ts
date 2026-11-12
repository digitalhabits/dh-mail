/**
 * Rules for a sender: where their future mail goes.
 *
 * "Always move to Junk", "Always archive", "Always move to a folder",
 * "Always send to Trash", for one address or for everyone at its domain.
 * The reader makes one from a row's menu (components/mail/sender-rule-menu).
 *
 * A rule is this app's own. It is kept in the app's store and run by the
 * app after each read of the mailbox (sender-rules-run.ts), so it works
 * the same for every kind of mailbox, also one the provider gives no
 * filter interface for. It does not run while the app is closed: mail
 * that came then is moved when the app next reads the mailbox.
 *
 * This file is the rules themselves and where they are kept. Nothing here
 * moves mail.
 */

import { mailStore } from "@/lib/mail/store";

export type SenderRuleAction = "junk" | "archive" | "folder" | "trash";

/** Which mail a rule takes: one address, or every address at a domain. */
export type SenderRuleMatch = "sender" | "domain";

export type SenderRule = {
  id: string;
  /** The mailbox the rule is for, in lower case. */
  account: string;
  match: SenderRuleMatch;
  /** The address, or the domain with no "@", in lower case. */
  value: string;
  action: SenderRuleAction;
  /** For "folder": the folder's name, as the mailbox's folder list has it. */
  folderName?: string;
  /** The sender's name when the rule was made, for lists of rules. */
  name: string;
  /** When it was made (ms). Mail from before it is moved only when asked. */
  createdAt: number;
};

export const SENDER_RULES_KEY = "mail_sender_rules";
/** The mail the rules have moved, so that mail put back by hand stays. */
export const SENDER_RULES_DONE_KEY = "mail_sender_rules_done";
const DONE_KEPT = 500;

const lower = (text: string) => text.trim().toLowerCase();

/** The domain of an address, in lower case, or "" when it has none. */
export function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at < 0 ? "" : lower(email.slice(at + 1));
}

/**
 * Domains that many unrelated people write from. A rule for "everyone at"
 * one of these would take mail from strangers and friends alike, so it is
 * not offered.
 */
const SHARED_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "gmx.de",
  "mail.com",
  "yandex.com",
  "zoho.com",
]);

export function isSharedDomain(domain: string): boolean {
  return SHARED_DOMAINS.has(lower(domain));
}

/** Whether a rule takes mail from this address. */
export function ruleTakes(rule: SenderRule, fromEmail: string): boolean {
  const from = lower(fromEmail);
  if (!from) return false;
  return rule.match === "sender" ? rule.value === from : rule.value === domainOf(from);
}

/**
 * The rule for mail from this address in this mailbox, or null. A rule for
 * the address itself comes before one for its domain: "everyone at the
 * university to Archive, but this one colleague to a folder".
 */
export function ruleFor(rules: readonly SenderRule[], account: string, fromEmail: string): SenderRule | null {
  const mine = rules.filter((rule) => rule.account === lower(account) && ruleTakes(rule, fromEmail));
  return mine.find((rule) => rule.match === "sender") ?? mine[0] ?? null;
}

/** A rule as it is kept, from what the dialog or the menu gives. Null when it cannot be one. */
export function makeRule(input: {
  account: string;
  match: SenderRuleMatch;
  value: string;
  action: SenderRuleAction;
  folderName?: string;
  name?: string;
  now?: number;
}): SenderRule | null {
  const account = lower(input.account);
  const value = input.match === "domain" ? lower(input.value).replace(/^@/, "") : lower(input.value);
  if (!account || !value) return null;
  if (input.match === "sender" && !value.includes("@")) return null;
  if (input.match === "domain" && (value.includes("@") || isSharedDomain(value))) return null;
  // The mailbox's own address: a rule for it would take the reader's own mail.
  if (input.match === "sender" && value === account) return null;
  const folderName = input.folderName?.trim();
  if (input.action === "folder" && !folderName) return null;
  const now = input.now ?? Date.now();
  return {
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    account,
    match: input.match,
    value,
    action: input.action,
    ...(input.action === "folder" ? { folderName } : null),
    name: input.name?.trim() || value,
    createdAt: now,
  };
}

/** The rules with this one in: it takes the place of a rule for the same mail. */
export function withRule(rules: readonly SenderRule[], rule: SenderRule): SenderRule[] {
  const same = (other: SenderRule) =>
    other.account === rule.account && other.match === rule.match && other.value === rule.value;
  return [...rules.filter((other) => !same(other)), rule];
}

function readRule(raw: unknown): SenderRule | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const text = (key: string) => (typeof row[key] === "string" ? (row[key] as string) : "");
  const action = text("action");
  const match = text("match");
  if (!["junk", "archive", "folder", "trash"].includes(action)) return null;
  if (match !== "sender" && match !== "domain") return null;
  if (!text("id") || !text("account") || !text("value")) return null;
  if (action === "folder" && !text("folderName")) return null;
  return {
    id: text("id"),
    account: lower(text("account")),
    match,
    value: lower(text("value")),
    action: action as SenderRuleAction,
    ...(action === "folder" ? { folderName: text("folderName") } : null),
    name: text("name") || text("value"),
    createdAt: typeof row.createdAt === "number" ? row.createdAt : 0,
  };
}

/** Kept text to rules. What is not a rule is left out. */
export function parseRules(raw: string | null | undefined): SenderRule[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map(readRule).filter((rule): rule is SenderRule => rule != null) : [];
  } catch {
    return [];
  }
}

export async function readSenderRules(): Promise<SenderRule[]> {
  return parseRules(await mailStore().settings.get(SENDER_RULES_KEY).catch(() => null));
}

/** One change of the kept rules at a time: a read and a write are two steps. */
let turn: Promise<unknown> = Promise.resolve();
function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const next = turn.then(work, work);
  turn = next.catch(() => undefined);
  return next;
}

export function saveSenderRule(rule: SenderRule): Promise<SenderRule[]> {
  return inTurn(async () => {
    const rules = withRule(await readSenderRules(), rule);
    await mailStore().settings.set(SENDER_RULES_KEY, JSON.stringify(rules));
    return rules;
  });
}

export function removeSenderRule(id: string): Promise<SenderRule[]> {
  return inTurn(async () => {
    const rules = (await readSenderRules()).filter((rule) => rule.id !== id);
    await mailStore().settings.set(SENDER_RULES_KEY, JSON.stringify(rules));
    return rules;
  });
}

/** The name of one moved mail: its mailbox, its conversation and its newest message. */
export function doneKey(account: string, threadId: string, messageId: string): string {
  return `${lower(account)}|${threadId}|${messageId}`;
}

export async function readDone(): Promise<Set<string>> {
  try {
    const parsed = JSON.parse((await mailStore().settings.get(SENDER_RULES_DONE_KEY)) ?? "[]") as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : []);
  } catch {
    return new Set();
  }
}

/** Add to the moved mail. The oldest go when there are too many. */
export function noteDone(keys: readonly string[]): Promise<void> {
  if (!keys.length) return Promise.resolve();
  return inTurn(async () => {
    const all = [...(await readDone()), ...keys];
    await mailStore().settings.set(SENDER_RULES_DONE_KEY, JSON.stringify(all.slice(-DONE_KEPT)));
  });
}
