/**
 * Snooze for an Exchange (EWS) mailbox (section 16.3 of
 * `docs/mail-exchange-ews.md`).
 *
 * The app's snooze list holds the thread back, as for every provider
 * (`inbox-list.ts`). On top of that, the thread's inbox items move to a
 * folder, `Snoozed`, so the thread leaves the inbox in Outlook on the web
 * too. Exchange on-prem has no snooze of its own.
 *
 * The ids of the threads the app put to sleep are kept. After each pass
 * of the worker, a kept thread with no active snooze row goes back to the
 * inbox, whatever ended its snooze: the time, a new reply, or "unsnooze".
 * Only those threads move back: other mail in the folder stays.
 */

import { exchangeThreadAction } from "@/lib/mail/exchange-actions";
import { ensureExchangeFolder } from "@/lib/mail/exchange-folder-edits";
import { exchangeFolderRows, exchangeLabelFor, readExchangeFolders } from "@/lib/mail/exchange-folders";
import { mailStore } from "@/lib/mail/store";
import type { MailStoredMessage } from "@/lib/mail/store/types";

/** The folder the app makes, under the top of the mailbox. */
export const EXCHANGE_SNOOZE_FOLDER = "Snoozed";

const KEY_PREFIX = "dh-mail-exchange-snooze:";

/** What is kept for one mailbox. */
type SnoozeState = { folderId: string | null; threads: string[] };

function normalize(account: string): string {
  return account.trim().toLowerCase();
}

async function readState(email: string): Promise<SnoozeState> {
  const raw = await mailStore().settings.get(`${KEY_PREFIX}${email}`).catch(() => null);
  try {
    const parsed = raw ? (JSON.parse(raw) as Partial<SnoozeState>) : {};
    return { folderId: parsed.folderId ?? null, threads: Array.isArray(parsed.threads) ? parsed.threads : [] };
  } catch {
    return { folderId: null, threads: [] };
  }
}

async function writeState(email: string, state: SnoozeState): Promise<void> {
  await mailStore().settings.set(`${KEY_PREFIX}${email}`, JSON.stringify(state));
}

/** One change of the kept state at a time. */
let queue: Promise<unknown> = Promise.resolve();
function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

/** The kept id of the snooze folder, if the folder is still there. */
export async function exchangeSnoozeFolderId(account: string): Promise<string | null> {
  const email = normalize(account);
  const { folderId } = await readState(email);
  if (!folderId) return null;
  return (await readExchangeFolders(email)).folders[folderId] ? folderId : null;
}

/** The label the rows of the snooze folder wear (its path), or null. */
async function snoozeLabel(email: string, folderId: string): Promise<string | null> {
  const row = exchangeFolderRows(await readExchangeFolders(email)).find((f) => f.id === folderId);
  return row ? exchangeLabelFor(row) : null;
}

/**
 * The `Message-ID` of the thread's newest message that is not a draft,
 * from the local copy. A new reply after it wakes the snooze.
 */
export async function exchangeTipMessageId(account: string, threadId: string): Promise<string | null> {
  const rows = (await mailStore().messages.thread(normalize(account), threadId).catch(() => [])) as MailStoredMessage[];
  const tip = rows.filter((r) => !r.isDraft).sort((a, b) => b.sentAt - a.sentAt)[0];
  return tip?.rfcMessageId ?? null;
}

/**
 * Move the thread's inbox items to the snooze folder, made on the first
 * snooze. The thread id is kept first, so a failed move is put right by
 * the next wake.
 */
export async function snoozeExchangeThread(account: string, threadId: string): Promise<void> {
  const email = normalize(account);
  // The move is in the same turn as the record. A wake that came while the
  // move was on its way found nothing in Snoozed, forgot the thread, and the
  // move then left it there for good (KU, 2026-09-27). Now a wake waits.
  await inTurn(async () => {
    const state = await readState(email);
    const kept = state.folderId && (await exchangeSnoozeFolderId(email));
    const folderId = kept || (await ensureExchangeFolder(email, EXCHANGE_SNOOZE_FOLDER));
    const threads = state.threads.includes(threadId) ? state.threads : [...state.threads, threadId];
    await writeState(email, { folderId, threads });
    const label = await snoozeLabel(email, folderId);
    if (!label) throw new Error("ews:invalid: The Snoozed folder is not in the folder list yet. Try again after the next sync.");
    await exchangeThreadAction(email, threadId, "snooze", { label });
  });
}

/** Move one woken thread back to the inbox. True: done, drop its id. */
async function wakeOne(email: string, threadId: string, label: string | null): Promise<boolean> {
  if (!label) return true;
  try {
    await exchangeThreadAction(email, threadId, "unmove", { label });
    return true;
  } catch (err) {
    console.warn(`[mail] ${email}: a snoozed thread did not go back to the inbox:`, err);
    return false;
  }
}

/**
 * Put each thread whose snooze ended back in the inbox. Called after each
 * pass of the worker. Answers how many went back.
 */
export async function wakeExchangeSnoozes(account: string): Promise<number> {
  const email = normalize(account);
  // In turn with the snoozes: a snooze's move is done before this looks.
  return inTurn(async () => {
    const { folderId, threads } = await readState(email);
    if (!threads.length) return 0;
    const active = await mailStore().snoozes.listActive();
    const asleep = new Set(active.filter((r) => normalize(r.accountEmail) === email).map((r) => r.threadId));
    const woken = threads.filter((id) => !asleep.has(id));
    if (!woken.length) return 0;
    const label = folderId ? await snoozeLabel(email, folderId) : null;
    const done: string[] = [];
    for (const threadId of woken) if (await wakeOne(email, threadId, label)) done.push(threadId);
    if (done.length) {
      const now = await readState(email);
      await writeState(email, { ...now, threads: now.threads.filter((id) => !done.includes(id)) });
    }
    return done.length;
  });
}
