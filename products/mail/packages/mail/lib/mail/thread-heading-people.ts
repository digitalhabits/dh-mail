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
 * Senders and recipients both. With senders alone, a thread of sent mail
 * says nobody but "You", with no sign of who it went to. A recipient is
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
 * on, which the line does not name apart: a list's mail or a Bcc names
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


/**
 * A name as the heading shows it: the first name and the last, and nothing
 * the sender put after it. "Mikkel Gabriel Christoffersen" is "Mikkel
 * Christoffersen"; "Roe, Jane" is "Jane Roe"; "Claire Cockcroft (SC MTST
 * Programme Director)" is "Claire Cockcroft". The card of everyone keeps
 * the whole name.
 */
export function headingName(name: string): string {
  let n = name.replace(/\s*\([^()]*\)\s*$/, "").replace(/^["']|["']$/g, "").trim();
  const comma = n.match(/^([^,]+),\s*(.+)$/);
  if (comma) n = `${comma[2]} ${comma[1]}`.trim();
  const words = n.split(/\s+/).filter(Boolean);
  if (words.length <= 2) return words.join(" ");
  return `${words[0]} ${words[words.length - 1]}`;
}

/**
 * Who the heading names, in order: who started the thread first, then the
 * rest as the thread met them. All of the reader's own addresses are one
 * "You" (`you`), wherever they fall. A person with no name is their address.
 */
export function headingPeople(
  people: readonly ParticipantChunk[],
  leadEmail: string | undefined,
  you: string
): string[] {
  const key = leadEmail?.trim().toLowerCase();
  const isLead = (c: ParticipantChunk) =>
    Boolean(key) &&
    (c.kind === "you"
      ? c.emails.some((e) => e.trim().toLowerCase() === key)
      : c.email.trim().toLowerCase() === key);
  const lead = people.find(isLead) ?? people[0];
  const ordered = lead ? [lead, ...people.filter((c) => c !== lead)] : [];
  const names: string[] = [];
  for (const c of ordered) {
    const name = c.kind === "you" ? you : c.name ? headingName(c.name) || c.email : c.email;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * The line itself: one name; "A and B"; then "A, B and 2 more".
 */
export function headingPeopleLine(
  names: readonly string[],
  words: { and: string; more: (count: number) => string }
): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} ${words.and} ${names[1]}`;
  return `${names[0]}, ${names[1]} ${words.and} ${words.more(names.length - 2)}`;
}
