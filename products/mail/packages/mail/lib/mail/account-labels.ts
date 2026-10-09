/** Shortest unique chip labels for connected mail accounts. */

export type AccountChipLabel = {
  /** Local part of the address (as written). */
  primary: string;
  /** Provider or domain, only when another account shares the local part. */
  suffix: string | null;
};

function localPart(email: string): string {
  return email.split("@")[0] ?? email;
}

function domainOf(email: string): string {
  return (email.split("@")[1] ?? "").toLowerCase();
}

/** Consumer-provider shorthand; null for custom / unknown domains. */
export function knownMailProvider(domain: string): string | null {
  const d = domain.toLowerCase();
  if (d === "gmail.com" || d === "googlemail.com") return "gmail";
  if (
    d === "outlook.com" ||
    d === "hotmail.com" ||
    d === "live.com" ||
    d === "msn.com"
  ) {
    return "outlook";
  }
  if (d === "yahoo.com" || d === "ymail.com") return "yahoo";
  if (d === "icloud.com" || d === "me.com" || d === "mac.com") return "icloud";
  return null;
}

/**
 * Prefer a short provider name when it uniquely identifies the account among
 * peers that share a local part; otherwise fall back to the full domain.
 */
function preferredSuffix(email: string): string {
  const domain = domainOf(email);
  return knownMailProvider(domain) ?? domain;
}

/**
 * Build chip labels for a set of accounts. Unique local parts stay bare;
 * collisions grow a muted `· gmail` / `· outlook` (or full domain) suffix.
 */
export function accountChipLabels(
  emails: readonly string[]
): Map<string, AccountChipLabel> {
  const byLocal = new Map<string, string[]>();
  for (const email of emails) {
    const key = localPart(email).toLowerCase();
    const list = byLocal.get(key);
    if (list) list.push(email);
    else byLocal.set(key, [email]);
  }

  const out = new Map<string, AccountChipLabel>();
  for (const email of emails) {
    const primary = localPart(email);
    const peers = byLocal.get(primary.toLowerCase()) ?? [email];
    if (peers.length === 1) {
      out.set(email, { primary, suffix: null });
      continue;
    }

    const preferred = peers.map((e) => preferredSuffix(e));
    const preferredUnique = new Set(preferred).size === preferred.length;
    out.set(email, {
      primary,
      suffix: preferredUnique ? preferredSuffix(email) : domainOf(email),
    });
  }
  return out;
}

/** Plain-text form for banners and toasts: `name · gmail`. */
export function formatAccountChipLabel(
  email: string,
  labels: Map<string, AccountChipLabel>
): string {
  const label = labels.get(email);
  if (!label) return localPart(email);
  return label.suffix ? `${label.primary} · ${label.suffix}` : label.primary;
}
