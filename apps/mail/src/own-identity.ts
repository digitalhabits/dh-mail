/**
 * Whose mailboxes these are, for a build with no server.
 *
 * A server host reads this from its environment, which is right there: one
 * deployment, one reader. This product ships as a file. A build-time value
 * would be the *builder's* identity, compiled into every copy — hand the app
 * to someone else and it treats your addresses as theirs, strips your mail
 * from their replies, and files your colleagues as their colleagues.
 *
 * So it is stored, next to the mailboxes, and read when the app starts.
 *
 * Connected mailboxes always count and are never stored here: you connected
 * them, so they are yours, and they change on their own. Only the extras go in
 * — aliases that are never connected, and org domains, which stay empty unless
 * the reader genuinely has an organization.
 */

import { mailStore } from "@/lib/mail/store";

const KEY = "mail_own_identity";

export type OwnIdentity = {
  /** Aliases that are never connected. Connected mailboxes are added later. */
  addresses: string[];
  /** Colleague domains. Empty for a personal app. */
  domains: string[];
};

export const EMPTY_OWN_IDENTITY: OwnIdentity = { addresses: [], domains: [] };

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/** Split what someone typed into a list. Commas, spaces, or newlines. */
export function parseIdentityList(text: string): string[] {
  return cleanList(text.split(/[\s,;]+/));
}

export async function getOwnIdentity(): Promise<OwnIdentity> {
  const raw = await mailStore().settings.get(KEY);
  if (!raw) return EMPTY_OWN_IDENTITY;
  try {
    const parsed = JSON.parse(raw) as Partial<OwnIdentity>;
    return {
      addresses: cleanList(parsed.addresses),
      // A domain is a domain, not an address: drop any @ someone pasted in.
      domains: cleanList(parsed.domains).map((d) =>
        d.toLowerCase().replace(/^.*@/, "")
      ),
    };
  } catch {
    // Unreadable settings must not stop the app from opening.
    return EMPTY_OWN_IDENTITY;
  }
}

export async function setOwnIdentity(identity: OwnIdentity): Promise<void> {
  await mailStore().settings.set(
    KEY,
    JSON.stringify({
      addresses: cleanList(identity.addresses),
      domains: cleanList(identity.domains).map((d) =>
        d.toLowerCase().replace(/^.*@/, "")
      ),
    })
  );
}

/**
 * Connected mailboxes plus stored aliases, de-duped case-insensitively.
 * Connected first, so the list reads in the order the reader knows.
 */
export function mergeOwnAddresses(
  connected: readonly string[],
  extra: readonly string[]
): string[] {
  return cleanList([...connected, ...extra]);
}
