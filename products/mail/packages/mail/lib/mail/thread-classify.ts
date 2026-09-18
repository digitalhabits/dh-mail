/**
 * Which pile a conversation goes in, and who it is with.
 *
 * The rules here are about the reader, not about a provider: their contacts,
 * their own addresses, and which side of a message they are on. Gmail and
 * Outlook each had a copy, and the snoozed list had two more. Four copies of
 * one rule is how a change to it reaches three places and misses the fourth,
 * so the rule lives here and every list row is built through it.
 *
 * Nothing here touches the network or the store. A test can call it with
 * plain addresses.
 */

import {
  isOwnPersonalAddress,
  normalizeEmail,
} from "@/lib/own-addresses";
import { crmLogoUrlIfLoaded } from "@/lib/mail/crm-gate";
import type { MailTab } from "@/lib/mail/types";
import type { ContactIndex, CrmRecordRef } from "@/lib/crm-contact-index";

/** The contact matcher a list row is classified against. */
export type Classifier = {
  contacts: ContactIndex;
  domains: Map<string, CrmRecordRef[]>;
};

/** One name on an envelope. */
export type Address = { name: string; email: string };

/** Messages per page of a thread, on every provider. */
export const THREAD_PAGE_SIZE = 50;
/** Messages on each side of a search hit (plus the hit itself). */
export const THREAD_AROUND_RADIUS = 50;

/**
 * Own addresses whose self-mail (notes and forwards into the work inbox)
 * files under Other rather than In CRM. Comma-separated, from the env.
 */
export const NOT_CRM_SELF_ADDRESSES = new Set(
  (process.env.MAIL_OWN_PERSONAL_ADDRESSES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalizeEmail)
);

export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1) : "";
}

export function isKnownContact(
  email: string,
  classifier: Classifier
): boolean {
  return (
    classifier.contacts.has(email) ||
    classifier.domains.has(emailDomain(email))
  );
}

/** CRM record name a contact belongs to, for the affiliation label. */
export function crmNameFor(
  email: string,
  classifier: Classifier
): string | undefined {
  const byEmail = classifier.contacts.get(email);
  if (byEmail?.length) return byEmail[0].recordName;
  const byDomain = classifier.domains.get(emailDomain(email));
  return byDomain?.length ? byDomain[0].recordName : undefined;
}

export function crmLogoFor(
  email: string,
  classifier: Classifier
): string | undefined {
  return crmLogoUrlIfLoaded(email, classifier.contacts, classifier.domains);
}

/**
 * Sent by the reader personally: the account being read, or another of their
 * own mailboxes. Colleagues and shared mailboxes on the same domains are
 * deliberately *not* self — a reply to them must still reach them.
 */
export function isSelfAddress(email: string, account: string): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  if (normalized === normalizeEmail(account)) return true;
  return isOwnPersonalAddress(normalized);
}

export type ThreadClassification = {
  tab: MailTab;
  /** Who the row is shown as being with. */
  counterpart: Address;
  /** Everyone on the thread except our own addresses, one entry per email. */
  externalParticipants: Address[];
};

/**
 * Classify a thread from the names on its envelopes.
 *
 * `participants` is From, To and Cc of every message the caller has. Gmail
 * hands the list every message of the thread. Graph hands it the newest one,
 * and that is what it passes. `senders` is the From of those same messages,
 * for the self-note rule.
 *
 * The rules:
 *
 * - People when any outside address is a known contact, or when there is
 *   nobody outside at all — a note to yourself is yours — unless it came from
 *   an address in `NOT_CRM_SELF_ADDRESSES`.
 * - The counterpart is whoever wrote last. When that was us, it is the first
 *   outside address we wrote to — never ourselves.
 */
export function classifyThread(input: {
  accountEmail: string;
  participants: Address[];
  senders: Address[];
  latestFrom: Address | undefined;
  latestTo: Address[];
  classifier: Classifier;
}): ThreadClassification {
  const { accountEmail, classifier } = input;
  const external = input.participants.filter(
    (p) => p.email && !isSelfAddress(p.email, accountEmail)
  );
  const matchesContact = external.some((p) =>
    isKnownContact(p.email, classifier)
  );
  const fromNotCrmSelf = input.senders.some(
    (s) => s.email && NOT_CRM_SELF_ADDRESSES.has(normalizeEmail(s.email))
  );
  const tab: MailTab =
    matchesContact || (external.length === 0 && !fromNotCrmSelf)
      ? "people"
      : "other";

  const latestFrom = input.latestFrom?.email ? input.latestFrom : undefined;
  const latestToExternal = input.latestTo.filter(
    (p) => p.email && !isSelfAddress(p.email, accountEmail)
  );
  const counterpart =
    latestFrom && !isSelfAddress(latestFrom.email, accountEmail)
      ? latestFrom
      : latestToExternal[0] ??
        external[0] ??
        latestFrom ?? { email: accountEmail, name: "" };

  const byEmail = new Map<string, Address>();
  for (const p of external) {
    const existing = byEmail.get(p.email);
    if (!existing) byEmail.set(p.email, { ...p });
    else if (p.name) existing.name = p.name;
  }

  return {
    tab,
    counterpart: { name: counterpart.name, email: counterpart.email },
    externalParticipants: [...byEmail.values()],
  };
}

/** The name a row shows for an address: the name, or the address itself. */
export function displayName(entry: Address): string {
  return entry.name || entry.email;
}
