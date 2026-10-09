/**
 * The words of an HTML body, as plain text.
 *
 * One function for both providers. Gmail has answered text this way for a
 * long time. Outlook had a copy that put a space where every tag had been,
 * so `<i>Friday</i>.` read as `Friday .`, and it folded every paragraph
 * into one line. The snippet, the quoted reply and the model's context all
 * read this text, so they now read the same text whichever mailbox it came
 * from.
 *
 * Block tags end a line. Inline tags leave nothing behind. Entities are
 * decoded last, so a literal `&lt;b&gt;` in the words stays words.
 */

import { decodeHtmlEntities } from "@/lib/html-entities";

export function htmlToText(html: string): string {
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeHtmlEntities(text).replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * The body's words, from a message that carries a plain part, an HTML
 * part, or both.
 *
 * The plain part normally says the same words with better line breaks, so
 * it wins. But some senders — airlines above all — put a one-line stub in
 * text/plain and every detail in the HTML: the flights, the times, the
 * reference. Read that stub as the body and an itinerary has nothing fixed
 * to a date and a place. When the HTML's words say four times more than
 * the plain part does, the plain part is the stub, not the body.
 */
export function bodyTextFromParts(plain: string, html: string): string {
  const plainText = plain.trim();
  if (!plainText) return htmlToText(html);
  const htmlText = htmlToText(html);
  return plainText.length * 4 >= htmlText.length ? plainText : htmlText;
}
