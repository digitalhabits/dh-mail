/**
 * Who an address belongs to, as the address books say.
 *
 * A person is a contact card; otherwise a person is an address. The books
 * the reader keeps — Mac Contacts, and the Google or Outlook contacts of
 * the connected mailboxes — are mirrored into the store with each row
 * carrying its card's id. Two addresses on one card are one person, and a
 * card in one book that shares an address with a card in another joins it:
 * merging is a union, so no book outranks another and nothing is arbitrated.
 * An address on no card stands for itself, which is what the People view
 * did for every address before.
 *
 * Built from the rows in memory each time; nothing is stored. No React and
 * no network in here, so a test can read it.
 */

import type { MailSourceContact } from "@/lib/mail/store/types";

/** The person an address belongs to: a stable key, never empty. */
export type PersonIdentity = (email: string) => string;

/** Books whose cards say who somebody is. Send history is not one. */
const ADDRESS_BOOKS = new Set(["mac", "google", "outlook"]);

/** An address for itself, the key every address had before the books. */
export function addressIdentity(email: string): string {
  return `person:${email.trim().toLowerCase()}`;
}

/**
 * A machine's address, less the token it stamps on each mail.
 *
 * One sender writes from no-reply-Qd83kTz0aLpW7mNc2RbV1x@mail.example.com,
 * a fresh token every time; Stripe, Slack, and many notification systems
 * do the same. Read as they are, six such mails are six senders, and the
 * People view — the view meant to fold a sender's mail — scatters them.
 * A local part that is a generic mailer word, a dash or plus, and a token
 * of ten or more mixed letters and digits is read as the word alone at
 * that domain. A person's address never looks like that, so nothing real
 * merges; the true address still shows when a thread is opened.
 */
const MAILER_WORDS = new Set([
  "no-reply", "noreply", "do-not-reply", "donotreply", "notification", "notifications",
  "notify", "alert", "alerts", "mailer", "mail", "bounce", "bounces", "system", "updates",
]);
const MAILER_TOKEN_RE = /^[A-Za-z0-9_-]{10,}$/;

export function mailerIdentityAddress(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return trimmed;
  const local = trimmed.slice(0, at);
  for (const word of MAILER_WORDS) {
    if (!local.startsWith(word) || local.length <= word.length + 1) continue;
    const sep = local[word.length];
    if (sep !== "-" && sep !== "+") continue;
    const token = local.slice(word.length + 1);
    // A token has both letters and digits; "no-reply-billing" is a name.
    if (!MAILER_TOKEN_RE.test(token) || !/[0-9]/.test(token) || !/[a-z]/.test(token)) continue;
    return `${word}${trimmed.slice(at)}`;
  }
  return trimmed;
}

/** Union-find over card nodes, addresses joining the cards they sit on. */
class Groups {
  private parent = new Map<string, string>();
  find(node: string): string {
    let root = node;
    while (this.parent.has(root) && this.parent.get(root) !== root) {
      root = this.parent.get(root) as string;
    }
    // Path compression, so a long chain is walked once.
    let cursor = node;
    while (this.parent.has(cursor) && this.parent.get(cursor) !== root) {
      const next = this.parent.get(cursor) as string;
      this.parent.set(cursor, root);
      cursor = next;
    }
    return root;
  }
  add(node: string): void {
    if (!this.parent.has(node)) this.parent.set(node, node);
  }
  union(a: string, b: string): void {
    this.add(a);
    this.add(b);
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }
}

export function buildPersonIdentity(
  contacts: readonly Pick<MailSourceContact, "source" | "account" | "email" | "card">[]
): PersonIdentity {
  const groups = new Groups();
  const cardOfEmail = new Map<string, string>();
  for (const row of contacts) {
    if (!ADDRESS_BOOKS.has(row.source)) continue;
    const card = row.card?.trim();
    const email = row.email.trim().toLowerCase();
    if (!card || !email) continue;
    const node = `card:${row.source}:${row.account.toLowerCase()}:${card}`;
    groups.add(node);
    const seen = cardOfEmail.get(email);
    if (seen) {
      // The same address on two cards: the cards are one person.
      groups.union(seen, node);
    } else {
      cardOfEmail.set(email, node);
    }
  }
  return (email: string) => {
    const key = email.trim().toLowerCase();
    const node = cardOfEmail.get(key);
    return node ? `person:${groups.find(node)}` : addressIdentity(key);
  };
}
