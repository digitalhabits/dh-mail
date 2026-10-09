/**
 * The right-click menu on a link in a message.
 *
 * The frame turns every `<a href>` into a span (see `softenAnchorsForParse`),
 * so the browser sees text where the reader sees a link, and offers Look Up
 * and Translate where they wanted Copy Link. This is the menu the frame shows
 * instead. It is small on purpose: the destination, so a reader can see where
 * a link really goes before following it; a way to open it; a way to copy it.
 * The system's Share and Services are left out — they were never about the
 * link.
 *
 * No React here: this is the part a suite reads.
 */

export type MailLinkMenuModel = {
  /** What the menu is about. */
  kind: "http" | "mailto";
  /** The full destination, for the tooltip and the clipboard. */
  target: string;
  /** The destination shortened for one row of a menu. */
  shown: string;
  /** "Open link" or "Write to this address". */
  openLabel: string;
  /** "Copy link" or "Copy address". */
  copyLabel: string;
  /** What is put on the clipboard: the URL, or the bare address. */
  copyText: string;
};

/** Longer than this and the row stops being readable at a glance. */
const SHOWN_MAX = 60;

/**
 * The URL a reader can take in at a glance: host and path, no scheme, no
 * trailing slash on a bare host, cut in the middle if long — the host is the
 * part that says whether to trust it, and the end of a path is often the part
 * that says which page, so both are kept.
 */
export function shortenLinkForMenu(url: string, max = SHOWN_MAX): string {
  let text = url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      const host = parsed.host.replace(/^www\./, "");
      const rest = `${parsed.pathname}${parsed.search}${parsed.hash}`;
      text = host + (rest === "/" ? "" : rest);
    }
  } catch {
    /* not a URL the platform can parse; show it as it is */
  }
  try {
    text = decodeURI(text);
  } catch {
    /* malformed escapes stay escaped */
  }
  if (text.length <= max) return text;
  const head = Math.ceil((max - 1) * 0.6);
  const tail = max - 1 - head;
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

/** The menu for a link, or null when the target is not one we would follow. */
export function mailLinkMenuModel(target: string): MailLinkMenuModel | null {
  if (/^mailto:/i.test(target)) {
    // A mailto can carry ?subject=… and more. Only the address is shown and
    // copied, the same as following it opens a message to that address.
    let address = target.slice("mailto:".length).split("?")[0];
    try {
      address = decodeURIComponent(address);
    } catch {
      /* keep as written */
    }
    if (!address) return null;
    return {
      kind: "mailto",
      target,
      shown: shortenLinkForMenu(address),
      openLabel: "Write to this address",
      copyLabel: "Copy address",
      copyText: address,
    };
  }
  if (!/^https?:/i.test(target)) return null;
  return {
    kind: "http",
    target,
    shown: shortenLinkForMenu(target),
    openLabel: "Open link",
    copyLabel: "Copy link",
    copyText: target,
  };
}
