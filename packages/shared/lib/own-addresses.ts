/**
 * Whose mailboxes these are. Two distinct notions:
 *
 * - **Own personal address**: one of the reader's own mailboxes. These are the
 *   addresses stripped from reply and reply-all recipients, and the ones
 *   labelled "You".
 * - **Own org address**: the reader, or a colleague on the same domains. Used
 *   to keep colleagues out of contact indexes and to spot outbound mail.
 *   A shared mailbox on an org domain (`team@`) is org but not personal:
 *   replies must still reach the colleagues who read it.
 *
 * **This is configuration, not a constant.** It was a hardcoded list of one
 * person's addresses until August 2026, which meant the product only behaved
 * correctly for him: everyone else's replies quoted themselves and nobody was
 * ever labelled "You".
 *
 * Personal addresses default to the mailboxes that are connected — you
 * connected them, so they are yours — and a host can add more for aliases that
 * are never connected.
 *
 * Org domains default to **nothing**, and that default matters. Deriving them
 * from the connected mailboxes would make `gmail.com` an org domain for most
 * people, and every Gmail user in the world a colleague. Only a host that
 * genuinely has an organization sets them.
 */

/**
 * Lowercase, drop any `+tag`, and ignore dots in Gmail local parts, so the
 * same mailbox written differently still matches.
 */
export function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at < 0) return normalized;
  let local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replaceAll(".", "");
  }
  return `${local}@${domain}`;
}

function parseList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Read once at import, so code running on a server knows who it is without
 * anyone remembering to call anything. A serverless instance starts cold and
 * answers one request; there is no startup for it to hook into.
 *
 * The browser gets the same answer through `setOwnMailIdentity`, which the
 * mail interface calls with the mailboxes it was given.
 */
let ownPersonal = new Set(
  parseList(process.env.MAIL_OWN_PERSONAL_ADDRESSES).map(normalizeEmail)
);
let ownDomains = new Set(
  parseList(process.env.MAIL_OWN_ORG_DOMAINS).map((d) => d.toLowerCase())
);

/**
 * Tell mail whose mailboxes it is looking at.
 *
 * Called with every connected mailbox, plus anything the host knows about that
 * is not connected. Replaces what was there rather than adding to it, so a
 * disconnected mailbox stops counting as yours.
 */
export function setOwnMailIdentity(input: {
  addresses?: readonly string[];
  domains?: readonly string[];
}): void {
  if (input.addresses) {
    ownPersonal = new Set(input.addresses.filter(Boolean).map(normalizeEmail));
  }
  if (input.domains) {
    ownDomains = new Set(
      input.domains.filter(Boolean).map((d) => d.trim().toLowerCase())
    );
  }
}

/** What mail currently believes about who it belongs to. For settings UI. */
export function ownMailIdentity(): { addresses: string[]; domains: string[] } {
  return {
    addresses: [...ownPersonal].sort(),
    domains: [...ownDomains].sort(),
  };
}

/** One of the reader's own mailboxes. */
export function isOwnPersonalAddress(email: string): boolean {
  return ownPersonal.has(normalizeEmail(email));
}

/** The reader or a colleague: any address on an org domain, plus their own. */
export function isOwnOrgAddress(email: string): boolean {
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf("@");
  if (at < 0) return false;
  if (ownDomains.has(normalized.slice(at + 1))) return true;
  return ownPersonal.has(normalized);
}
