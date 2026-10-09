import { isOwnPersonalAddress, normalizeEmail } from "@/lib/own-addresses";

/**
 * Photographs shown instead of hashed initials, for people the host knows.
 *
 * A registry rather than a list, for the same reason the addresses are: this
 * held one team's photographs until August 2026, so a build for anyone else
 * carried two strangers' faces and used neither.
 *
 * Empty unless a host fills it. The mail interface then falls back to initials,
 * which is what it does for everyone else anyway.
 */

let byAddress = new Map<string, string>();
let ownAvatar: string | undefined;

/**
 * Tell mail whose face to show.
 *
 * `own` is used for every one of the reader's own mailboxes, so a person with
 * five addresses supplies one photograph rather than five entries.
 */
export function setMailAvatars(input: {
  byAddress?: Record<string, string>;
  own?: string;
}): void {
  if (input.byAddress) {
    byAddress = new Map(
      Object.entries(input.byAddress).map(([email, src]) => [
        normalizeEmail(email),
        src,
      ])
    );
  }
  if ("own" in input) ownAvatar = input.own;
}

/** Photo for a sender email, or undefined to fall back to initials/logo. */
export function teamAvatarSrc(email: string): string | undefined {
  if (!email) return undefined;
  if (ownAvatar && isOwnPersonalAddress(email)) return ownAvatar;
  return byAddress.get(normalizeEmail(email));
}
