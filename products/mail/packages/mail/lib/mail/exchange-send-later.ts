/**
 * Messages an Exchange (EWS) server holds for a time (section 16.4 of
 * `docs/mail-exchange-ews.md`).
 *
 * The app does not send later from Exchange: on Exchange 2019 a held
 * message cannot be cancelled (17.1). But another client, such as Outlook,
 * can leave one, so the list still reads Outbox and Sent Items. Cancel
 * keeps the message as a draft, in Drafts. Send now sends it at once. The
 * requests are in Rust (`ews_later.rs`).
 */

import { invoke, type ExchangeAddress } from "@/lib/mail/exchange-native";
import { wakeExchangeSync } from "@/lib/mail/exchange-sync";
import type { MailScheduledMessage } from "@/lib/mail/types";

/** A held message, as `mail_ews_held` gives it. */
type Held = {
  id: string;
  sendAt: string;
  cancellable: boolean;
  conversationId: string | null;
  subject: string;
  to: ExchangeAddress[];
  cc: ExchangeAddress[];
  preview: string;
  text: string | null;
  html: string | null;
};

function normalize(account: string): string {
  return account.trim().toLowerCase();
}

function asScheduled(account: string, held: Held): MailScheduledMessage {
  const first = held.to[0];
  return {
    id: held.id,
    sendAt: new Date(Date.parse(held.sendAt)).toISOString(),
    account,
    threadId: held.conversationId || held.id,
    toName: first?.name.trim() || first?.email || "",
    subject: held.subject.trim(),
    bodyText: held.text?.trim() || held.preview,
    ...(held.html ? { bodyHtml: held.html } : null),
    to: held.to.map((a) => a.email),
    cc: held.cc.map((a) => a.email),
    cancellable: held.cancellable !== false,
  };
}

/** The messages the server holds, soonest first. One thread, or all. */
export async function listExchangeHeld(account: string, threadId?: string): Promise<MailScheduledMessage[]> {
  const email = normalize(account);
  const held = await invoke<Held[]>("mail_ews_held", { account: email });
  const rows = held.map((h) => asScheduled(email, h));
  return threadId ? rows.filter((r) => r.threadId === threadId) : rows;
}

/** Never send it: it goes to Drafts, with no time. */
export async function cancelExchangeHeld(account: string, itemId: string): Promise<void> {
  const email = normalize(account);
  await invoke("mail_ews_cancel_held", { account: email, itemId });
  wakeExchangeSync(email, "all");
}

/** Send it now instead of at its time. */
export async function sendExchangeHeldNow(account: string, itemId: string): Promise<void> {
  const email = normalize(account);
  await invoke("mail_ews_send_held_now", { account: email, itemId });
  wakeExchangeSync(email, "all");
}
