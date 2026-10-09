/** Bare URLs, or plain-text-email style `<https://…>` wrapped ones. */
const URL_REGEX = /<(https?:\/\/[^\s>]+)>|(https?:\/\/[^\s<>]+)/g;

/**
 * Bare addresses, or the `<name@host>` form mail clients write around them.
 *
 * The angle form is what a sender's own client produces next to a display
 * name — "Dana Fisher <dana@example.ac.uk>" — and it is the reason the plain
 * pattern alone is not enough: the closing bracket has to stay outside the
 * match, or it becomes part of the address.
 */
const EMAIL_REGEX =
  /<([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})>|(?:mailto:)?([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

export type UrlMatch = { start: number; end: number; url: string };

/** A link found in plain text: a web address, or an email address. */
export type LinkMatch = {
  start: number;
  end: number;
  /** The URL to open — `https://…` for a web link, `mailto:…` for an address. */
  href: string;
  kind: "url" | "email";
  /** For an address, the address itself, without `mailto:`. */
  address?: string;
};

/** Find http(s) URLs in text; trailing punctuation is left outside bare matches. */
export function findUrlsInText(text: string): UrlMatch[] {
  const matches: UrlMatch[] = [];
  for (const match of text.matchAll(URL_REGEX)) {
    const index = match.index ?? 0;
    let url = match[1] ?? match[2] ?? "";
    let end = index + match[0].length;
    if (!match[1]) {
      const trimmed = url.replace(/[.,;:)\]]+$/, "");
      end -= url.length - trimmed.length;
      url = trimmed;
    }
    if (!url) continue;
    matches.push({ start: index, end, url });
  }
  return matches;
}

/** Find email addresses in text. */
export function findEmailsInText(text: string): LinkMatch[] {
  const matches: LinkMatch[] = [];
  for (const match of text.matchAll(EMAIL_REGEX)) {
    const index = match.index ?? 0;
    const address = match[1] ?? match[2] ?? "";
    if (!address) continue;
    // The whole match includes `<`, `>`, and any `mailto:` prefix. Keep those
    // in the range so they are consumed, but never inside the link text.
    const offset = match[0].indexOf(address);
    matches.push({
      start: index + offset,
      end: index + offset + address.length,
      href: `mailto:${address}`,
      kind: "email",
      address,
    });
  }
  return matches;
}

/**
 * Every link in a piece of plain text, in order, without overlaps.
 *
 * Web addresses win where the two collide. A path can hold something shaped
 * like an address — `https://example.org/a@b.com` — and splitting the URL to
 * linkify its tail would break the link that is actually there.
 */
export function findLinksInText(text: string): LinkMatch[] {
  const urls: LinkMatch[] = findUrlsInText(text).map((match) => ({
    start: match.start,
    end: match.end,
    href: match.url,
    kind: "url" as const,
  }));
  const emails = findEmailsInText(text).filter(
    (email) => !urls.some((url) => email.start < url.end && url.start < email.end)
  );
  return [...urls, ...emails].sort((a, b) => a.start - b.start);
}
