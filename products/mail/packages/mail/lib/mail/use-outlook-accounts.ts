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

import * as React from "react";

import { mailApiJson as apiJson } from "@/lib/mail/api";
import { tauriInvoke } from "@/lib/mail/store/tauri";
import type { MailProvider } from "@/lib/mail/types";

let pending: Promise<Set<string>> | null = null;

/*
  The Exchange (EWS) mailboxes, known the same way, so that a place which
  picks between "Outlook" and "Gmail" can say Exchange instead. Before this,
  every mailbox that was not Outlook was taken for Gmail: a reconnect went
  to Google's sign-in, and a toast said "Gmail". Internal flavor only.
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
 * every hook read them again. Before, the hooks read them once, when the
 * window opened: a mailbox connected later was taken for Gmail, with the
 * Gmail mark, until the app was started again (2026-09-29).
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
 * True when this mailbox can be asked to hold a message until a time.
 *
 * Outlook only, and not because Gmail lacks the feature — Gmail has had
 * Schedule send in its own web UI since 2019, and a Scheduled view to go
 * with it. The Gmail API does not expose it: `users.messages.send` takes a
 * message and sends it, with no field for a send time, and there is no
 * other call that will make one. Exchange has a message property for
 * exactly this (PR_DEFERRED_SEND_TIME — see `lib/outlook/api`), so the
 * server holds the message and sends it itself with nothing of ours
 * running.
 *
 * Which is why this cannot be widened without building a scheduler: with
 * no provider to hold the message, something of ours has to be awake at
 * the send time.
 */
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

export function useCanSendLater(account: string): boolean {
  const [holders, setHolders] = React.useState<Set<string>>(() => new Set());
  // Not an on-prem Exchange mailbox: there a held message cannot be
  // cancelled (docs/mail-exchange-ews.md, 17.1).
  useProviderLists((outlook) => setHolders(new Set(outlook)));
  return holders.has(account.trim().toLowerCase());
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
