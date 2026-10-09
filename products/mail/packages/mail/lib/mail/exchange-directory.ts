/**
 * The directory of an Exchange (EWS) server, for the suggestions in To, Cc,
 * and Bcc (section 16.5 of `docs/mail-exchange-ews.md`).
 *
 * `ResolveNames` on the directory, for a message from an Exchange mailbox.
 * One call at a time for the whole app, and each answer is kept in memory
 * for the session, by mailbox and text. Nothing is written to the store:
 * the directory is the organization's, not the reader's, and it is large.
 *
 * Desktop app only, in every flavor.
 */

import type { MailContactSuggestion } from "@/lib/mail/contact-suggestion";
import { hasExchangeAccount } from "@/lib/mail/exchange-accounts";
import { invoke } from "@/lib/mail/exchange-native";
import { tauriInvoke } from "@/lib/mail/store/tauri";

/** The shortest text that is looked up (as `MIN_TEXT` in Rust). */
export const DIRECTORY_MIN_TEXT = 3;

type Person = { name: string; email: string };

const answers = new Map<string, MailContactSuggestion[]>();
const isExchange = new Map<string, Promise<boolean>>();

/** One call at a time, for the whole app. */
let queue: Promise<unknown> = Promise.resolve();
function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

function exchangeMailbox(account: string): Promise<boolean> {
  let known = isExchange.get(account);
  if (!known) {
    known = hasExchangeAccount(account).catch(() => false);
    isExchange.set(account, known);
  }
  return known;
}

/** The text as it is looked up and kept. */
export function directoryText(text: string): string {
  return text.trim().toLowerCase();
}

/**
 * The people in the directory for this text, as suggestions. Empty when
 * the sender is not an Exchange mailbox, the text is short, or the server
 * did not answer (the next text asks again).
 */
export async function searchExchangeDirectory(account: string, text: string): Promise<MailContactSuggestion[]> {
  const email = account.trim().toLowerCase();
  const q = directoryText(text);
  if (!tauriInvoke() || !email || q.length < DIRECTORY_MIN_TEXT) return [];
  const key = `${email}|${q}`;
  const kept = answers.get(key);
  if (kept) return kept;
  if (!(await exchangeMailbox(email))) return [];
  try {
    const people = await inTurn(() => invoke<Person[]>("mail_ews_resolve_names", { account: email, text: q }));
    const rows = people.map((p) => ({ email: p.email, name: p.name, recordName: "", source: "directory" as const, account: email }));
    answers.set(key, rows);
    return rows;
  } catch (err) {
    console.warn("[mail] the directory did not answer:", err);
    return [];
  }
}

/** For the tests: forget what is kept. */
export function forgetExchangeDirectory(): void {
  answers.clear();
  isExchange.clear();
}
