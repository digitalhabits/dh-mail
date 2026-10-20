/**
 * Header lines for a message that goes out, with no line break in a value.
 *
 * A MIME header ends at CR LF. A value that holds one ends its header early,
 * and what follows it is read as a header of its own: `Bcc:` to somebody
 * the writer never chose, or a second body. Some of these values come from
 * other people. In-Reply-To and References are copied from the message being
 * answered, and the sender of that message wrote them.
 *
 * So each value goes through `headerValue`, which strips CR, LF and NUL
 * and puts one space in place of each run. A folded header is one line
 * once unfolded, so a space is what a line break in a header value meant.
 * Nothing in a header value needs a raw line break.
 *
 * No DOM and no provider here, so a test can read it.
 */

/** A header name: printable ASCII with no colon or space (RFC 5322 2.2). */
const HEADER_NAME = /^[\x21-\x39\x3b-\x7e]+$/;

/** A header value with no CR, LF or NUL in it. */
export function headerValue(value: string): string {
  return value.replace(/[\r\n\0]+/g, " ").trim();
}

/** One header line, `Name: value`. */
export function headerLine(name: string, value: string): string {
  if (!HEADER_NAME.test(name)) throw new Error(`Not a header name: ${JSON.stringify(name)}`);
  return `${name}: ${headerValue(value)}`;
}

/** What goes on the envelope of one outgoing message. */
export type OutgoingHeaderInput = {
  /** The From value, already formatted (see formatFromHeader). */
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  /** The Subject value, already encoded for ASCII. */
  subject: string;
  messageId: string;
  inReplyTo?: string;
  references?: string;
};

/** The header lines of an outgoing message, in order. */
export function outgoingHeaderLines(input: OutgoingHeaderInput): string[] {
  const list = (values: string[]) => values.map(headerValue).filter(Boolean).join(", ");
  const to = list(input.to);
  const cc = list(input.cc ?? []);
  const bcc = list(input.bcc ?? []);
  const inReplyTo = headerValue(input.inReplyTo ?? "");
  const references = headerValue(input.references ?? "");
  return [
    headerLine("From", input.from),
    // Nobody in To (a message to Bcc alone): the empty group, not an empty
    // header, which is not valid and which some servers refuse.
    headerLine("To", to || "undisclosed-recipients:;"),
    ...(cc ? [headerLine("Cc", cc)] : []),
    ...(bcc ? [headerLine("Bcc", bcc)] : []),
    headerLine("Subject", input.subject),
    headerLine("Message-ID", input.messageId),
    ...(inReplyTo ? [headerLine("In-Reply-To", inReplyTo)] : []),
    ...(references ? [headerLine("References", references)] : []),
    "MIME-Version: 1.0",
  ];
}
