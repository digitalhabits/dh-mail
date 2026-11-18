/**
 * The message under a forward, Gmail-style, as text and as HTML.
 *
 * Here and not in the send, so that the hand-over to Outlook writes the
 * same forward as a send does. No server code, so the page can use it.
 */

import { escapeHtml } from "@/lib/mail/signature-html";

/** Original message quoted below a forward, Gmail-style. */
export type ForwardedMessage = {
  fromName: string;
  fromEmail: string;
  /** Display date of the original message. */
  date: string;
  subject: string;
  to: string[];
  text: string;
  /** Sanitized HTML of the original, so rich mail forwards with its layout. */
  html?: string;
  /** The original's own Message-ID, when the store has it: see `forwardLinkHeaders`. */
  rfcMessageId?: string;
  /** The original's References, when the store has them. */
  references?: string;
};

/**
 * The header lines that say which mail a forward was made from: In-Reply-To
 * with the original's id, and References with the original's own list and
 * then its id, as Outlook writes them.
 *
 * Only an Exchange send uses them (inbox-send.ts). An Exchange server that
 * gets a forward with no such lines files it by its subject, with the newest
 * conversation of that subject. So when the same mail went to three
 * organisations, a forward of the first showed in the conversation with the
 * third (reported 2026-11-18). With the lines, the server files the forward
 * with the mail that was forwarded.
 */
export function forwardLinkHeaders(forward: ForwardedMessage): { inReplyTo: string; references: string } | null {
  const id = (forward.rfcMessageId ?? "").trim();
  // An id is one token in angle brackets. Something else is not put in a header.
  if (!/^<[^<>\s]+>$/.test(id)) return null;
  const earlier = ((forward.references ?? "").match(/<[^<>\s]+>/g) ?? []).filter((ref) => ref !== id);
  return { inReplyTo: id, references: [...earlier, id].join(" ") };
}

export function forwardedPlainText(forward: ForwardedMessage): string {
  const from = forward.fromName
    ? `${forward.fromName} <${forward.fromEmail}>`
    : forward.fromEmail;
  return [
    "---------- Forwarded message ----------",
    `From: ${from}`,
    `Date: ${forward.date}`,
    `Subject: ${forward.subject}`,
    `To: ${forward.to.join(", ")}`,
    "",
    forward.text,
  ].join("\n");
}

export function forwardedHtml(forward: ForwardedMessage): string {
  const from = forward.fromName
    ? `${escapeHtml(forward.fromName)} &lt;${escapeHtml(forward.fromEmail)}&gt;`
    : escapeHtml(forward.fromEmail);
  const rows = [
    `From: ${from}`,
    `Date: ${escapeHtml(forward.date)}`,
    `Subject: ${escapeHtml(forward.subject)}`,
    `To: ${escapeHtml(forward.to.join(", "))}`,
  ].join("<br>");
  const original =
    forward.html ||
    `<pre style="white-space:pre-wrap;font-family:Helvetica,Arial,sans-serif;font-size:12pt;margin:0">${escapeHtml(forward.text)}</pre>`;
  return [
    // No rule above it: the header says where the forward starts, as
    // Gmail's does, and a grey line over it read as a stray border.
    '<div style="margin-top:24px">',
    `<div style="font-size:13px;color:#555;line-height:1.5"><b>---------- Forwarded message ----------</b><br>${rows}</div>`,
    `<div style="margin-top:12px">${original}</div>`,
    "</div>",
  ].join("");
}
