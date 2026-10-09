/**
 * Whether the composer should open with the draft the provider is holding.
 *
 * Its own function because the timing is the whole difficulty. A thread can
 * paint instantly from the memory cache while the answer about our own draft
 * is still coming back from IndexedDB, so "no local draft" and "have not
 * looked yet" are different answers and must not be confused. The first
 * version of this used a ref, which cannot wake an effect, and the draft
 * silently never appeared.
 */

import { plainTextToEditorHtml } from "@/lib/client-email-html";
import { decodeHtmlEntities } from "@/lib/html-entities";
import { formatEmailBody, stripQuotedReplies } from "@/lib/email-mime";

/**
 * The reader's own words from a draft, ready for the composer.
 *
 * Two things have to happen to a draft body before it can go in the box.
 *
 * The quoted thread comes off. Our composer quotes the message it is replying
 * to when it sends, so a draft imported whole would carry the conversation
 * twice — and a Gmail draft carries the whole chain.
 *
 * Plain text becomes HTML. The box is a rich text editor, so text put in raw
 * loses every line break and shows its `>` quote markers as characters. That
 * is what the first version did, and it turned a short reply into one long
 * run-on paragraph.
 */
/**
 * A draft's HTML as plain text, with its line breaks intact.
 *
 * Not `htmlToPlainText`. That one turns `<br>` into a newline only inside a
 * `<p>`, and takes `textContent` for anything else — which drops every break.
 * A Gmail draft is a single `<div>` full of `<br>`, so it arrived as one long
 * line, and every quote marker is anchored to a newline. Nothing matched, and
 * the reader's paragraphs were gone before anything else ran.
 *
 * Entities are decoded too, or a quoted line stays `&gt;` and the `>` markers
 * never match either.
 *
 * String-based rather than DOM-based, so it can be checked without a browser.
 */
export function draftHtmlToText(html: string): string {
  if (!html) return "";
  const withBreaks = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeHtmlEntities(withBreaks)
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The body to put in the composer: the reader's own words, as editor HTML. */
export function draftBodyForComposer(draft: {
  bodyText?: string;
  bodyHtml?: string;
}): string {
  const text = draft.bodyText?.trim()
    ? draft.bodyText
    : draftHtmlToText(draft.bodyHtml ?? "");
  return draftPlainTextForComposer(text);
}

export function draftPlainTextForComposer(bodyText: string): string {
  const formatted = formatEmailBody(bodyText ?? "");
  const byLine = stripQuotedReplies(formatted).trim();
  const stripped = stripInlineQuotedReply(byLine).trim();
  // A draft that is only a quote keeps its text rather than emptying the box.
  return plainTextToEditorHtml(stripped || byLine || formatted.trim());
}

/**
 * Cut a quoted chain out of a body that has lost its line breaks.
 *
 * Every marker in `stripQuotedReplies` is anchored to a newline, which is the
 * right way to read a plain-text mail. A draft does not always arrive that
 * way: this one came through as one long line, so nothing matched and the
 * whole conversation went into the composer as a single paragraph.
 *
 * Only patterns that cannot plausibly appear in a sentence someone wrote.
 */
export function stripInlineQuotedReply(text: string): string {
  if (!text) return "";
  const markers: RegExp[] = [
    // "On <date>, <name> wrote:" running straight into a quote marker.
    /\bOn\b[\s\S]{0,240}?\bwrote:\s*>/i,
    // The long rule Outlook draws above a quoted header block.
    /_{10,}/,
    // "> From: …" — a quoted header block with the marker still attached.
    />\s*From:\s/i,
  ];
  let cut = -1;
  for (const marker of markers) {
    const match = text.match(marker);
    if (match?.index !== undefined && (cut === -1 || match.index < cut)) {
      cut = match.index;
    }
  }
  if (cut === -1) return text;
  const head = text.slice(0, cut).trim();
  return head || text;
}

export type ImportDraftQuestion = {
  /** True when the thread carries a draft from Gmail or Outlook. */
  hasProviderDraft: boolean;
  /**
   * Null while the local draft is still being looked for, then whether one
   * was found. Deciding before the answer is in would race the reader's own
   * draft, which is saved on a keystroke.
   */
  localDraftFound: boolean | null;
  /**
   * When each was last written, in milliseconds.
   *
   * A draft of ours used to outrank the provider's outright, on the grounds
   * that it is what the reader was typing here. That is true right up until
   * they go and edit the same reply in Gmail — and then the box here opens on
   * words that were replaced somewhere else, with nothing to say so. The
   * later of the two wins now, whichever side wrote it.
   */
  localDraftAt: number | null;
  providerDraftAt: number | null;
  /** The thread whose provider draft has already been offered, if any. */
  importedForThread: string | null;
  threadId: string;
  /** True when a composer is already open, whatever put it there. */
  composerOpen: boolean;
};

export function shouldImportProviderDraft(q: ImportDraftQuestion): boolean {
  if (!q.hasProviderDraft) return false;
  // Still waiting. Deciding now would race the reader's own draft.
  if (q.localDraftFound === null) return false;
  // Once per thread, or closing the composer would reopen it immediately.
  if (q.importedForThread === q.threadId) return false;
  if (q.composerOpen) return false;
  if (!q.localDraftFound) return true;
  // Both exist. Without a time on each there is nothing to choose between
  // them, and ours is the safer keep — it is the one that was typed here.
  if (q.localDraftAt == null || q.providerDraftAt == null) return false;
  return q.providerDraftAt > q.localDraftAt;
}
