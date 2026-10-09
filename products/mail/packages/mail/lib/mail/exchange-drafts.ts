/**
 * The server copy of an Exchange (EWS) draft (phase 5, section 14.1 of
 * `docs/mail-exchange-ews.md`).
 *
 * A draft is kept in this app (`local-drafts.ts`). For an Exchange mailbox
 * the server also keeps a copy, in Drafts, so the draft is in Outlook on the
 * web too. A new version replaces the one before: the new one is saved, and
 * then the old one is deleted (soft, not for good). The link from a draft
 * here to its copy on the server is kept in the store's settings, so that
 * only an item this app saved is ever deleted as a version.
 *
 * The MIME is built by the caller (`apps/mail/src/exchange-draft-copy.ts`):
 * this module holds no send code, so the Drafts list can use it.
 */

import { utf8ToBase64 } from "@/lib/base64";
import { invoke } from "@/lib/mail/exchange-native";
import { wakeExchangeSync } from "@/lib/mail/exchange-sync";
import { mailStore } from "@/lib/mail/store";

const COPIES_KEY = "dh-mail-exchange-draft-copies";

/** One draft's copy on the server. */
type Copy = { account: string; itemId: string };

async function readCopies(): Promise<Record<string, Copy>> {
  const raw = await mailStore().settings.get(COPIES_KEY).catch(() => null);
  try {
    return raw ? (JSON.parse(raw) as Record<string, Copy>) : {};
  } catch {
    return {};
  }
}

async function writeCopies(copies: Record<string, Copy>): Promise<void> {
  await mailStore().settings.set(COPIES_KEY, JSON.stringify(copies));
}

/** One write at a time for the whole map: two drafts must not lose a link. */
let queue: Promise<unknown> = Promise.resolve();
function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

async function deleteOnServer(copy: Copy, discard: boolean): Promise<void> {
  await invoke("mail_ews_delete_draft", { account: copy.account, itemId: copy.itemId, discard });
}

/**
 * Save a new version of a draft's copy (`mime`: the whole message, as
 * text). The version before goes after the new one is saved, soft.
 */
export function saveExchangeDraftCopy(key: string, account: string, mime: string, bcc: string[]): Promise<void> {
  const email = account.trim().toLowerCase();
  return inTurn(async () => {
    const copies = await readCopies();
    const before = copies[key];
    const replaces = before?.account === email ? before.itemId : null;
    const saved = await invoke<{ itemId: string }>("mail_ews_save_draft", {
      account: email,
      mime: utf8ToBase64(mime),
      bcc,
      replaces,
    });
    // The draft moved to another Exchange mailbox: its old copy goes too.
    if (before && before.account !== email) await deleteOnServer(before, false).catch(() => undefined);
    copies[key] = { account: email, itemId: saved.itemId };
    await writeCopies(copies);
  });
}

/** The draft here was sent or discarded: its copy goes too, soft. */
export function deleteExchangeDraftCopy(key: string): Promise<void> {
  return inTurn(async () => {
    const copies = await readCopies();
    const copy = copies[key];
    if (!copy) return;
    await deleteOnServer(copy, false);
    delete copies[key];
    await writeCopies(copies);
    // Out of the copy at once, as a discard does: the thread stopped showing
    // "Draft" only when the next sync came round.
    await mailStore().messages.removeMessages(copy.account, [copy.itemId]).catch(() => undefined);
    wakeExchangeSync(copy.account, "all");
  });
}

/** The server ids of this app's own draft copies. */
export async function exchangeDraftCopyIds(): Promise<Set<string>> {
  return new Set(Object.values(await readCopies()).map((c) => c.itemId));
}

/**
 * Discard a draft that is on the server, from the Drafts view, or after
 * the message was sent from it. A copy of this app's own draft goes soft,
 * and its link goes. Any other draft goes to Deleted Items when the reader
 * discards it, as the Outlook provider moves a discarded draft; after a
 * send it goes soft, as Outlook deletes the draft of a sent message.
 */
export function discardExchangeDraft(account: string, itemId: string, afterSend = false): Promise<void> {
  const email = account.trim().toLowerCase();
  return inTurn(async () => {
    const copies = await readCopies();
    const ownKey = Object.keys(copies).find((k) => copies[k].itemId === itemId);
    await deleteOnServer({ account: email, itemId }, !ownKey && !afterSend);
    if (ownKey) {
      delete copies[ownKey];
      await writeCopies(copies);
    }
    await mailStore().messages.removeMessages(email, [itemId]).catch(() => undefined);
    wakeExchangeSync(email, "all");
  });
}

/**
 * After a send in a thread: this app's own server copies of drafts still in
 * it go, as the sent draft's would. Its copy is found by the key of the draft
 * here, and when that key did not match (the draft resumed under another),
 * the copy stayed, and the thread went on showing "Draft" with the sent
 * words in the composer. Only copies this app saved are touched.
 */
export async function discardOwnDraftCopiesInThread(account: string, threadId: string, except?: string): Promise<void> {
  const email = account.trim().toLowerCase();
  const own = await exchangeDraftCopyIds();
  if (!own.size) return;
  const rows = await mailStore().messages.thread(email, threadId).catch(() => []);
  for (const row of rows) {
    if (!row.isDraft || row.messageId === except || !own.has(row.messageId)) continue;
    await discardExchangeDraft(email, row.messageId, true);
  }
}
