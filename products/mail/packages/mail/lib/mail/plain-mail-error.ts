/**
 * A mail error in words the reader can act on.
 *
 * The errors from the mail core start with a code (`ews:network: …`) and
 * carry what the server or the network library said, web addresses and
 * all. A file that did not come also reached the reader as the JSON body
 * of the answer: `{"error":"ews:invalid: …"}` (Mikkel, 2026-11-04). The
 * code and the raw words stay in the log; the reader gets this.
 *
 * Text with no known code is given back with only the JSON and the code
 * taken off, so an error that already reads well is not lost.
 */

/** The words for each kind of error the reader can do something about. */
const BY_CODE: Record<string, string> = {
  "ews:network": "Mail could not reach the mail server. Check the internet connection, then try again.",
  "ews:busy": "The mail server is busy. Try again in a minute.",
  "ews:unavailable": "The mail server is not answering just now. Try again in a minute.",
  "ews:http": "The mail server gave an error. Try again in a minute.",
  "ews:refused": "The mail server did not accept the password. Sign in to this mailbox again in Settings.",
};

/** The Rust side's words when the server gave no message for an item id. */
const NOT_GIVEN = "did not give this message";

/** Said when the server did not give the message a file is in. */
const NOT_GIVEN_TEXT = "The mail server did not send this file. Try again in a minute.";

/** The `error` of a JSON answer body, or the text as it is. */
function unwrapJson(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return trimmed;
  try {
    const parsed = JSON.parse(trimmed) as { error?: unknown; message?: unknown };
    const inner = parsed.error ?? parsed.message;
    return typeof inner === "string" ? inner.trim() : trimmed;
  } catch {
    return trimmed;
  }
}

export function plainMailError(error: unknown, fallback = "Something went wrong. Try again."): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const text = unwrapJson(raw);
  if (!text) return fallback;
  if (text.includes(NOT_GIVEN)) return NOT_GIVEN_TEXT;
  const coded = /^([a-z]+:[a-z-]+):\s*/.exec(text);
  if (!coded) return text;
  return BY_CODE[coded[1]] ?? (text.slice(coded[0].length).trim() || fallback);
}
