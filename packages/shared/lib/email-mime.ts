/**
 * Decode MIME header encoded-words (RFC 2047) and recover plain text from
 * Outlook mbox blobs that were stored as raw multipart.
 * Isomorphic (Node + browser) so the CRM drawer can scrub already-imported rows.
 */

import { base64ToBytes } from "@/lib/base64";

function decodeBase64Bytes(input: string): Uint8Array {
  return base64ToBytes(input);
}

function bytesToString(bytes: Uint8Array, charset: string): string {
  const cs = charset.trim().toLowerCase();
  const label =
    cs === "utf8" || cs === "utf-8"
      ? "utf-8"
      : cs === "iso-8859-1" || cs === "latin1" || cs === "windows-1252"
        ? "windows-1252"
        : charset;
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** Decode a single RFC 2047 encoded-word payload to a JS string. */
function decodeRfc2047Payload(charset: string, encoding: string, data: string): string {
  let bytes: Uint8Array;
  if (encoding.toUpperCase() === "B") {
    bytes = decodeBase64Bytes(data);
  } else {
    const soft = data.replace(/_/g, " ");
    const out: number[] = [];
    for (let i = 0; i < soft.length; i++) {
      if (soft[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(soft.slice(i + 1, i + 3))) {
        out.push(Number.parseInt(soft.slice(i + 1, i + 3), 16));
        i += 2;
      } else {
        out.push(soft.charCodeAt(i) & 0xff);
      }
    }
    bytes = new Uint8Array(out);
  }
  return bytesToString(bytes, charset);
}

const ENCODED_WORD_RE = /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g;

/**
 * Decode RFC 2047 encoded-words in email headers (Subject, From, etc.).
 * Leaves already-plain text unchanged.
 */
export function decodeRfc2047(value: string): string {
  if (!value || !value.includes("=?")) return value;
  // Whitespace between adjacent encoded-words is not significant.
  const collapsed = value.replace(/(\?=)\s+(=\?)/g, "$1$2");
  return collapsed
    .replace(ENCODED_WORD_RE, (_m, charset: string, encoding: string, data: string) =>
      decodeRfc2047Payload(charset, encoding, data)
    )
    .replace(/\s+/g, " ")
    .trim();
}

function decodeQuotedPrintable(input: string): string {
  const soft = input.replace(/=\r?\n/g, "");
  const out: number[] = [];
  for (let i = 0; i < soft.length; i++) {
    if (soft[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(soft.slice(i + 1, i + 3))) {
      out.push(Number.parseInt(soft.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      out.push(soft.charCodeAt(i) & 0xff);
    }
  }
  return bytesToString(new Uint8Array(out), "utf-8");
}

function decodeBase64(input: string): string {
  return bytesToString(decodeBase64Bytes(input), "utf-8");
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function headerValue(partHeaders: string, name: string): string {
  const re = new RegExp(`^${name}:\\s*(.*(?:\\n[ \\t].*)*)$`, "im");
  const match = partHeaders.match(re);
  if (!match) return "";
  return match[1].replace(/\n[ \\t]+/g, " ").trim();
}

function decodeBody(raw: string, transferEncoding: string, charsetHint: string): string {
  const encoding = transferEncoding.toLowerCase();
  let text: string;
  if (encoding.includes("quoted-printable")) {
    text = decodeQuotedPrintable(raw);
  } else if (encoding.includes("base64")) {
    text = decodeBase64(raw);
  } else {
    text = raw;
  }
  const charsetMatch = charsetHint.match(/charset="?([^";\s]+)"?/i);
  if (charsetMatch && !encoding.includes("quoted-printable") && !encoding.includes("base64")) {
    // 8-bit body with an explicit charset — reinterpret when possible.
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
    return bytesToString(bytes, charsetMatch[1]);
  }
  return text;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Split a MIME part into headers + body. Outlook often omits the blank line
 * between headers and body, so fall back to "first non-header line".
 */
function splitPartHeadersBody(part: string): { headers: string; body: string } | null {
  const trimmed = part.replace(/^\r?\n+/, "");
  if (!trimmed || trimmed === "--" || trimmed.startsWith("--")) return null;

  const blank = trimmed.search(/\n\r?\n/);
  if (blank >= 0) {
    return {
      headers: trimmed.slice(0, blank),
      body: trimmed.slice(blank).replace(/^\r?\n+/, "").replace(/\n--\s*$/, ""),
    };
  }

  const lines = trimmed.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (i === 0 && !/^[A-Za-z0-9-]+:/.test(line)) return null;
    if (/^[A-Za-z0-9-]+:/.test(line) || (i > 0 && /^[ \t]/.test(line))) {
      i += 1;
      continue;
    }
    break;
  }
  if (i === 0 || i >= lines.length) return null;
  return {
    headers: lines.slice(0, i).join("\n"),
    body: lines.slice(i).join("\n").replace(/\n--\s*$/, ""),
  };
}

/** Prefer text/plain; fall back to stripped HTML. */
export function extractTextFromMime(
  body: string,
  contentType: string,
  transferEncoding = ""
): string {
  const ct = contentType.toLowerCase();
  const boundaryMatch = contentType.match(/boundary="?([^";\s]+)"?/i);
  if (ct.includes("multipart/") && boundaryMatch) {
    const boundary = boundaryMatch[1];
    const parts = body.split(
      new RegExp(`(?:^|\\n)--${escapeRegExp(boundary)}(?:--)?(?=\\n|$)`)
    );
    let plain = "";
    let html = "";
    for (const part of parts) {
      const split = splitPartHeadersBody(part);
      if (!split) continue;
      const { headers: partHeaders, body: partBody } = split;
      const partCt =
        headerValue(partHeaders, "Content-Type") ||
        headerValue(partHeaders, "Content-type");
      const partTe =
        headerValue(partHeaders, "Content-Transfer-Encoding") ||
        headerValue(partHeaders, "Content-transfer-encoding");
      if (/multipart\//i.test(partCt)) {
        const nested = extractTextFromMime(partBody, partCt);
        if (nested && !plain) plain = nested;
        continue;
      }
      if (/text\/plain/i.test(partCt) && !plain) {
        plain = decodeBody(partBody, partTe, partCt);
      } else if (/text\/html/i.test(partCt) && !html) {
        html = decodeBody(partBody, partTe, partCt);
      }
    }
    return plain.trim() || stripHtml(html);
  }

  if (ct.includes("text/html")) {
    return stripHtml(decodeBody(body, transferEncoding, contentType));
  }
  return decodeBody(body, transferEncoding, contentType).trim();
}

/** True when stored text looks like a raw MIME part/multipart blob. */
export function looksLikeRawMime(text: string): boolean {
  const head = text.trimStart().slice(0, 1200);
  const hasBoundary = /(?:^|\n)--[A-Za-z0-9_.=+-]+/.test(head);
  const hasPartHeaders =
    /content-type:\s*(multipart\/|text\/)/i.test(head) &&
    /content-transfer-encoding:/i.test(head);
  // Classic multipart wrapper, or a single text part that still starts with --B_…
  if (hasBoundary && hasPartHeaders) return true;
  if (/^--\S+/.test(head) && /content-type:\s*multipart/i.test(head)) return true;
  return false;
}

/**
 * Outlook mbox rows often store a single MIME part:
 *   --B_123
 *   Content-type: text/plain; charset="UTF-8"
 *   Content-transfer-encoding: quoted-printable
 *
 *   Dear Jonathan=20
 *   …
 * Optionally with a short preamble (from -> to) before the boundary.
 */
function extractOutlookMimeBlob(text: string): string {
  const boundaryAt = text.search(/(?:^|\n)--[A-Za-z0-9_.=+-]+/);
  const blob = (boundaryAt >= 0 ? text.slice(boundaryAt).replace(/^\n/, "") : text)
    .trimStart();

  // Drop the opening boundary line so headers start at Content-Type.
  const withoutBoundaryLine = blob.replace(/^--[^\n]*\r?\n/, "");
  const split = splitPartHeadersBody(withoutBoundaryLine);
  if (!split) return "";

  const partCt =
    headerValue(split.headers, "Content-Type") ||
    headerValue(split.headers, "Content-type") ||
    "text/plain";
  const partTe =
    headerValue(split.headers, "Content-Transfer-Encoding") ||
    headerValue(split.headers, "Content-transfer-encoding");

  if (/multipart\//i.test(partCt)) {
    return extractTextFromMime(split.body, partCt).trim();
  }
  if (/text\/html/i.test(partCt)) {
    return stripHtml(decodeBody(split.body, partTe, partCt)).trim();
  }
  return decodeBody(split.body, partTe, partCt).trim();
}

/** Heuristic: body still has quoted-printable soft breaks / =XX bytes. */
function looksLikeQuotedPrintablePlain(text: string): boolean {
  return /=\r?\n/.test(text) || /=[0-9A-Fa-f]{2}/.test(text);
}

/**
 * Turn stored email subject/snippet/body into human-readable plain text.
 * Safe to call at display time for rows imported before decoding existed.
 */
export function coerceEmailPlainText(
  text: string,
  contentTypeHint = "",
  transferEncoding = ""
): string {
  if (!text) return "";
  let out = text.replace(/\u0000/g, "");

  if (/multipart\//i.test(contentTypeHint)) {
    const extracted = extractTextFromMime(out, contentTypeHint, transferEncoding);
    if (extracted.trim()) out = extracted;
  } else if (looksLikeRawMime(out)) {
    const extracted = extractOutlookMimeBlob(out);
    if (extracted.trim()) {
      out = extracted;
    } else {
      // Fallback: treat as multipart/mixed using the first boundary token.
      const boundaryMatch = out
        .trimStart()
        .match(/(?:^|\n)--([^\s]+)/);
      if (boundaryMatch) {
        const boundary = boundaryMatch[1].replace(/--$/, "");
        const nested = extractTextFromMime(
          out,
          `multipart/mixed; boundary="${boundary}"`
        );
        if (nested.trim()) out = nested;
      }
    }
  } else if (transferEncoding || /text\/html/i.test(contentTypeHint)) {
    out = extractTextFromMime(out, contentTypeHint || "text/plain", transferEncoding);
  } else if (looksLikeQuotedPrintablePlain(out)) {
    out = decodeQuotedPrintable(out);
  }

  return out.trim();
}

export function formatEmailSubject(subject: string): string {
  return decodeRfc2047(subject || "");
}

export function formatEmailBody(text: string): string {
  return coerceEmailPlainText(text);
}

/** Markers where the quoted history of earlier messages begins. */
const QUOTED_REPLY_MARKERS: RegExp[] = [
  // "On Mon, 20 Jul 2026 at 09:12, Jane Doe <jane@x.org> wrote:" (may wrap once)
  /\nOn [^\n]{0,200}(?:\n[^\n]{0,120})?wrote:\s*\n/,
  // Outlook / Apple Mail original-message dividers
  /\n-{2,}\s*Original Message\s*-{2,}/i,
  /\n_{10,}\s*\n/,
  // Gmail forwards
  /\n-{5,}\s*Forwarded message\s*-{5,}/i,
  // Quoted header block: "From: …" followed within a few lines by "Subject: …"
  /\nFrom:\s[^\n]+\n(?:[^\n]+\n){0,4}?Subject:\s[^\n]+/,
  // Two or more consecutive ">"-quoted lines
  /\n\s*>[^\n]*\n\s*>[^\n]*/,
];

/**
 * Cut the quoted chain of earlier messages off a reply, keeping only the new
 * text. Falls back to the full text when stripping would leave nothing.
 */
/**
 * Links as a mail client writes them into text, said as a person would.
 *
 * The text/plain half of an HTML mail carries each link as its words with
 * the address welded on in angle brackets, and Outlook writes it with no
 * space at all:
 *
 *   University Cafes and Catering<https://catering.ed.ac.uk/central-area>
 *
 * Nothing downstream ever takes the brackets off. Read into a CRM field by
 * the mail assistant, that line then goes out in the participants' email
 * and into the printed programme exactly as it stands — angle brackets and
 * all, and in the email not even as a link, because the field is escaped.
 *
 * So a welded address becomes the parentheses a person would have written,
 * and `mailto:` is dropped: an address is an address. An address in
 * brackets with a space before it is the ordinary way of writing one in
 * plain text and reads well already, so it only loses its brackets.
 */
const ANGLE_LINK = "(?:https?://|mailto:)[^\\s<>]+";

export function unwrapAngleLinks(text: string): string {
  const plain = (target: string) => target.replace(/^mailto:/i, "");
  return text
    // Welded to the words before it: those keep their place, and the
    // address follows them as a person would have put it.
    .replace(
      new RegExp(`(\\S)<(${ANGLE_LINK})>`, "gi"),
      (_, before: string, target: string) => `${before} (${plain(target)})`
    )
    // On its own: a link and nothing else.
    .replace(new RegExp(`<(${ANGLE_LINK})>`, "gi"), (_, target: string) =>
      plain(target)
    );
}

export function stripQuotedReplies(text: string): string {
  if (!text) return "";
  const padded = `\n${text}`;
  let cut = -1;
  for (const re of QUOTED_REPLY_MARKERS) {
    const match = padded.match(re);
    if (match?.index !== undefined && (cut === -1 || match.index < cut)) {
      cut = match.index;
    }
  }
  if (cut === -1) return text.trim();
  const stripped = padded.slice(0, cut).trim();
  return stripped || text.trim();
}
