import { decodeHtmlEntities } from "./html-entities";
import { findLinksInText } from "./linkify-urls";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Normalize Quill output for storage and comparison. */
export function normalizeEditorHtml(value: string) {
  return value.replace(/&nbsp;/g, " ");
}

/**
 * Every paragraph in a mail is a line, and Enter is a line break.
 *
 * That is what the writer's hands expect: it is what Outlook, Gmail and
 * Apple Mail all do, and each of them does it this way — the paragraph
 * stays a paragraph, and its margins are written to zero, so the gap
 * between two of them is one line's leading and nothing more. A blank
 * line is a blank paragraph, made by pressing Enter twice, and it goes
 * out as one. The mail says the margin on every paragraph because the
 * client reading it would otherwise supply its own.
 *
 * The editor draws paragraphs the same way — see RichTextEditor — so the
 * message leaves looking exactly as it looked in the box.
 */
export const EMAIL_PARAGRAPH_STYLE = "margin:0;line-height:1.5";

const CANONICAL_EMAIL_INLINE_STYLES = [
  EMAIL_PARAGRAPH_STYLE,
  // What earlier versions wrote, still stripped from stored content.
  "margin:0 0 12px 0;line-height:1.5",
  "margin:0 0 4px 0;line-height:1.45",
];

function stripCanonicalEmailInlineStyles(html: string): string {
  let result = html;
  for (const style of CANONICAL_EMAIL_INLINE_STYLES) {
    const escaped = style.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`\\s*style="${escaped}"`, "gi"), "");
    result = result.replace(new RegExp(`\\s*style='${escaped}'`, "gi"), "");
  }
  return result;
}

function emailParagraph(inner: string): string {
  return `<p style="${EMAIL_PARAGRAPH_STYLE}">${inner || "<br>"}</p>`;
}

/**
 * Plain text, line for line, in the shape the thing reading it expects.
 *
 * One paragraph per line, and a blank line becomes a blank paragraph, so
 * what was typed is what is shown. The editor wants them bare — its own
 * stylesheet draws them — and a mail wants the style said on each one,
 * because the client reading it supplies margins of its own otherwise.
 */
/**
 * A line of plain text, escaped, with its web and mail addresses made
 * links. An AI draft and an imported draft both arrive as words, and a
 * URL left as words is the one thing in them the reader cannot click.
 * The attributes are the ones Quill writes on a link of its own, so a
 * draft the editor round-trips is not rewritten.
 */
function lineWithLinks(line: string): string {
  const matches = findLinksInText(line);
  if (!matches.length) return escapeHtml(line);
  let out = "";
  let last = 0;
  for (const m of matches) {
    out += escapeHtml(line.slice(last, m.start));
    out += `<a href="${escapeHtml(m.href)}" rel="noopener noreferrer" target="_blank">${escapeHtml(
      line.slice(m.start, m.end)
    )}</a>`;
    last = m.end;
  }
  return out + escapeHtml(line.slice(last));
}

function plainTextLines(text: string, style?: string): string {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  const open = style ? `<p style="${style}">` : "<p>";
  if (!normalized) return `${open}<br></p>`;
  return normalized
    .split("\n")
    .map((line) => `${open}${lineWithLinks(line.trim()) || "<br>"}</p>`)
    .join("");
}

/** Convert plain-text email bodies for the rich-text editor. */
export function plainTextToEditorHtml(text: string): string {
  return plainTextLines(text);
}

/**
 * Quill's lists, rewritten as lists everything else understands.
 *
 * Quill 2 writes every list as `<ol>`, bullets included, and says which it
 * meant with `data-list="bullet"` on each line. The dot is drawn by its own
 * stylesheet against that attribute. Inside the editor that is invisible —
 * and outside it, where our stylesheet does not reach, a bullet list is an
 * ordered list: every recipient saw 1. 2. 3. where the writer had dots, and
 * so did Outlook when a draft was pasted into it.
 *
 * So the type is read off the lines and a real `<ul>` or `<ol>` is built
 * around them, with Quill's marker span dropped: it holds nothing but the
 * space its CSS draws in.
 *
 * A run of lines of one kind makes one list, so a bulleted list with a
 * numbered one under it comes out as two lists rather than one confused
 * one — which is how Quill holds them, all in a single element.
 */
