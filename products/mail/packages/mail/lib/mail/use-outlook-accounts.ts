"use client";

/**
 * Which connected mailboxes are Outlook.
 *
 * Asked because of Send later: Exchange can hold a message until a time and
 * send it itself, and Gmail has nothing we can ask for the same thing. So the
 * control is offered on an Outlook account and nowhere else — an account that
 * cannot keep the promise must not appear to make it.
 *
 * One request for the whole page, however many composers ask. The answer only
 * changes when somebody connects or disconnects a mailbox, which reloads the
 * view that holds them.
 */

import * as React from "react";

import { mailApiJson as apiJson } from "@/lib/mail/api";

let pending: Promise<Set<string>> | null = null;

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
  React.useEffect(() => {
    let live = true;
    void loadOutlookAccounts().then((set) => {
      if (live) setOutlook([...set]);
    });
    return () => {
      live = false;
    };
  }, []);
  return outlook;
}

export function useCanSendLater(account: string): boolean {
  const [outlook, setOutlook] = React.useState<Set<string>>(() => new Set());
  React.useEffect(() => {
    let live = true;
    void loadOutlookAccounts().then((set) => {
      if (live) setOutlook(set);
    });
    return () => {
      live = false;
    };
  }, []);
  return outlook.has(account.trim().toLowerCase());
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
  React.useEffect(() => {
    let live = true;
    void loadOutlookAccounts().then((set) => {
      if (live) setOutlook(set);
    });
    return () => {
      live = false;
    };
  }, []);

  const anyOutlook = accounts.some((e) => outlook.has(e.trim().toLowerCase()));
  const anyGmail = accounts.some((e) => !outlook.has(e.trim().toLowerCase()));
  if (anyOutlook && anyGmail) return "Gmail and Outlook";
  if (anyOutlook) return "Outlook";
  return "Gmail";
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
  React.useEffect(() => {
    let live = true;
    void loadOutlookAccounts().then((set) => {
      if (live) setOutlook(set);
    });
    return () => {
      live = false;
    };
  }, []);
  return React.useCallback(
    (email: string) => outlook.has(email.trim().toLowerCase()),
    [outlook]
  );
}
