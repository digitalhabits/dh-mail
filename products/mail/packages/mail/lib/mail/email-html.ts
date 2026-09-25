/*
 * A message's HTML, made safe and made small: the sanitizer (scripts,
 * handlers, unsafe links and blank edges out; bare links made links), and
 * the quoted history cut from a reply.
 *
 * Each works on a string, through a detached document. EmailHtmlView draws
 * the result in its frame; its header says why the sanitizer is one of two
 * guards, not the only one.
 */

import { findLinksInText } from "@/lib/linkify-urls";
import { MAIL_HREF_ATTR, softenAnchorsForParse } from "@/lib/mail/soften-anchors";

const BLOCKED_ELEMENTS = new Set([
  "script",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "link",
  "meta",
  "base",
  "form",
  "input",
  "textarea",
  "select",
  "button",
  "video",
  "audio",
  "source",
  "track",
  "template",
  "noscript",
  "dialog",
]);

const UNSAFE_URL_RE = /^\s*(javascript|vbscript|data:text\/html)/i;

/** True when the HTML references remote images (worth offering a toggle). */
export function htmlHasRemoteImages(html: string): boolean {
  return /<img[^>]+src\s*=\s*["']?https?:/i.test(html) || /url\(\s*["']?https?:/i.test(html);
}

/**
 * Realm-safe Element check. Parent-page `instanceof Element` is false for
 * iframe nodes (separate JS globals). Prefer nodeType — works across realms
 * even when `view` is missing.
 */
export function asElement(node: EventTarget | null): Element | null {
  if (!node || typeof (node as Node).nodeType !== "number") return null;
  if ((node as Node).nodeType !== 1) return null;
  return node as Element;
}

/** Whitespace, including the hard space a mail client leaves behind. */
function isBlankText(value: string): boolean {
  return !value.replace(/[\s\u00a0\u200b\ufeff]+/g, "");
}

/** Elements that show something without holding any text. */
const DRAWS_WITHOUT_TEXT =
  "img,picture,video,iframe,hr,svg,canvas,object,embed,input,button,textarea,select";

/**
 * A style that paints a box of its own: a rule, a band of colour, a height.
 *
 * The tail matters — a divider is nearly always `border-top`, never `border`,
 * and reading only the plain property took those dividers away.
 */
const PAINTS_A_BOX = /(background|border|height|padding)[a-z-]*\s*:/i;

/** True when this element draws something even with nothing inside it. */
function paintsABox(el: Element): boolean {
  if (PAINTS_A_BOX.test(el.getAttribute("style") ?? "")) return true;
  return el.hasAttribute("bgcolor") || el.hasAttribute("background");
}

/**
 * True when taking this node away would change nothing on screen.
 *
 * Anything that paints is kept, even with no text in it: a divider is a
 * border on an empty div, and a band of colour is a background on one.
 */
function drawsNothing(node: Node): boolean {
  if (node.nodeType === node.TEXT_NODE) return isBlankText(node.nodeValue ?? "");
  if (node.nodeType === node.COMMENT_NODE) return true;
  if (node.nodeType !== node.ELEMENT_NODE) return false;
  const el = node as Element;
  if (el.tagName === "BR") return true;
  if (el.matches(DRAWS_WITHOUT_TEXT)) return false;
  if (el.querySelector(DRAWS_WITHOUT_TEXT)) return false;
  if (!isBlankText(el.textContent ?? "")) return false;
  return !paintsABox(el);
}

/** How far down the first/last child chain the edges are followed. */
const TRIM_MAX_DEPTH = 8;

/**
 * Take the spacing off the very top and the very bottom of a message.
 *
 * A paragraph's margin is a line of space. Between two paragraphs that is the
 * sender writing; at the two edges it stands against our own padding, and the
 * message ends in a hole.
 *
 * This is done to the elements and not in the stylesheet on purpose. A rule
 * can only name a fixed number of levels, and the last paragraph of a message
 * is routinely a `p` inside a `td` inside a `table` inside a wrapper — while
 * `body > *:last-child` is the link bridge's own script tag, which is added
 * after this and carries no spacing to take off.
 */
function collapseEdgeSpacing(
  el: Element,
  edge: "margin-top" | "margin-bottom",
  depth = 0
): void {
  const style = el.getAttribute("style") ?? "";
  el.setAttribute("style", `${style};${edge}:0`);
  const next =
    edge === "margin-top" ? el.firstElementChild : el.lastElementChild;
  if (!next || depth >= TRIM_MAX_DEPTH) return;
  collapseEdgeSpacing(next, edge, depth + 1);
}

/**
 * Take the empty rows off the start and the end of a message.
 *
 * A mail client leaves them behind — the blank lines under a signature are
 * the usual ones — and they are inside the sender's own layout, so the frame
 * is measured around them and the bubble ends in a hole. Only the two edges
 * are touched: a blank line between two paragraphs is the sender writing,
 * and it stays.
 *
 * The edges are followed down the first and last child, because a message is
 * nearly always wrapped in a div or a table and the blank rows sit inside it.
 */
function trimLeadingBlanks(el: Element, depth = 0): void {
  let node = el.firstChild;
  while (node && drawsNothing(node)) {
    const next = node.nextSibling;
    node.parentNode?.removeChild(node);
    node = next;
  }
  const first = el.firstElementChild;
  if (!first || depth >= TRIM_MAX_DEPTH) return;
  // Not into something that paints. Its cells can be empty and it still
  // draws — emptying a coloured row is how the colour goes away.
  if (paintsABox(first)) return;
  trimLeadingBlanks(first, depth + 1);
}

function trimTrailingBlanks(el: Element, depth = 0): void {
  let node = el.lastChild;
  while (node && drawsNothing(node)) {
    const previous = node.previousSibling;
    node.parentNode?.removeChild(node);
    node = previous;
  }
  const last = el.lastElementChild;
  if (!last || depth >= TRIM_MAX_DEPTH) return;
  if (paintsABox(last)) return;
  trimTrailingBlanks(last, depth + 1);
}

/** Strip anything executable/interactive from untrusted email HTML. */
export function sanitizeEmailHtml(
  html: string,
  inlineImages?: Record<string, string>
): string {
  const doc = new DOMParser().parseFromString(
    softenAnchorsForParse(html),
    "text/html"
  );

  const all = doc.querySelectorAll("*");
  for (const el of all) {
    if (BLOCKED_ELEMENTS.has(el.tagName.toLowerCase())) {
      el.remove();
      continue;
    }
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
      } else if (
        (name === "href" ||
          name === MAIL_HREF_ATTR ||
          name === "src" ||
          name === "srcset" ||
          name === "xlink:href") &&
        UNSAFE_URL_RE.test(attr.value)
      ) {
        el.removeAttribute(attr.name);
      }
    }
  }

  // Legacy demote left href on <span>; normalize to data-dh-href.
  for (const el of doc.querySelectorAll("[href]")) {
    if (el.tagName === "A") continue;
    const href = el.getAttribute("href");
    if (!href) continue;
    if (!el.getAttribute(MAIL_HREF_ATTR)) {
      el.setAttribute(MAIL_HREF_ATTR, href);
    }
    el.removeAttribute("href");
  }

  for (const el of doc.querySelectorAll(`[${MAIL_HREF_ATTR}]`)) {
    if (!el.getAttribute("role")) el.setAttribute("role", "link");
  }

  // Our own sends are wrapped at 12pt so recipients' clients (Outlook et al.)
  // show them at their default reading size — but in our viewer that renders
  // larger than the 14px iframe default used for unstyled incoming mail.
  // Normalize the wrapper (div) and quoted-history blocks (pre) back to 14px
  // on display so own bubbles match incoming ones. Old app versions already
  // sent a 14px wrapper, which now needs no rewrite.
  for (const el of doc.querySelectorAll(
    'div[style*="font-size:12pt"], pre[style*="font-size:12pt"]'
  )) {
    const style = el.getAttribute("style") ?? "";
    if (
      style.includes("font-family:Helvetica,Arial,sans-serif") &&
      (style.includes("line-height:1.6") ||
        style.includes("white-space:pre-wrap"))
    ) {
      el.setAttribute("style", style.replace("font-size:12pt", "font-size:14px"));
    }
  }

  // Inline cid: attachments — substitute the data: URI the server resolved
  // from the message, or drop the img when the attachment wasn't available.
  for (const img of doc.querySelectorAll("img")) {
    // `originalsrc` as well as `src`. Outlook keeps the content id there and
    // puts a blob URL of its own in `src` — one that means nothing outside
    // its own web client, and that we would otherwise render as a broken
    // picture rather than the one that came with the message.
    const src = img.getAttribute("src") ?? "";
    const cidMatch =
      /^\s*cid:(.+)$/i.exec(src) ??
      /^\s*cid:(.+)$/i.exec(img.getAttribute("originalsrc") ?? "");
    if (!cidMatch) continue;
    const mapped = inlineImages?.[decodeURIComponent(cidMatch[1]).trim()];
    if (mapped) img.setAttribute("src", mapped);
    else img.remove();
  }

  for (const img of doc.querySelectorAll("img")) dropHeightOnSizedImage(img);

  // Outlook (and most clients) turn bare https://… text into links; do the
  // same so HTML parts that never wrapped the URL in <a> stay clickable.
  if (doc.body) linkifyBareLinksInRoot(doc.body, doc);

  for (const a of doc.querySelectorAll("a")) {
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noreferrer noopener");
  }

  // Last, so that a picture dropped above for having no attachment behind it
  // leaves a row that goes with it.
  if (doc.body) {
    trimLeadingBlanks(doc.body);
    trimTrailingBlanks(doc.body);
    if (doc.body.firstElementChild) {
      collapseEdgeSpacing(doc.body.firstElementChild, "margin-top");
    }
    if (doc.body.lastElementChild) {
      collapseEdgeSpacing(doc.body.lastElementChild, "margin-bottom");
    }
  }

  return doc.body?.innerHTML ?? "";
}

