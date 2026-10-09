/**
 * What a reaction looks like when it has to travel as an email.
 *
 * In a messaging app a reaction attaches to the message it answers, and
 * everyone sees the two together. Mail has nothing of the kind: a reaction can
 * only be another message. Sent as the emoji alone it arrives as a thumb with
 * no subject — the reader has to work out what it was for, and in a long
 * thread they often cannot.
 *
 * So the reaction carries its own context: a line of what was reacted to, and
 * the emoji under it. Not the whole quoted history — that is a different
 * thing, and a chat-style thread deliberately leaves it off. Just enough to
 * say which message this was about.
 *
 * No React and no DOM here, so a suite can read it.
 */

/**
 * Past this a quote stops being a reminder and starts being the message.
 *
 * Short enough to stay on one line in a bubble, which is what makes it read
 * as a label on the reaction rather than as something worth reading.
 */
export const REACTION_QUOTE_MAX = 100;

/** One line, however many the original had. */
export function reactionQuoteText(
  body: string,
  max = REACTION_QUOTE_MAX
): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  // Break at a word if there is one near the end, rather than mid-word.
  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max - 24 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The body of a reaction, as text and as HTML.
 *
 * The quote sits above the emoji, in a card of its own, the way a messaging
 * app shows what is being answered. Beside it read as two things of equal
 * weight; above it, the quote is plainly the label and the emoji is plainly
 * the message.
 *
 * Stacked table rows rather than flexbox, because this has to survive
 * Outlook, which does not lay out with flex. The card is white with a rule
 * down its left: on the tint of an outgoing bubble that reads as a card, and
 * in somebody else's client, on white, the rule and the border still show it
 * apart from the words around it.
 */
/** The card, or nothing when there is nothing worth quoting. */
function quoteCardHtml(quoted?: { fromName?: string; text?: string }): {
  html: string;
  text: string;
} | null {
  const quote = reactionQuoteText(quoted?.text ?? "");
  if (!quote) return null;
  const who = (quoted?.fromName ?? "").trim();
  const attribution = who ? `${who}: ` : "";
  /**
   * Quotation marks as well as the `>`.
   *
   * A collapsed row — ours and Gmail's — is the plain text with its line
   * breaks taken out, and Gmail drops the `>` on the way. The quote and the
   * reply then ran together as one sentence, with nothing to say where one
   * ended: "Tester lige igen Virker quoting nu?". The marks survive being
   * flattened, so the preview still reads as a quote and an answer.
   *
   * In the card as well as in the text. A folded row is built from whichever
   * part the client felt like using, and a card stripped of its rule and its
   * colour is just words — the marks are the only thing left saying what they
   * are. They are honest typography in the open card too: it is a quotation.
   */
  /**
   * Laid out the way a messaging app lays a reply out: a bar down the left,
   * whose message it was in bold on its own line, and what they said under
   * it. On one line with the name run into the words it read as a sentence
   * somebody had written, rather than as something being answered.
   *
   * White rather than a tint of the bubble. This card travels — it is read
   * inside our own bubble here, and inside whatever the recipient uses,
   * where we know nothing about what is behind it.
   */
  return {
    text: `> ${attribution}“${quote}”`,
    html: [
      '<div style="border:1px solid #d6d3d1;border-left:3px solid #0d9488;border-radius:8px;background:#ffffff;padding:6px 10px;line-height:1.4">',
      who
        ? `<div style="font-weight:600;font-size:13px;color:#0f766e">${escapeHtml(who)}</div>`
        : "",
      '<div style="font-size:13px;color:#57534e">',
      escapeHtml(`“${quote}”`),
      "</div>",
      "</div>",
    ].join(""),
  };
}

/**
 * A reply that answers one particular message.
 *
 * The quote goes in the body, in the same card a reaction uses, rather than
 * as the quoted history under it. Two reasons, and the second is the one that
 * bit: the reader folds trailing history away behind a "…", so a quote put
 * there is invisible until somebody goes looking; and a chat-style thread
 * drops the history altogether, which is right for a message to the
 * conversation and wrong for a reply to one thing somebody said.
 *
 * `bodyHtml` is what the composer produced. Plain text is escaped into
 * paragraphs when there is none.
 */
export function quotedReplyMessage(
  body: string,
  quoted?: { fromName?: string; text?: string },
  bodyHtml?: string
): { text: string; html: string } {
  const card = quoteCardHtml(quoted);
  const html =
    bodyHtml ??
    body
      .split(/\n{2,}/)
      .map(
        (para) =>
          `<p style="margin:0 0 12px 0;line-height:1.5">${escapeHtml(para).replace(/\n/g, "<br>")}</p>`
      )
      .join("");
  if (!card) return { text: body, html };
  return {
    text: `${card.text}\n\n${body}`,
    html: `${card.html}<div style="height:10px"></div>${html}`,
  };
}

export function reactionMessage(
  emoji: string,
  quoted?: { fromName?: string; text?: string }
): { text: string; html: string } {
  const quote = reactionQuoteText(quoted?.text ?? "");

  if (!quote) {
    return {
      text: emoji,
      html: `<p style="font-size:32px;line-height:1.2;margin:0">${emoji}</p>`,
    };
  }

  const card = quoteCardHtml(quoted)!;
  return {
    text: `${card.text}\n\n${emoji}`,
    html: [
      '<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">',
      "<tr><td>",
      card.html,
      "</td></tr>",
      '<tr><td style="font-size:32px;line-height:1.2;padding-top:8px">',
      escapeHtml(emoji),
      "</td></tr>",
      "</table>",
    ].join(""),
  };
}
