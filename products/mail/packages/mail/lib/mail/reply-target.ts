/**
 * Which way a reply goes.
 *
 * Reply to a message somebody sent you and it goes back to them. Reply to
 * one you sent, and it goes to whoever you addressed it to — not to
 * yourself. So the question is only ever: did this message go out from the
 * mailbox I am reading it in?
 *
 * "From an address of mine" is not the same question, and answering that one
 * instead is what broke a thread between two of the reader's own mailboxes.
 * Mail sent from their Gmail to their Outlook, read in the Outlook mailbox,
 * counted as sent-by-us because Gmail is theirs — so the reply was addressed
 * to the Outlook mailbox it was already sitting in, and writing back to
 * yourself was the only thing you could do.
 *
 * No React and no network in here, so a test can read it.
 */

import { isOwnPersonalAddress, normalizeEmail } from "@/lib/own-addresses";

/**
 * True when the reply should go to the message's recipients rather than to
 * its sender — that is, when this mailbox is the one that sent it.
 *
 * Three cases, in order:
 *
 * 1. It came from this very mailbox. Outgoing, whoever else it reached —
 *    which is what keeps cc-ing yourself working: the copy that lands back
 *    in your inbox is still a message you sent, and the reply belongs to the
 *    person you sent it to.
 * 2. It was delivered here — this mailbox is in To or Cc. Incoming, even
 *    from another address of your own. This is the thread-with-yourself
 *    case, and the sender is a real place to reply to.
 * 3. Neither: it is from an address of yours and was not addressed here, so
 *    it went out under an alias this mailbox sends as. Outgoing.
 */
export function sentFromThisMailbox(input: {
  from: string;
  account: string;
  to: readonly string[];
  cc: readonly string[];
}): boolean {
  const from = normalizeEmail(input.from ?? "");
  if (!from) return false;
  const account = normalizeEmail(input.account);
  if (from === account) return true;

  const deliveredHere = [...input.to, ...input.cc].some(
    (address) => normalizeEmail(address ?? "") === account
  );
  if (deliveredHere) return false;

  return isOwnPersonalAddress(from);
}

/**
 * Who a reply-all goes to, from the newest message's sender, To and Cc.
 *
 * Every address of the reader's own is taken off — the mailbox it leaves
 * from, and their other mailboxes and aliases too. Before, only the sending
 * mailbox came off, so a reply-all from one address of yours to a thread
 * that had also reached another of yours put that one in To, and the
 * reply went to yourself as well as to everyone else.
 *
 * Two cases keep an address of yours on purpose:
 *
 * - The message came from another mailbox of yours and was delivered here.
 *   Its sender is the place to reply to — the thread-with-yourself case
 *   `sentFromThisMailbox` guards — so the sender stays.
 * - Nobody would be left: a message you sent only to your own addresses.
 *   Then the reply goes where that one went, and failing that to the
 *   mailbox itself.
 *
 * Duplicates go, ignoring case and Gmail dot and +tag variants, and nobody
 * is both in To and in Cc.
 */
export function replyAllRecipients(input: {
  from: string;
  to: readonly string[];
  cc: readonly string[];
  account: string;
  /** The answer of `sentFromThisMailbox` for this message. */
  sentByUs: boolean;
}): { to: string[]; cc: string[] } {
  const accountKey = normalizeEmail(input.account);
  const seen = new Set<string>([accountKey]);
  const take = (items: readonly string[], keepOwn: boolean) => {
    const out: string[] = [];
    for (const raw of items) {
      const email = (raw ?? "").trim();
      if (!email) continue;
      const key = normalizeEmail(email);
      if (seen.has(key)) continue;
      if (!keepOwn && isOwnPersonalAddress(email)) continue;
      seen.add(key);
      out.push(email);
    }
    return out;
  };

  const to = [
    ...(input.sentByUs ? [] : take([input.from], true)),
    ...take(input.to, false),
  ];
  const cc = take(input.cc, false);
  if (to.length) return { to, cc };

  // Nobody else on it. A message you wrote to your own addresses is answered
  // where it went; failing even that, the mailbox itself.
  seen.clear();
  seen.add(accountKey);
  const own = take(input.sentByUs ? input.to : [input.from, ...input.to], true);
  return { to: own.length ? own : [input.account], cc };
}

/**
 * Reply recipients drop the sending mailbox; a self-thread keeps it.
 *
 * A thread of notes to yourself would otherwise strip down to nobody, and
 * replying to yourself is legitimate. Shared by the Gmail reader and the
 * local copy's reader.
 */
export function withSelfFallback(list: string[], account: string): string[] {
  return list.length ? list : [account];
}

/**
 * Reply recipients: without blanks, without the same address twice (Gmail's
 * dot and +tag forms count as one), and without the mailbox we send from,
 * so a reply never lands back in this inbox.
 */
function replyRecipients(items: string[], account: string): string[] {
  const accountKey = normalizeEmail(account);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const email = raw.trim();
    if (!email) continue;
    const key = normalizeEmail(email);
    if (key === accountKey || seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

/**
 * Whom Reply and Reply all go to, from a thread's newest message.
 *
 * Reply goes to the sender, or, when this mailbox sent it, to whoever it
 * was addressed to. The Gmail, Outlook and local-copy readers all ask
 * here, each with the addresses read from its own shape of message.
 */
export function replyTargets(input: {
  from: string;
  to: string[];
  cc: string[];
  account: string;
}): { to: string[]; allTo: string[]; allCc: string[] } {
  const sentByUs = sentFromThisMailbox(input);
  const replyTo = sentByUs ? input.to : [input.from];
  const replyAll = replyAllRecipients({ ...input, sentByUs });
  return {
    to: withSelfFallback(replyRecipients(replyTo, input.account), input.account),
    allTo: replyAll.to,
    allCc: replyAll.cc,
  };
}