/**
 * Below this, a picture's size is doing a job other than showing a picture.
 *
 * A one-pixel spacer stretched to hold a table open is the usual one, and its
 * height is the whole point of it. Nothing that small is a photograph.
 */
const SIZED_IMAGE_MIN_WIDTH = 200;

/** A length in plain pixels: `800`, `800px`. Anything else is not one. */
function pixelLength(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/.exec(value);
  return match ? Number(match[1]) : null;
}

/**
 * A picture keeps its shape when the pane makes it narrower.
 *
 * `max-width:100%` shrinks a wide image to fit the pane, but a height the
 * sender wrote does not shrink with it, so the picture is squashed — by a
 * different amount at every pane width, which is why it changes as the window
 * is resized. Dropping the height lets `height:auto` scale it with the width.
 *
 * Only where a real width was declared. A width in per cent counts too: it
 * already scales, and a fixed height beside it distorts in the same way.
 */
function dropHeightOnSizedImage(img: Element): void {
  const styleWidth = (img as HTMLElement).style?.width ?? "";
  const scales = styleWidth.trim().endsWith("%");
  const width =
    pixelLength(img.getAttribute("width")) ?? pixelLength(styleWidth);
  if (!scales && (width == null || width < SIZED_IMAGE_MIN_WIDTH)) return;
  img.removeAttribute("height");
  (img as HTMLElement).style?.removeProperty("height");
  if (!(img as HTMLElement).getAttribute("style")) {
    img.removeAttribute("style");
  }
}