function quillListToEmailLists(list: HTMLElement): string[] {
  const out: string[] = [];
  let kind: "ul" | "ol" | null = null;
  let lines: string[] = [];

  const flush = () => {
    if (!kind || !lines.length) return;
    const style =
      kind === "ul"
        ? "margin:0 0 12px 0;padding-left:24px;list-style-type:disc"
        : "margin:0 0 12px 0;padding-left:24px";
    out.push(`<${kind} style="${style}">${lines.join("")}</${kind}>`);
    kind = null;
    lines = [];
  };

  for (const item of [...list.children]) {
    if (item.tagName.toUpperCase() !== "LI") continue;
    const marked = item.getAttribute("data-list");
    // Checkboxes have no counterpart in mail, and a tick is not a number:
    // they read as a plain list, which is what they look like.
    const wanted: "ul" | "ol" = marked === "ordered" ? "ol" : "ul";
    if (kind && kind !== wanted) flush();
    kind = wanted;
    const line = item.cloneNode(true) as HTMLElement;
    for (const ui of [...line.querySelectorAll(".ql-ui")]) ui.remove();
    line.removeAttribute("data-list");
    line.removeAttribute("class");
    lines.push(`<li>${line.innerHTML}</li>`);
  }
  flush();
  return out.length ? out : [list.outerHTML];
}

/**
 * The editor's paragraphs, restated for a mail.
 *
 * Line for line: each of Quill's paragraphs goes out as a paragraph with
 * its margins written to zero, and an empty one goes out as an empty one,
 * so the message reads exactly as the box showed it. This used to guess —
 * runs of short lines were merged into one paragraph with line breaks, and
 * everything else got a gap after it — which meant what arrived was not
 * what was written.
 *
 * A paragraph that carries its own style keeps it. It carried it in the
 * editor too, so what it looked like there is what it says here.
 */
export function coalesceQuillEmailParagraphs(html: string): string {
  if (!isLikelyHtml(html) || typeof document === "undefined") {
    return html;
  }

  const container = document.createElement("div");
  container.innerHTML = normalizeEditorHtml(html);

  const parts: string[] = [];

  for (const node of [...container.childNodes]) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as HTMLElement;
    const tag = el.tagName.toUpperCase();

    if (tag === "OL" || tag === "UL") {
      parts.push(...quillListToEmailLists(el));
      continue;
    }

    if (tag !== "P") {
      parts.push(el.outerHTML);
      continue;
    }

    const style = el.getAttribute("style") ?? EMAIL_PARAGRAPH_STYLE;
    const inner = (el.textContent ?? "").trim() ? el.innerHTML : "<br>";
    parts.push(`<p style="${style}">${inner}</p>`);
  }

  const result = parts.join("");
  return result || html;
}

/** HTML loaded into the rich-text editor (do not re-coalesce stored HTML). */
export function templateBodyForEditor(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "<p><br></p>";
  if (!isLikelyHtml(trimmed)) return plainTextToEditorHtml(trimmed);
  return normalizeEditorHtml(trimmed);
}

/** Normalize Quill output for storage and preview rendering. */
export function templateBodyFromEditor(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) return "";
  if (!isLikelyHtml(trimmed)) return trimmed;
  return coalesceQuillEmailParagraphs(trimmed);
}

export function templateBodyContentEqual(
  stored: string,
  editorHtml: string
): boolean {
  return (
    normalizeEditorHtml(templateBodyFromEditor(editorHtml)) ===
    normalizeEditorHtml(templateBodyFromEditor(stored))
  );
}

/** Single HTML representation for rich-text editor and preview. */
export function bodyToEmailHtml(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return emailParagraph("<br>");
  if (!isLikelyHtml(trimmed)) {
    return plainTextLines(trimmed, EMAIL_PARAGRAPH_STYLE);
  }
  return sizeInlineImages(coalesceQuillEmailParagraphs(trimmed));
}

/**
 * How wide a picture in a message is allowed to be.
 *
 * The width every email is laid out to, and the width every newsletter has
 * used for twenty years. A screenshot is two or three times this, and sent
 * at its own size it makes the message wider than the window reading it —
 * so the recipient scrolls sideways to read a sentence.
 */
const EMAIL_BODY_WIDTH = 600;

