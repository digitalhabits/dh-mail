/**
 * Sending from an Exchange (EWS) mailbox (phase 4, section 13 of
 * `docs/mail-exchange-ews.md`).
 *
 * The message is the MIME that the Gmail path builds too (the words, the
 * signature, the quote or the forward, the pictures, and the files). Rust
 * sends it with `CreateItem` and `SendAndSaveCopy`, so the server keeps the
 * copy in Sent Items, and the worker brings that copy into the list.
 */

import { utf8ToBase64 } from "@/lib/base64";
import { invoke as exchangeInvoke } from "@/lib/mail/exchange-native";
import { wakeExchangeSync } from "@/lib/mail/exchange-sync";
import { mailStore } from "@/lib/mail/store";

/**
 * The name for the `From` header: the one on the newest message in Sent
 * Items of the local copy. There is no send-as to ask, as Gmail has. With
 * no sent message yet, "": the address alone.
 */
export async function exchangeSenderName(account: string): Promise<string> {
  const email = account.trim().toLowerCase();
  const page = await mailStore()
    .messages.list({ accounts: [email], view: "sent", limit: 10 })
    .catch(() => ({ threads: [] as { latest: { fromEmail: string; fromName: string } }[] }));
  const own = page.threads.find((t) => t.latest.fromEmail.trim().toLowerCase() === email && t.latest.fromName.trim());
  return own?.latest.fromName.trim() ?? "";
}

/**
 * Send one MIME message from an Exchange mailbox. `bcc` goes beside the
 * MIME as well: the server can drop a `Bcc` header from it.
 */
export async function sendExchangeMessage(account: string, mime: string, bcc: string[]): Promise<void> {
  const email = account.trim().toLowerCase();
  await exchangeInvoke("mail_ews_send", { account: email, mime: utf8ToBase64(mime), bcc });
  // The copy in Sent Items, and a reply's place in its thread.
  wakeExchangeSync(email, "all");
}