/** True when a text node sits inside an existing link (don't nest links). */
function isInsideAnchor(node: Node): boolean {
  let el = node.parentElement;
  while (el) {
    if (el.tagName === "A" || el.hasAttribute(MAIL_HREF_ATTR)) return true;
    el = el.parentElement;
  }
  return false;
}

/**
 * Wrap bare links in text nodes with <a> elements: http(s) URLs, and email
 * addresses as `mailto:`.
 *
 * Plenty of senders write an address as text — "Dana Fisher
 * <dana@example.ac.uk>" — and every other mail client makes that clickable.
 * The click is answered by the bridge, which hands it to our composer.
 */
function linkifyBareLinksInRoot(root: HTMLElement, doc: Document) {
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node.textContent ?? "";
    if (!text || isInsideAnchor(node)) continue;
    if (findLinksInText(text).length) targets.push(node as Text);
  }

  for (const textNode of targets) {
    const text = textNode.textContent ?? "";
    const matches = findLinksInText(text);
    if (!matches.length) continue;

    const frag = doc.createDocumentFragment();
    let last = 0;
    for (const { start, end, href } of matches) {
      if (start > last) frag.append(doc.createTextNode(text.slice(last, start)));
      const a = doc.createElement("a");
      a.setAttribute("href", href);
      a.textContent = text.slice(start, end);
      frag.append(a);
      last = end;
    }
    if (last < text.length) frag.append(doc.createTextNode(text.slice(last)));
    textNode.parentNode?.replaceChild(frag, textNode);
  }
}

/**
 * Elements that mark where a mail client appended the quoted history of
 * earlier messages. First match in document order wins.
 */
const QUOTE_CONTAINER_SELECTORS = [
  "#divRplyFwdMsg", // Outlook reply/forward header
  "#appendonsend",
  "#mail-editor-reference-message-container",
  ".gmail_quote_container",
  "div.gmail_quote",
  'blockquote[type="cite"]', // Apple Mail
  ".moz-cite-prefix", // Thunderbird
  ".yahoo_quoted",
];

