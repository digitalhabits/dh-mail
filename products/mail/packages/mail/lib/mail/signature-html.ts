/**
 * The signature, as it goes out.
 *
 * One setting, one rendering. The Gmail send path styled the block and its
 * links from the start, and the Outlook path sent the stored text bare — so
 * the same signature arrived in two faces depending on which mailbox sent
 * it. Both paths render through here now.
 *
 * Pure string work. No store, no provider.
 */

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const MARKDOWN_LINK = /\[([^\]]+)\]\(([^)]+)\)/g;

/**
 * A link in a signature: the words' own colour, and an underline.
 *
 * Inline, because a mail client cannot be relied on to read a stylesheet.
 * The underline is permanent — `:hover` needs one of those stylesheets,
 * and Outlook's engine has no notion of it — and it is what makes the link
 * findable now that it is not blue.
 *
 * #444 is the colour of the signature block this sits in. Not `inherit`:
 * a client's own `a { color }` rule beats an inherited colour, so an
 * anchor has to say the colour outright to keep it.
 */
const SIGNATURE_LINK_STYLE = "color:#444;text-decoration:underline";

/** Renders one signature line, converting [text](url) into anchors. */
function signatureLineHtml(line: string): string {
  let html = "";
  let lastIndex = 0;
  for (const match of line.matchAll(MARKDOWN_LINK)) {
    html += escapeHtml(line.slice(lastIndex, match.index));
    // The span repeats the colour inside the anchor. Some clients — the
    // phone ones especially — repaint every `<a>` their own colour and
    // leave what is nested in it alone, so this is the copy that survives.
    html += `<a href="${escapeHtml(match[2])}" style="${SIGNATURE_LINK_STYLE}"><span style="color:#444">${escapeHtml(match[1])}</span></a>`;
    lastIndex = match.index + match[0].length;
  }
  html += escapeHtml(line.slice(lastIndex));
  return html;
}

export function isHtmlSignature(signature: string): boolean {
  return /<[a-z][\s\S]*>/i.test(signature.trim());
}

/** Signature rendered slightly smaller than the 12pt body text. */
export function signatureHtml(signature: string): string {
  if (!signature.trim()) return "";
  if (isHtmlSignature(signature)) {
    // Rich-text signatures from the editor: keep lines tight and style links
    // inline (email clients ignore stylesheets).
    const styled = signature
      .replace(/<p(?![a-z])(?![^>]*style=)/gi, '<p style="margin:0"')
      // No nested span on this path: the anchor's text is whatever the
      // editor put there, and finding the matching `</a>` for each one is
      // not a job for a regular expression. A client that repaints anchors
      // will repaint these.
      .replace(
        /<a(?![a-z])(?![^>]*style=)/gi,
        `<a style="${SIGNATURE_LINK_STYLE}"`
      );
    return `<div style="margin-top:16px;font-size:13px;line-height:1.5;color:#444">${styled}</div>`;
  }
  const lines = signature.split("\n").map(signatureLineHtml).join("<br>");
  return `<div style="margin-top:16px;font-size:13px;line-height:1.5;color:#444">${lines}</div>`;
}

/** Links become their text in the plain-text part. */
export function signaturePlainText(signature: string): string {
  if (isHtmlSignature(signature)) {
    return signature
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|li)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  return signature.replace(MARKDOWN_LINK, "$1");
}
