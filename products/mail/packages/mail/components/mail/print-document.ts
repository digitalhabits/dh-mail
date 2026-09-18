/**
 * The document that a print produces: subject, then a header and a body per
 * message.
 *
 * It is only a string builder, and it takes the sanitizer as an argument
 * rather than importing it. That keeps this module free of React, so a suite
 * can read what it produces without a renderer — and it says plainly that
 * sanitizing is the caller's promise, not something this file decides.
 *
 * What gets printed is what is on screen. Remote images print only when the
 * reader already loaded them, and the body is the one the bubble shows — a
 * message read without its quoted history prints without it.
 */

import {
  MAIL_IMAGE_CSP_SOURCE,
  rewriteRemoteImagesThroughProxy,
} from "@/lib/mail/image-proxy";

/** Turns a sender's HTML into HTML that is safe to put in the document. */
export type SanitizeHtml = (
  html: string,
  inlineImages?: Record<string, string>
) => string;

export type PrintableMessage = {
  id: string;
  fromName: string;
  fromEmail: string;
  toEmails?: string[];
  ccEmails?: string[];
  sentAt: string | null;
  bodyText: string;
  bodyHtml?: string;
  inlineImages?: Record<string, string>;
  /**
   * Whether this message shows remote images on screen. It is per message,
   * because the choice is per sender: a thread can hold one sender the reader
   * loaded images for and another they did not.
   */
  allowRemoteImages: boolean;
};

export type PrintMailInput = {
  /** Thread subject. Prints as the title above the first message. */
  subject: string;
  messages: PrintableMessage[];
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A printed record keeps the year. The on-screen stamp drops it. */
function printStamp(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function senderLine(message: PrintableMessage): string {
  const name = message.fromName?.trim();
  const email = message.fromEmail?.trim();
  if (name && email) return `${name} <${email}>`;
  return name || email || "";
}

function headerHtml(message: PrintableMessage): string {
  const rows: [string, string][] = [
    ["From", senderLine(message)],
    ["To", (message.toEmails ?? []).join(", ")],
    ["Cc", (message.ccEmails ?? []).join(", ")],
    ["Date", printStamp(message.sentAt)],
  ];
  return rows
    .filter(([, value]) => value)
    .map(
      ([label, value]) =>
        `<p><span class="k">${label}</span>${escapeHtml(value)}</p>`
    )
    .join("");
}

function bodyHtml(
  message: PrintableMessage,
  origin: string,
  sanitize: SanitizeHtml
): string {
  if (message.bodyHtml) {
    const sanitized = sanitize(message.bodyHtml, message.inlineImages);
    // Only a rewritten image is same-origin. A message printed without images
    // keeps the sender's URLs, which the CSP below then refuses.
    return message.allowRemoteImages
      ? rewriteRemoteImagesThroughProxy(sanitized, origin)
      : sanitized;
  }
  return `<pre class="text">${escapeHtml(message.bodyText ?? "")}</pre>`;
}

export function buildPrintDocument(
  input: PrintMailInput,
  origin: string,
  sanitize: SanitizeHtml
): string {
  // No script-src: nothing in this document is allowed to run.
  const anyImages = input.messages.some((m) => m.allowRemoteImages);
  const imgSrc = anyImages
    ? `img-src ${MAIL_IMAGE_CSP_SOURCE} data:;`
    : "img-src data:;";
  const csp = `default-src 'none'; ${imgSrc} style-src 'unsafe-inline'`;
  const title = input.subject?.trim() || "(no subject)";

  const messages = input.messages
    .map(
      (message) =>
        `<article class="msg"><header class="head">${headerHtml(
          message
        )}</header><div class="body">${bodyHtml(
          message,
          origin,
          sanitize
        )}</div></article>`
    )
    .join("");

  return [
    "<!doctype html><html><head>",
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    '<meta name="referrer" content="no-referrer">',
    `<title>${escapeHtml(title)}</title>`,
    "<style>",
    "@page{margin:16mm}",
    "html,body{margin:0;background:#fff}",
    // `overflow-wrap`, not `word-break:break-word` — the same reason the
    // reader gives: the deprecated spelling lets a table column be squeezed
    // to one letter, and a printed table is a table too.
    "body{font:11pt/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#000;overflow-wrap:break-word}",
    "h1{margin:0 0 14pt;font-size:15pt;line-height:1.3}",
    // A header must not be the last thing on a page, with its body overleaf.
    ".msg{margin-top:14pt;padding-top:12pt;border-top:0.5pt solid #999}",
    ".msg:first-of-type{margin-top:0;padding-top:0;border-top:0}",
    ".head{margin:0 0 10pt;font-size:9pt;color:#333;break-inside:avoid;break-after:avoid}",
    ".head p{margin:0}",
    ".head .k{display:inline-block;min-width:38pt;color:#666}",
    ".body img{max-width:100%;height:auto}",
    ".body .text{white-space:pre-wrap;font:inherit;margin:0}",
    "</style>",
    "</head><body>",
    `<h1>${escapeHtml(title)}</h1>`,
    messages,
    "</body></html>",
  ].join("");
}