const FROM_LABEL_RE = /^\s*(From|Fra|Von|Van|De)\s*:/i;
const SUBJECT_LABEL_RE = /\b(Subject|Emne|Betreff|Onderwerp|Objet|Asunto)\s*:/i;
const DIVIDER_TEXT_RE =
  /^-{2,}\s*(Original Message|Forwarded message|Oprindelig meddelelse|Videresendt meddelelse)\s*-{2,}/i;
/** Attribution line right above a quote ("On 24 Jul 2026 … wrote:"). */
const WROTE_LINE_RE = /(wrote|skrev|schrieb|a écrit)\s*:?\s*$/i;

/**
 * The text of an element, with a line break for each <br>.
 *
 * textContent joins the lines of a pasted header with nothing between
 * them when the HTML has no space after each <br>: "Monday<br>Subject:"
 * reads "MondaySubject:", and the label is not found at a word start.
 */
function textWithBreaks(el: Element): string {
  let out = "";
  const walk = (node: Node) => {
    if (node.nodeType === 3) out += node.nodeValue ?? "";
    else if (node.nodeName === "BR") out += "\n";
    else node.childNodes.forEach(walk);
  };
  walk(el);
  return out;
}

function findQuoteStart(doc: Document): Element | null {
  const candidates: Element[] = [];
  for (const selector of QUOTE_CONTAINER_SELECTORS) {
    const el = doc.querySelector(selector);
    if (el) candidates.push(el);
  }

  // Header block a client pasted as plain markup: an element whose text
  // starts with "From:" (any common language) and lists a Subject soon after,
  // or an explicit "-----Original Message-----" divider.
  for (const el of doc.body?.querySelectorAll("div, p") ?? []) {
    const text = textWithBreaks(el).trim();
    if (!text) continue;
    if (
      DIVIDER_TEXT_RE.test(text) ||
      (FROM_LABEL_RE.test(text) && SUBJECT_LABEL_RE.test(text.slice(0, 800)))
    ) {
      candidates.push(el);
      break; // document order: the first hit is the outermost/earliest
    }
  }

  // "On … wrote:" attribution followed by a blockquote — our own replies
  // and clients that don't wrap the quote in gmail_quote. Always consider
  // these: a nested .gmail_quote inside the quoted history would otherwise
  // win and leave our outer quote visible.
  for (const quote of doc.body?.querySelectorAll("blockquote") ?? []) {
    const prev = quote.previousElementSibling;
    if (prev && WROTE_LINE_RE.test((prev.textContent ?? "").trim())) {
      candidates.push(prev);
      break;
    }
    const parent = quote.parentElement;
    if (parent && parent !== doc.body) {
      const first = (parent.firstElementChild?.textContent ?? "").trim();
      if (WROTE_LINE_RE.test(first)) {
        candidates.push(parent);
        break;
      }
    }
  }

  if (!candidates.length) return null;
  // Earliest in the document = outermost quote boundary.
  candidates.sort((a, b) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
  );
  return candidates[0];
}

/**
 * Cut the quoted chain of earlier messages off an HTML reply (the rich-view
 * sibling of stripQuotedReplies). Returns the original when nothing would be
 * left, so a pure forward never renders as an empty bubble.
 */
export function stripQuotedHtml(html: string): {
  html: string;
  hadQuote: boolean;
} {
  if (typeof window === "undefined") return { html, hadQuote: false };

  const doc = new DOMParser().parseFromString(html, "text/html");
  const marker = findQuoteStart(doc);
  if (!marker || !doc.body) return { html, hadQuote: false };

  // Drop everything from the marker to the end of the document.
  let node: Node | null = marker;
  while (node && node !== doc.body) {
    while (node.nextSibling) node.nextSibling.remove();
    node = node.parentNode;
  }
  marker.remove();

  // Tidy what's now the tail: separator rules, empty blocks, and the
  // "On … wrote:" attribution line that introduced the quote.
  let last = doc.body.lastElementChild;
  while (last) {
    const text = (last.textContent ?? "").trim();
    const isNoise =
      last.tagName === "HR" ||
      (!text && !last.querySelector("img")) ||
      // Short attribution line only — never a wrapper holding the message.
      (text.length < 200 && WROTE_LINE_RE.test(text));
    if (!isNoise) break;
    const prev = last.previousElementSibling;
    last.remove();
    last = prev;
  }

  const remaining = doc.body.innerHTML;
  if (!(doc.body.textContent ?? "").trim() && !doc.body.querySelector("img")) {
    return { html, hadQuote: false };
  }
  return { html: remaining, hadQuote: true };
}
