/**
 * The name on the mail we send.
 *
 * Gmail's API sends the `From` header we write, and we wrote the bare
 * address. Mail from this app therefore arrived headed `you@example.org`
 * while the same person's mail from Gmail's own web page arrived headed with
 * their name — in every client, for every recipient.
 *
 * The name is not ours to invent. Gmail already holds one, per address they
 * can send as, set in their own settings; it is the name their colleagues
 * know them by and the name every other client puts on their mail. We read
 * that and use it. A second name kept only here would silently disagree with
 * the one on their phone, and nobody would think to look here for why.
 *
 * Outlook never had the problem: Graph's `sendMail` fills the sender in from
 * the mailbox itself, so we send it no `From` at all.
 *
 * No React and no DOM here, so a suite can read it.
 */

import { utf8ToBase64 } from "@/lib/base64";

/** One address Gmail will let this account send as. */
export type GmailSendAs = {
  sendAsEmail?: string;
  displayName?: string;
  isPrimary?: boolean;
  isDefault?: boolean;
};

/** Printable ASCII, which is all a header may carry unencoded. */
function isPlainAscii(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code > 0x7e) return false;
  }
  return true;
}

/**
 * Anything that would break the header, taken out.
 *
 * A newline in a display name ends the header and starts whatever the rest of
 * the name says — the oldest trick there is for adding a Bcc to somebody
 * else's mail. The name reaches us from the provider and from our own
 * settings box, and neither is a reason to trust it into a header unread.
 */
export function cleanDisplayName(name: string | undefined): string {
  const printable = [...(name ?? "")]
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f ? " " : ch;
    })
    .join("");
  return printable.replace(/\s+/g, " ").trim();
}

/**
 * `From:`, with the name on it when we have one.
 *
 * Non-ASCII names travel as an encoded word, which a quotation mark would
 * break — a client reading `"=?UTF-8?B?...?="` shows the raw letters instead
 * of the name. ASCII names are quoted, which is safe whatever is in them and
 * is what a comma in "Holm, Vera" needs.
 */
export function formatFromHeader(address: string, name?: string): string {
  const mailbox = cleanDisplayName(address);
  const display = cleanDisplayName(name);
  // A name that is only the address again says nothing twice. Gmail hands
  // one back for addresses whose name was never set.
  if (!display || display.toLowerCase() === mailbox.toLowerCase()) {
    return mailbox;
  }
  if (!isPlainAscii(display)) {
    return `=?UTF-8?B?${utf8ToBase64(display)}?= <${mailbox}>`;
  }
  const quoted = display.replace(/([\\"])/g, "\\$1");
  return `"${quoted}" <${mailbox}>`;
}

/**
 * The name Gmail puts on mail from this address.
 *
 * An account can send as several addresses, each with its own name. We want
 * the one we are sending from; the default is the sensible fallback, since
 * that is the one Gmail itself would use when nothing else matches.
 */
export function pickSendAsName(
  entries: GmailSendAs[] | undefined,
  address: string
): string {
  const list = entries ?? [];
  const wanted = cleanDisplayName(address).toLowerCase();
  const match = list.find(
    (entry) => cleanDisplayName(entry.sendAsEmail).toLowerCase() === wanted
  );
  const fallback = list.find((entry) => entry.isDefault || entry.isPrimary);
  return cleanDisplayName((match ?? fallback)?.displayName);
}

/** How long a name read from the provider is trusted before it is read again. */
export const SENDER_NAME_TTL_MS = 24 * 60 * 60 * 1000;

export function senderNameIsStale(
  fetchedAt: number | undefined,
  now: number
): boolean {
  if (!fetchedAt) return true;
  // A clock that has gone backwards must not freeze the name forever.
  return now - fetchedAt >= SENDER_NAME_TTL_MS || fetchedAt > now;
}
