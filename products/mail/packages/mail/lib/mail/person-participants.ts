/**
 * Who a person-view row is about.
 *
 * A thread can name one person twice, under two addresses. The list payload
 * keeps both, because they are two mailboxes. The row must not: two entries
 * with the same full name on one thread are one person, and treating them as
 * two makes a one-to-one conversation look like a group.
 *
 * This thread only. Across the inbox, two people can share a name.
 */

import {
  isOwnPersonalAddress,
  normalizeEmail,
} from "@/lib/own-addresses";
import type { MailThreadSummary } from "@/lib/mail/types";
import { addressIdentity, mailerIdentityAddress, type PersonIdentity } from "@/lib/mail/person-identity";

export type PersonParticipant = { name: string; email: string };

export type PersonRow = {
  /** Stable key: counterpart email, or the participant set for group mail. */
  key: string;
  isGroup: boolean;
  name: string;
  /** Counterpart address for one-on-one rows; empty for group rows. */
  email: string;
  /** External correspondents on the conversation (1 for one-on-one rows). */
  participantCount: number;
  /** The same people, in the same order, as the row title names. */
  people: PersonParticipant[];
  /** Newest first. */
  threads: MailThreadSummary[];
  lastAt: string;
  unread: boolean;
  crmName?: string;
  crmLogoUrl?: string;
};

/**
 * Drop a second address for the same person on this thread.
 *
 * Two entries whose full names match — trimmed, lower-cased, both
 * non-empty — are one person. The first stays, which is the one the
 * thread led with. An entry with no name is never merged. A later
 * contact identity can feed this without any caller changing.
 */
export function collapseSameNameParticipants<T extends PersonParticipant>(
  people: T[]
): T[] {
  const seen = new Set<string>();
  const kept: T[] = [];
  for (const person of people) {
    const name = person.name.trim().toLowerCase();
    if (name && seen.has(name)) continue;
    if (name) seen.add(name);
    kept.push(person);
  }
  return kept;
}

/**
 * Title for a multi-person row: list the other people (not "you"). Two names
 * stay full; larger groups keep the first two and a +N so the list stays short.
 */
export function groupPeopleLabel(people: PersonParticipant[]): string {
  const labels = people.map((p) => p.name || p.email).filter(Boolean);
  if (labels.length === 0) return "Group";
  if (labels.length <= 2) return labels.join(", ");
  return `${labels.slice(0, 2).join(", ")} +${labels.length - 2}`;
}

/**
 * The other people on one thread: you and your own addresses left out, a
 * second address for the same name dropped, the counterpart first.
 *
 * The person view groups by this and the thread list draws its avatar from
 * it, so one thread shows the same faces in both.
 */
export function threadPeople(t: MailThreadSummary): {
  externals: PersonParticipant[];
  lead: PersonParticipant;
  /** Lead first, then the rest in list order (To order on send). */
  named: PersonParticipant[];
  /** You + one other = 1:1. You + two others (Dana and Chris) = group. */
  isGroup: boolean;
} {
  // Rows from an older cache have no participant list; fall back to the
  // counterpart so the view still works until the next refresh.
  const raw = t.externalParticipants?.length
    ? t.externalParticipants
    : [{ name: t.fromName, email: t.fromEmail }];
  const accountKey = normalizeEmail(t.account);
  const externals = collapseSameNameParticipants(
    raw.filter((p) => {
      if (!p.email) return false;
      if (normalizeEmail(p.email) === accountKey) return false;
      if (isOwnPersonalAddress(p.email)) return false;
      return true;
    })
  );
  // Prefer the row's counterpart (fromEmail) when it is truly external —
  // on Sent that is first To — not Map insertion order, and never "you".
  const lead =
    externals.find(
      (p) =>
        p.email.toLowerCase() === t.fromEmail.toLowerCase() &&
        !isOwnPersonalAddress(p.email)
    ) ??
    externals[0] ?? { name: t.fromName, email: t.fromEmail };
  const isGroup = externals.length >= 2;
  const named =
    isGroup && lead.email
      ? [
          lead,
          ...externals.filter(
            (p) => p.email.toLowerCase() !== lead.email.toLowerCase()
          ),
        ]
      : externals;
  return { externals, lead, named, isGroup };
}

/**
 * Collapse threads into one row per correspondent, iMessage-style. Identity is
 * the counterpart's email address — never the CRM record, which is usually an
 * organization and would lump colleagues together.
 *
 * **One other person** → one-on-one row under them. **Two or more others**
 * (you + Dana + Chris) → a group row keyed by the participant set, so it is
 * not filed under whoever was first in To.
 *
 * When the tip is from us (Sent), `fromName`/`fromEmail` should already be the
 * first external To. We also strip self here: list summaries can still include
 * a personal alias as "external" until own-identity env is loaded / refreshed.
 */
export function groupThreadsByPerson(
  threads: MailThreadSummary[],
  /**
   * Who an address belongs to — see person-identity. Without it every
   * address is its own person, which is what this did before the books.
   */
  identity: PersonIdentity = addressIdentity
): PersonRow[] {
  const rows = new Map<string, PersonRow>();
  for (const t of threads) {
    const { externals, lead, named, isGroup } = threadPeople(t);
    // Keyed by who the addresses belong to, so a person writing from two
    // addresses on one contact card is one row — and a group of the same
    // people is one row whichever addresses they wrote from.
    const key = isGroup
      ? `group:${[
          ...new Set(
            // The identity less its "person:" prefix, so a group of
            // addresses on no card keeps the key it always had — and the
            // pin that was kept under it.
            externals.map((p) => identity(mailerIdentityAddress(p.email)).replace(/^person:/, ""))
          ),
        ]
          .sort()
          .join(",")}`
      : identity(mailerIdentityAddress(lead.email));

    const existing = rows.get(key);
    if (existing) {
      existing.threads.push(t);
      if (t.unread) existing.unread = true;
      if (!existing.crmName && t.crmName) existing.crmName = t.crmName;
      if (!existing.crmLogoUrl && t.crmLogoUrl) {
        existing.crmLogoUrl = t.crmLogoUrl;
      }
      // Prefer a real external name over a stale "you" label on older tips.
      if (
        lead.name &&
        lead.email &&
        !existing.isGroup &&
        existing.email.toLowerCase() === lead.email.toLowerCase() &&
        (!existing.name ||
          existing.name.toLowerCase() === existing.email.toLowerCase())
      ) {
        existing.name = lead.name;
      }
      // The same person under another address: the row keeps the newest
      // address as its own and names the rest, so the header can list them.
      if (
        !existing.isGroup &&
        lead.email &&
        !existing.people.some(
          (p) => p.email.toLowerCase() === lead.email.toLowerCase()
        )
      ) {
        existing.people.push({ name: lead.name, email: lead.email });
      }
    } else {
      rows.set(key, {
        key,
        isGroup,
        name: isGroup ? groupPeopleLabel(named) : lead.name || lead.email,
        email: isGroup ? "" : lead.email,
        participantCount: externals.length,
        people: named,
        threads: [t],
        lastAt: t.lastAt,
        unread: t.unread,
        crmName: t.crmName,
        crmLogoUrl: t.crmLogoUrl,
      });
    }
  }
  // Input is newest-first, so insertion order already sorts rows by most
  // recent message.
  return [...rows.values()];
}
