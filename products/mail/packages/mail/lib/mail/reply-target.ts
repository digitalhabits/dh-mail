/**
 * Which way a reply goes.
 *
 * Reply to a message somebody sent you and it goes back to them. Reply to
 * one you sent, and it goes to whoever you addressed it to — not to
 * yourself. So the question is only ever: did this message go out from the
 * mailbox I am reading it in?
 *
 * "From an address of mine" is not the same question. That question breaks
 * a thread between two of the reader's own mailboxes. Take mail sent from
 * their Gmail to their Outlook, read in the Outlook mailbox. It counts as
 * sent-by-us because Gmail is theirs. So the reply goes to the Outlook
 * mailbox that it is already in, and writing back to yourself is the only
 * thing you can do.
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
 * from, and their other mailboxes and aliases too. If only the sending
 * mailbox comes off, a reply-all can go to yourself as well as to everyone
 * else. That occurs when the thread also reached another address of yours:
 * that address goes in To.
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

/**
 * The mailbox a reply to an incoming message goes from, when the message
 * came to more than one of the reader's mailboxes.
 *
 * A message with one of the reader's addresses in To and another in Cc is
 * in both mailboxes, and the list shows it as one row. The reply went from
 * the mailbox whose copy the row opened, so the answer to a mail sent to
 * the work address could go from the address that was only on Cc
 * (reported 2026-11-18). The reply goes from the mailbox the mail was sent
 * to: one in To comes before one in Cc, and one in Cc comes before one
 * that is in neither (Bcc, or a list). Mailboxes of the same rank: the open
 * one stays.
 *
 * `holders` are the other mailboxes that hold this message. A mailbox can
 * have more addresses than the one it is connected as: an Exchange mailbox
 * signs in as one address and gets its mail at another. `addressesOf` gives
 * every address of a mailbox (exchange-own-addresses.ts), and any of them
 * in To or Cc names the mailbox.
 *
 * For an alias that no mailbox is known to have: when exactly one of the
 * mailboxes is not named, an alias of the reader's in To or Cc is taken as
 * that mailbox.
 *
 * A message the reader sent is not changed here: see `sentFromThisMailbox`.
 */
export function replyMailbox(input: {
  account: string;
  holders: readonly string[];
  from: string;
  to: readonly string[];
  cc: readonly string[];
  addressesOf?: (mailbox: string) => readonly string[];
}): string {
  const key = (address: string) => normalizeEmail(address ?? "");
  const mailboxes = [input.account, ...input.holders.filter((h) => key(h) !== key(input.account))];
  if (mailboxes.length < 2) return input.account;
  const addresses = new Map(
    mailboxes.map((m) => [m, new Set([key(m), ...(input.addressesOf?.(m) ?? []).map(key)])] as const)
  );
  const known = new Set([...addresses.values()].flatMap((set) => [...set]));
  if (known.has(key(input.from)) || isOwnPersonalAddress(input.from)) return input.account;

  const to = input.to.map(key);
  const cc = input.cc.map(key);
  const namedIn = (list: readonly string[], mailbox: string) => list.some((a) => addresses.get(mailbox)!.has(a));
  const notNamed = mailboxes.filter((m) => !namedIn(to, m) && !namedIn(cc, m));
  const alias = (list: readonly string[]) => list.some((a) => !known.has(a) && isOwnPersonalAddress(a));
  const aliasRank = notNamed.length === 1 ? (alias(to) ? 0 : alias(cc) ? 1 : 2) : 2;
  const rank = (mailbox: string) =>
    namedIn(to, mailbox) ? 0 : namedIn(cc, mailbox) ? 1 : mailbox === notNamed[0] ? aliasRank : 2;

  let best = input.account;
  for (const mailbox of mailboxes) if (rank(mailbox) < rank(best)) best = mailbox;
  return best;
}
