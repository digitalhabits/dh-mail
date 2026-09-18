/**
 * The message as it travelled: its source, and what the source says.
 *
 * "Show original" puts the RFC 5322 text in front of the reader, the way
 * Gmail does, with a strip above it that answers the three questions people
 * open it for: who really sent this, when did it get here, and did the
 * checks pass. The strip is read from the headers here. Nothing else in the
 * app reads a raw message, so this stays pure and small enough to test.
 */

export type MessageHeader = { name: string; value: string };

export type AuthMethod = "spf" | "dkim" | "dmarc";

export type OriginalMessageSummary = {
  /** The From header, encoded words decoded. */
  from: string | null;
  subject: string | null;
  messageId: string | null;
  /** The Date header: when the sender's client made the message. */
  createdAt: Date | null;
  /** The last hop's Received stamp: when the message reached the mailbox. */
  deliveredAt: Date | null;
  /** Seconds between the two, never negative. Null when either is missing. */
  deliveredAfterSeconds: number | null;
  /** The verdict word ("pass", "fail", "none", …) per method, or null when no header says. */
  auth: Record<AuthMethod, string | null>;
};

/**
 * The header block, unfolded, names lowercased, in the order written.
 *
 * Folded lines (a continuation starts with a space or a tab) join their
 * header with one space, as RFC 5322 says they should be read.
 */
export function parseMessageHeaders(source: string): MessageHeader[] {
  const text = source.replace(/\r\n/g, "\n");
  const end = text.indexOf("\n\n");
  const head = end === -1 ? text : text.slice(0, end);
  const headers: MessageHeader[] = [];
  for (const line of head.split("\n")) {
    if (/^[ \t]/.test(line)) {
      const last = headers[headers.length - 1];
      if (last) last.value += ` ${line.trim()}`;
      continue;
    }
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    headers.push({
      name: line.slice(0, colon).trim().toLowerCase(),
      value: line.slice(colon + 1).trim(),
    });
  }
  return headers;
}

/** The first header with this name, or null. */
export function headerValue(
  headers: MessageHeader[],
  name: string
): string | null {
  const wanted = name.toLowerCase();
  return headers.find((h) => h.name === wanted)?.value ?? null;
}

/**
 * RFC 2047 encoded words in a header, decoded: `=?utf-8?B?...?=` and the
 * `Q` form. A word in a charset the platform cannot decode stays as written.
 */
export function decodeEncodedWords(value: string): string {
  // Whitespace between two encoded words is not part of the text.
  const joined = value.replace(/\?=\s+=\?/g, "?==?");
  return joined.replace(
    /=\?([^?\s]+)\?([bBqQ])\?([^?\s]*)\?=/g,
    (whole, charset: string, encoding: string, text: string) => {
      try {
        const bytes =
          encoding.toLowerCase() === "b" ? base64ToBytes(text) : qDecode(text);
        return new TextDecoder(charset.replace(/\*.*$/, "")).decode(bytes);
      } catch {
        return whole;
      }
    }
  );
}

function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function qDecode(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "_") {
      out.push(0x20);
    } else if (ch === "=" && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) {
      out.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      out.push(ch.charCodeAt(0));
    }
  }
  return Uint8Array.from(out);
}

/**
 * A date out of a header, or null. Received stamps carry the date after
 * the last semicolon; trailing comments like "(UTC)" are dropped first.
 */
function headerDate(value: string | null): Date | null {
  if (!value) return null;
  const afterHops = value.includes(";") ? value.slice(value.lastIndexOf(";") + 1) : value;
  const bare = afterHops.replace(/\([^)]*\)/g, "").trim();
  const when = new Date(bare);
  return Number.isNaN(when.getTime()) ? null : when;
}

/**
 * The verdicts from Authentication-Results. The first header stands: the
 * mailbox's own server writes it at the top, and a forwarder's earlier
 * results below it say nothing about this delivery.
 */
function authVerdicts(headers: MessageHeader[]): Record<AuthMethod, string | null> {
  const auth: Record<AuthMethod, string | null> = { spf: null, dkim: null, dmarc: null };
  for (const header of headers) {
    if (header.name !== "authentication-results") continue;
    for (const method of ["spf", "dkim", "dmarc"] as const) {
      if (auth[method]) continue;
      const match = new RegExp(`(?:^|[\\s;])${method}=([A-Za-z]+)`, "i").exec(header.value);
      if (match) auth[method] = match[1].toLowerCase();
    }
  }
  return auth;
}

/** What the strip above the source shows. */
export function summarizeOriginalMessage(source: string): OriginalMessageSummary {
  const headers = parseMessageHeaders(source);
  const from = headerValue(headers, "from");
  const subject = headerValue(headers, "subject");
  const createdAt = headerDate(headerValue(headers, "date"));
  const deliveredAt = headerDate(headerValue(headers, "received"));
  const deliveredAfterSeconds =
    createdAt && deliveredAt
      ? Math.max(0, Math.round((deliveredAt.getTime() - createdAt.getTime()) / 1000))
      : null;
  return {
    from: from ? decodeEncodedWords(from) : null,
    subject: subject ? decodeEncodedWords(subject) : null,
    messageId: headerValue(headers, "message-id"),
    createdAt,
    deliveredAt,
    deliveredAfterSeconds,
    auth: authVerdicts(headers),
  };
}
