"use client";

/**
 * Which connected mailboxes are Outlook.
 *
 * Asked because of Send later: Exchange can hold a message until a time and
 * send it itself, and Gmail has nothing we can ask for the same thing. So the
 * control is offered on an Outlook or an on-prem Exchange account and
 * nowhere else — an account that cannot keep the promise must not appear to
 * make it.
 *
 * One request for the whole page, however many composers ask. The answer only
 * changes when somebody connects or disconnects a mailbox, which reloads the
 * view that holds them.
 */

import { mailSay } from "@/lib/mail/i18n-strings";
import * as React from "react";

import { mailApiJson as apiJson } from "@/lib/mail/api";
import { tauriInvoke } from "@/lib/mail/store/tauri";
import type { MailProvider } from "@/lib/mail/types";

let pending: Promise<Set<string>> | null = null;

/*
  The Exchange (EWS) mailboxes, known the same way, so that a place which
  picks between "Outlook" and "Gmail" can say Exchange instead. Without
  this, every mailbox that is not Outlook is taken for Gmail: a reconnect
  goes to Google's sign-in, and a toast says "Gmail". Internal flavor only.
*/
let exchangePending: Promise<Set<string>> | null = null;
let exchangeKnown = new Set<string>();

function loadExchangeAccounts(): Promise<Set<string>> {
  // The desktop app only: a web host has no route.
  if (!tauriInvoke()) return Promise.resolve(exchangeKnown);
  exchangePending ??= apiJson<{ accounts?: { email: string }[] }>("/api/exchange/accounts")
    .then((json) => {
      exchangeKnown = new Set((json.accounts ?? []).map((a) => a.email.trim().toLowerCase()));
      return exchangeKnown;
    })
    .catch(() => {
      exchangePending = null;
      return exchangeKnown;
    });
  return exchangePending;
}

/** The hooks that hold a copy of the lists, to be told to read them again. */
const listeners = new Set<() => void>();

/**
 * Forget both lists, after a mailbox was connected or removed, and have
 * every hook read them again. If the hooks read them only once, when the
 * window opens, a mailbox connected later is taken for Gmail. It then shows
 * the Gmail mark until the app starts again.
 */
export function forgetMailProviderLists(): void {
  pending = null;
  exchangePending = null;
  for (const read of listeners) read();
}

/** Both lists, now and again after each `forgetMailProviderLists`. */
function useProviderLists(take: (outlook: Set<string>, exchange: Set<string>) => void): void {
  const takeRef = React.useRef(take);
  takeRef.current = take;
  React.useEffect(() => {
    let live = true;
    const read = () => {
      void Promise.all([loadOutlookAccounts(), loadExchangeAccounts()]).then(([outlook, exchange]) => {
        if (live) takeRef.current(outlook, exchange);
      });
    };
    read();
    listeners.add(read);
    return () => {
      live = false;
      listeners.delete(read);
    };
  }, []);
}

/**
 * The provider of a mailbox, for a place that has `isOutlookAccount` at
 * hand. Exchange is asked first. Anything else unknown is Gmail, as before.
 */
export function mailProviderFor(email: string, isOutlookAccount: (email: string) => boolean): MailProvider {
  if (exchangeKnown.has(email.trim().toLowerCase())) return "exchange";
  return isOutlookAccount(email) ? "outlook" : "gmail";
}

/** The provider's name for a reader. */
export function mailProviderLabel(provider: MailProvider): string {
  if (provider === "exchange") return "Exchange";
  return provider === "outlook" ? "Outlook" : "Gmail";
}

function loadOutlookAccounts(): Promise<Set<string>> {
  pending ??= apiJson<{ accounts?: { email: string }[] }>(
    "/api/outlook/accounts"
  )
    .then(
      (json) =>
        new Set((json.accounts ?? []).map((a) => a.email.trim().toLowerCase()))
    )
    .catch(() => {
      // No Outlook connected, or the call failed. Either way nothing is
      // offered, and a later mount can ask again.
      pending = null;
      return new Set<string>();
    });
  return pending;
}

/**
 * The connected Outlook mailboxes, in the order the app knows them.
 *
 * Asked because of the hand-over to Outlook: a draft made over Graph has to
 * be made in a mailbox Graph holds, and which mailbox that is has nothing
 * to do with the account the reply is being written from. Somebody whose
 * university will not let them send from anywhere else needs the draft in
 * the university's mailbox, whatever they were reading when they asked.
 */
