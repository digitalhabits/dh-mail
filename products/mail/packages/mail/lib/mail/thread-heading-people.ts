/**
 * Who is on a thread, for its heading: the people, and which of the
 * addresses are yours. No React here, so a test can read it.
 */

import type { MailMessage } from "@/lib/mail/types";

export type ParticipantChunk =
  | { kind: "person"; label: string; email: string; name?: string }
  /** `plain`: "You", the addresses on hover — when one mailbox's tab is chosen, it is no news. */
  | {
      kind: "you";
      emails: string[];
      plain?: boolean;
      /** Those of `emails` that are mailboxes connected here, lowercased. */
      mailboxes?: string[];
    };

/**
 * Who is on the thread, with their addresses: "Roe, Jane
 * (jane.roe@example.org)". A name alone is what the list rows show, and
 * enough there; the header is where the reader checks who a person actually
 * is, and that is the address.
 *
 * Senders and recipients both. Senders alone left a thread of sent mail
 * saying nobody but "You", with no sign of who it went to. A recipient is
 * known by address only unless they wrote in the thread as well, in which
 * case their name comes from that.
 *
 * "You" stands in for every own address — the mailboxes connected here, and
 * whoever sent the messages marked as ours — and says which they were:
 * "You (you@work.example, you@home.example)". Own is not one address, and
 * is the one place to see which of yours a thread ran through.
 */
export function threadPeople(
  messages: MailMessage[],
  ownAddresses: string[]
): { others: { email: string; name?: string }[]; yours: string[] } {
  const own = new Set(ownAddresses.map((a) => a.trim().toLowerCase()));
  for (const m of messages) {
    if (m.own && m.fromEmail) own.add(m.fromEmail.trim().toLowerCase());
  }
  const nameByAddress = new Map<string, string>();
  for (const m of messages) {
    const key = m.fromEmail.trim().toLowerCase();
    const name = m.fromName.split("<")[0].trim();
    if (key && name && name.toLowerCase() !== key && !nameByAddress.has(key)) {
      nameByAddress.set(key, name);
    }
  }
  const others: { email: string; name?: string }[] = [];
  const yours: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const email = raw.trim();
    const key = email.toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    if (own.has(key)) {
      yours.push(email);
      return;
    }
    others.push({ email, name: nameByAddress.get(key) });
  };
  for (const m of messages) {
    add(m.fromEmail);
    for (const to of m.toEmails) add(to);
    for (const cc of m.ccEmails) add(cc);
  }
  return { others, yours };
}

/**
 * The line's people. "You (…)" always holds the mailbox the thread came in
 * on, which the line no longer names apart: a list's mail or a Bcc names
 * none of your addresses, and the mailbox went with them.
 */
export function participantsWithAddresses(
  messages: MailMessage[],
  ownAddresses: string[],
  receivedOn?: string,
  /** One mailbox's tab is chosen: "You" for yours, rather than the mailbox. */
  plainYou = false
): ParticipantChunk[] {
  const { others, yours: named } = threadPeople(messages, ownAddresses);
  const mailbox = receivedOn?.trim();
  const yours =
    mailbox && !named.some((e) => e.trim().toLowerCase() === mailbox.toLowerCase())
      ? [mailbox, ...named]
      : named;
  return [
    ...others.map(
      (p): ParticipantChunk => ({
        kind: "person",
        label: p.name ? `${p.name} (${p.email})` : p.email,
        email: p.email,
        name: p.name,
      })
    ),
    ...(yours.length
      ? [
          {
            kind: "you",
            emails: yours,
            plain: plainYou,
            mailboxes: ownAddresses.map((a) => a.trim().toLowerCase()),
          } satisfies ParticipantChunk,
        ]
      : []),
  ];
}

