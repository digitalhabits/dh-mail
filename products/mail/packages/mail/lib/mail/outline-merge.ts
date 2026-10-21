/**
 * The whole thread as its outline draws it (components/mail/thread-outline):
 * the outline's light list of every message, with the loaded copy of each
 * message in its place. No React, so a test can read it.
 */

import type { MailMessage, MailOutlineItem } from "@/lib/mail/types";

/**
 * What the person wrote, without what they were answering.
 *
 * A reply made in Mail starts with a card quoting the message it answers:
 * `> Name: “the quote”`, then the new words; a provider's preview has the
 * same with the line breaks taken out. Mail and the rest put the history
 * after "On 14 Aug … wrote:". The outline shows the new words, so it takes
 * the card off the front and the history off the end. Where nothing is
 * left (a preview cut off inside the quote) it keeps what it was given.
 */
export function ownWords(text: string): string {
  let t = text.trim();
  const card = t.match(/^(?:>\s*)?(?:[^“\n]{0,80}:\s*)?“[^”]*”\s*/);
  if (card) t = t.slice(card[0].length);
  t = t.split(/\s(?:On|Den|Le|Am|El) [^\n]{4,160}?(?:wrote|skrev|a écrit|schrieb|escribió):/)[0];
  return t.trim() || text.trim();
}

/** The first line a person wrote: no blank lines, no quoted ones. */
function firstLine(text: string): string {
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line && !line.startsWith(">")) return line;
  }
  return "";
}

/** One message as the rail and the list draw it, loaded or not. */
export type OutlineEntry = {
  id: string;
  sentAt: string | null;
  own: boolean;
  unread: boolean;
  name: string;
  firstLine: string;
  hasAttachments: boolean;
  /** In the reader now; false for one only the outline has read. */
  loaded: boolean;
};

function loadedEntry(m: MailMessage): OutlineEntry {
  return {
    id: m.id,
    sentAt: m.sentAt,
    own: m.own,
    unread: Boolean(m.unread),
    name: m.fromName || m.fromEmail,
    firstLine: firstLine(ownWords(m.bodyText)),
    hasAttachments: Boolean(m.attachments?.length),
    loaded: true,
  };
}

const at = (iso: string | null) => (iso ? Date.parse(iso) || 0 : 0);

/**
 * The whole thread: the outline's list, with the loaded copy of each
 * message in place of its outline row (matched by id, or by Message-ID for
 * a provider's second copy), and anything loaded the list did not have.
 */
export function mergeOutline(loaded: MailMessage[], items: MailOutlineItem[] | null): OutlineEntry[] {
  if (!items?.length) return loaded.map(loadedEntry);
  const byId = new Map(loaded.map((m) => [m.id, m]));
  const byRfc = new Map(
    loaded.filter((m) => m.rfcMessageId).map((m) => [m.rfcMessageId!.trim(), m])
  );
  const used = new Set<string>();
  const merged = items.map((item): OutlineEntry => {
    const match = byId.get(item.id) ?? (item.rfcMessageId ? byRfc.get(item.rfcMessageId.trim()) : undefined);
    if (match && !used.has(match.id)) {
      used.add(match.id);
      return loadedEntry(match);
    }
    return {
      id: item.id,
      sentAt: item.sentAt,
      own: item.own,
      unread: Boolean(item.unread),
      name: item.fromName || item.fromEmail,
      firstLine: ownWords(item.firstLine),
      hasAttachments: Boolean(item.hasAttachments),
      loaded: false,
    };
  });
  const rest = loaded.filter((m) => !used.has(m.id)).map(loadedEntry);
  // Stable: equal times keep the order they came in.
  return [...merged, ...rest]
    .map((entry, i) => ({ entry, i }))
    .sort((a, b) => at(a.entry.sentAt) - at(b.entry.sentAt) || a.i - b.i)
    .map(({ entry }) => entry);
}