export function useOutlookAccounts(): string[] {
  const [outlook, setOutlook] = React.useState<string[]>(() => []);
  useProviderLists((set) => setOutlook([...set]));
  return outlook;
}

/**
 * Who keeps a message sent later until its time.
 *
 * - "server": Outlook. Microsoft's server holds it and sends it, with
 *   nothing of ours running.
 * - "computer": Gmail and Exchange, in the desktop app. Gmail's API has no
 *   send time, and on Exchange 2019 a held message cannot be cancelled
 *   (docs/mail-exchange-ews.md, 17.1). So the message waits as a draft on
 *   the server, and this computer sends it (docs/mail-send-later.md). A
 *   Gmail mailbox with a local copy keeps it in the outbox instead.
 *
 * Null: no send later here — Gmail or Exchange in a browser, which has no
 * store to keep the schedule in.
 */
export type SendLaterHolder = "server" | "computer";

export function useSendLaterHolder(account: string): SendLaterHolder | null {
  const [outlook, setOutlook] = React.useState<Set<string>>(() => new Set());
  useProviderLists((set) => setOutlook(new Set(set)));
  if (outlook.has(account.trim().toLowerCase())) return "server";
  return tauriInvoke() ? "computer" : null;
}

export function useCanSendLater(account: string): boolean {
  return useSendLaterHolder(account) !== null;
}

/**
 * The one notice after Send later, in the Undo pill: when it goes, and, for
 * a message this computer sends, the condition it goes on.
 */
export async function sendLaterNotice(account: string, when: string): Promise<string> {
  const outlook = await loadOutlookAccounts();
  const key = outlook.has(account.trim().toLowerCase()) ? "sendsAtWhen" : "sendsAtWhenIfOpen";
  return mailSay(key, { when });
}

/**
 * The providers behind the connected mailboxes, named for a reader.
 *
 * So a wait can say where it is waiting on. "Loading…" over an empty list
 * says only that something is wrong with us; naming the server says the
 * delay is a round trip to Google or Microsoft, which is both true and the
 * one thing that makes a slow list bearable.
 *
 * Gmail is the assumption while the answer is still being fetched: it is
 * the commoner of the two, and the line is a courtesy rather than a fact
 * anything depends on.
 */
export function useMailProviderNames(accounts: string[]): string {
  const [outlook, setOutlook] = React.useState<Set<string>>(() => new Set());
  useProviderLists((set) => setOutlook(new Set(set)));

  const names = new Set(accounts.map((e) => mailProviderLabel(mailProviderFor(e, (x) => outlook.has(x.trim().toLowerCase())))));
  const order = ["Gmail", "Outlook", "Exchange"].filter((n) => names.has(n));
  if (!order.length) return "Gmail";
  return order.length === 1 ? order[0] : `${order.slice(0, -1).join(", ")} and ${order[order.length - 1]}`;
}

/**
 * Ask, of any mailbox, whether it is an Outlook one.
 *
 * For the places where the two providers do genuinely different things and
 * the reader has to be told which before they agree to it — deleting a
 * folder being the one that matters: on Outlook the folder and its mail go
 * to Deleted Items, on Gmail the label comes off and the conversations
 * stay where they were.
 */
export function useIsOutlookAccount(): (email: string) => boolean {
  const [outlook, setOutlook] = React.useState<Set<string>>(() => new Set());
  // The Exchange list is read too, so `mailProviderFor` knows it by the time
  // this answer changes and the callers draw again. A new Set each time, so
  // they draw again even when the Outlook list did not change.
  useProviderLists((set) => setOutlook(new Set(set)));
  return React.useCallback(
    (email: string) => outlook.has(email.trim().toLowerCase()),
    [outlook]
  );
}

/**
 * The provider of the mailbox a message is sent from, for words that name
 * it. Gmail until the lists are read, as `mailProviderFor` does.
 */
export function useSenderProvider(account: string): MailProvider {
  const [lists, setLists] = React.useState<{ outlook: Set<string>; exchange: Set<string> }>(() => ({
    outlook: new Set(),
    exchange: new Set(),
  }));
  useProviderLists((outlook, exchange) => setLists({ outlook, exchange }));
  const email = account.trim().toLowerCase();
  if (lists.exchange.has(email)) return "exchange";
  return lists.outlook.has(email) ? "outlook" : "gmail";
}
