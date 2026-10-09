/**
 * The quoted history under a mail, rebuilt from the thread itself.
 *
 * Classic mail carries history as a chain: each reply quotes the mail it
 * answers whole, tail included, so the past survives only by being copied
 * forward one hop at a time. One mail sent without its tail — chat style
 * here, a trimmed reply anywhere — cuts the chain, and nothing sent after
 * it can carry what it did not receive.
 *
 * This app holds the thread, so it does not inherit the tail: it builds
 * one. Every message once, flat, each with its own "On …, X wrote:" line —
 * not the nested pyramid the chain grows — so turning "Quote history" back
 * on really does bring the whole history back, whatever was dropped
 * upstream.
 *
 * The blocks wear gmail_quote and gmail_attr classes because those are
 * what mail clients' fold-the-quote heuristics look for. Ours included.
 */

export type QuoteHistoryEntry = {
  /** Empty for the sender's own mail; the address then stands alone. */
  fromName: string;
  fromEmail: string;
  /** Already formatted for reading, e.g. "14 Aug, 15:02". */
  date: string;
  /** The message's own words, without its own quoted tail. */
  text: string;
  /** Sanitized by the caller; relayed as it is when present. */
  html?: string;
};

/**
 * How many messages an ordinary reply carries.
 *
 * The tail on a reply is for somebody reading one mail on its own; they
 * do not need five hundred messages of it, and past ~100KB Gmail starts
 * clipping the mail. Forwarding a conversation is the act that wants
 * everything, and that path sets no cap.
 */
export const REPLY_HISTORY_CAP = 25;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function attribution(entry: QuoteHistoryEntry): string {
  return entry.fromName
    ? `${entry.fromName} <${entry.fromEmail}>`
    : entry.fromEmail;
}

function attributionHtml(entry: QuoteHistoryEntry): string {
  return entry.fromName
    ? `${escapeHtml(entry.fromName)} &lt;${escapeHtml(entry.fromEmail)}&gt;`
    : escapeHtml(entry.fromEmail);
}

export function buildQuoteHistory(
  /** The thread's messages, oldest first. */
  entries: QuoteHistoryEntry[],
  options?: {
    /** Keep the newest this-many; the rest count as omitted. */
    cap?: number;
    /** Messages the thread has beyond `entries` — known but not loaded. */
    omittedBeyond?: number;
    /**
     * Newest-first reads like the chain a recipient knows; oldest-first
     * reads like a story, which is what a forwarded conversation is.
     */
    order?: "newest-first" | "oldest-first";
    /** A line above everything, e.g. naming a forwarded conversation. */
    heading?: string;
  }
): { text: string; html: string; included: number; omitted: number } {
  const cap = options?.cap ?? Number.POSITIVE_INFINITY;
  const kept =
    entries.length > cap ? entries.slice(entries.length - cap) : entries;
  const omitted =
    entries.length - kept.length + Math.max(0, options?.omittedBeyond ?? 0);
  const newestFirst = (options?.order ?? "newest-first") === "newest-first";
  const ordered = newestFirst ? [...kept].reverse() : kept;

  const textBlocks = ordered.map((entry) => {
    const quoted = entry.text
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    return `On ${entry.date}, ${attribution(entry)} wrote:\n${quoted}`;
  });
  const omittedText = omitted
    ? `[${omitted} earlier message${omitted === 1 ? "" : "s"} not shown]`
    : null;
  // The note about what is missing sits at the old end, whichever way the
  // blocks run: under everything when newest is first, above them when the
  // story runs downward.
  const text = [
    ...(options?.heading ? [options.heading] : []),
    ...(!newestFirst && omittedText ? [omittedText] : []),
    ...textBlocks,
    ...(newestFirst && omittedText ? [omittedText] : []),
  ].join("\n\n");

  const htmlBlocks = ordered.map((entry) => {
    const body =
      entry.html ??
      `<pre style="white-space:pre-wrap;font-family:Helvetica,Arial,sans-serif;font-size:12pt;margin:0">${escapeHtml(entry.text)}</pre>`;
    return (
      `<div class="gmail_attr" style="font-size:13px;color:#555;margin-top:12px">On ${escapeHtml(entry.date)}, ${attributionHtml(entry)} wrote:</div>` +
      `<blockquote class="gmail_quote" style="margin:6px 0 0 0;padding-left:12px;border-left:2px solid #ddd">${body}</blockquote>`
    );
  });
  const omittedHtml = omitted
    ? `<div style="font-size:12px;color:#888;margin-top:12px">${omitted} earlier message${omitted === 1 ? "" : "s"} not shown</div>`
    : "";
  const headingHtml = options?.heading
    ? `<div class="gmail_attr" style="font-size:13px;color:#555">${escapeHtml(options.heading)}</div>`
    : "";
  const html =
    `<div class="gmail_quote" style="margin-top:24px">` +
    headingHtml +
    (newestFirst
      ? htmlBlocks.join("") + omittedHtml
      : omittedHtml + htmlBlocks.join("")) +
    `</div>`;

  return { text, html, included: kept.length, omitted };
}
