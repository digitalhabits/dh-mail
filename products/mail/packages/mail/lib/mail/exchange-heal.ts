/**
 * Mend a row of the local copy whose item id the Exchange server no longer
 * knows.
 *
 * Seen on the KU server (2026-09-27): after moves, a row kept an id that
 * `GetItem` answered with `ErrorItemNotFound`, while the message was still
 * in the folder under another id. The folder's sync state said "up to
 * date", so no pass would ever bring the message again, and Show original,
 * its files, and its body failed for good.
 *
 * The mend: take the row out, drop the sync state of the folder it was in,
 * and wake the worker. The next pass reads that folder from the start and
 * writes the message again under the id the server has now.
 */

import { folderLabelOf, placeOf } from "@/lib/mail/exchange-actions";
import { readExchangeFolders } from "@/lib/mail/exchange-folders";
import { wakeExchangeSync } from "@/lib/mail/exchange-sync";
import { notifySyncChanged } from "@/lib/mail/local-store";
import { mailStore } from "@/lib/mail/store";
import type { MailSyncState } from "@/lib/mail/store/types";

/** The words the Rust side uses when the server gave no message for an id. */
const NOT_GIVEN = "did not give this message";

export function isStaleExchangeItem(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes(NOT_GIVEN);
}

/** What the reader is told while the folder is read again. */
export const STALE_ITEM_MESSAGE =
  "ews:gone: This message moved on the server. The app is reading its folder again. Try again in a minute.";

export async function mendStaleExchangeItem(account: string, messageId: string, threadId?: string | null): Promise<void> {
  const email = account.trim().toLowerCase();
  const store = mailStore();
  let folderId: string | undefined;
  if (threadId) {
    type Row = Parameters<typeof folderLabelOf>[0];
    const rows = (await store.messages.thread(email, threadId)) as Row[];
    const row = rows.find((r) => r.messageId === messageId);
    if (row) {
      const place = placeOf(await readExchangeFolders(email), rows);
      folderId = place.folderOf.get(folderLabelOf(row, place.folderOf));
    }
  }
  await store.messages.removeMessages(email, [messageId]);
  if (folderId) {
    const state = { account: email, folder: folderId, phase: "none", deltaLink: null } as unknown as MailSyncState;
    await store.sync.set(state).catch(() => undefined);
  }
  console.warn(`[mail-sync] ${email}: an item id the server no longer knows; reading its folder again`);
  notifySyncChanged(email);
  wakeExchangeSync(email, "all");
}