/**
 * Hold every picture to the width of the message.
 *
 * Both halves are needed and they do different jobs. `max-width:100%` is what
 * a modern client obeys, and it is the one that keeps the picture inside a
 * phone screen. `width` is for the old ones — Outlook on Windows among them
 * — which ignore CSS on an image and draw it at its own pixel size.
 *
 * `height:auto` so neither of those squashes it.
 */
function sizeInlineImages(html: string): string {
  if (!html.includes("<img")) return html;
  return html.replace(/<img\b([^>]*)>/gi, (whole, attrs: string) => {
    // Left alone if it already says: a signature's logo is sized by whoever
    // wrote the signature, and this is not the place to argue with them.
    if (/\b(width|style)\s*=/i.test(attrs)) return whole;
    return `<img${attrs} width="${EMAIL_BODY_WIDTH}" style="max-width:100%;height:auto">`;
  });
}

/** True when Quill output still matches the pre–rich-text snapshot (no real edits). */
export function editorHtmlMatchesSnapshot(
  snapshot: string,
  editorHtml: string
): boolean {
  const expected = bodyToEmailHtml(snapshot);
  return normalizeEditorHtml(bodyToEmailHtml(editorHtml)) === normalizeEditorHtml(expected);
}

/**
 * Lightweight HTML re-formatter: ensures each block-level element starts on its
 * own line without splitting `<p>content</p>` across multiple lines.
 */
export function prettyFormatHtml(html: string): string {
  let result = html.replace(
    /(?<!\n)(<(?:p|div|ul|ol|li|h[1-6]|table|tr|td|th|blockquote|hr|br)\b)/gi,
    "\n$1"
  );
  result = result.replace(
    /<\/(?:p|div|ul|ol|li|h[1-6]|table|tr|td|th|blockquote)>(?!\n)/gi,
    "$&\n"
  );

  result = result
    .split("\n")
    .map((line) => line.trim())
    .filter((line, index, arr) => line !== "" || (index > 0 && arr[index - 1] !== ""))
    .join("\n")
    .trim();

  return result;
}

export function isLikelyHtml(value: string): boolean {
  return /<[a-z][\s\S]*>/i.test(value.trim());
}

export function isFullHtmlDocument(value: string): boolean {
  return /<!DOCTYPE\s+html/i.test(value) || /<html[\s>]/i.test(value);
}

export function wrapEmailPreviewDocument(bodyHtml: string): string {
  if (isFullHtmlDocument(bodyHtml)) {
    return bodyHtml;
  }
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      /*
       * A white sheet, in the dark theme as well. The preview shows what the
       * reader of the email will see, and that is a white sheet. Said here,
       * so the dark page behind the frame cannot show through the writing.
       */
      html {
        color-scheme: light;
        background: #ffffff;
      }
      body {
        font-family: Helvetica, Arial, sans-serif;
        font-size: 14px;
        line-height: 1.6;
        color: #222;
        background: #ffffff;
        margin: 16px;
      }
      p { margin: 0 0 12px 0; line-height: 1.5; }
      ul, ol { margin: 0 0 16px 18px; padding: 0; }
      li { margin: 0 0 8px 0; }
      a { color: #1d4ed8; text-decoration: underline; }
    </style>
  </head>
  <body>${bodyHtml}</body>
</html>`;
}

/** Plain-text fallback for mailto: links (most clients ignore HTML bodies). */
export function htmlToPlainText(html: string): string {
  const trimmed = html.trim();
  if (!isLikelyHtml(trimmed)) {
    return trimmed;
  }

  if (typeof document !== "undefined") {
    const doc = new DOMParser().parseFromString(trimmed, "text/html");
    const chunks: string[] = [];
    for (const node of [...doc.body.childNodes]) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const el = node as HTMLElement;
      // A line break becomes a newline in the tree first, so the words can
      // then be read from it: textContent gives "&" for "&amp;", where the
      // markup with its tags cut out kept the entity, and Outlook showed
      // "&amp;" as typed.
      for (const br of [...el.querySelectorAll("br")]) br.replaceWith("\n");
      chunks.push((el.textContent ?? "").trim());
    }
    return chunks.filter(Boolean).join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  return decodeHtmlEntities(
    trimmed
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** True when the body has inline styles the rich text editor cannot round-trip. */
export function templateBodyHasInlineStyles(body: string): boolean {
  return /style\s*=/i.test(stripCanonicalEmailInlineStyles(body));
}
