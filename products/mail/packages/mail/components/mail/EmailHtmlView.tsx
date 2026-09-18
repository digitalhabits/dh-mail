"use client";

import * as React from "react";

import {
  MAIL_PINCH_SCALE_EVENT,
  MAIL_PINCH_WHEEL_EVENT,
} from "@/lib/mail/pinch";
import { createPortal } from "react-dom";
import { Copy, ExternalLink, Loader2, Mail } from "lucide-react";
import { toast } from "@/lib/mail/toast";
import { findLinksInText } from "@/lib/linkify-urls";
import {
  MAIL_IMAGE_CSP_SOURCE,
  rewriteRemoteImagesThroughProxy,
} from "@/lib/mail/image-proxy";
import { openExternalUrl } from "@/lib/native-shell";
import { afterMailPaneSlide, mailPaneSliding } from "@/lib/mail/pane-slide";
import { requestMailComposeTo } from "@/lib/mail/compose-to";
import { mailSay, useMailT } from "@/lib/mail/i18n";
import {
  mailLinkMenuModel,
  type MailLinkMenuModel,
} from "@/lib/mail/link-menu";
import {
  MAIL_LINK_BRIDGE_CSP_HASH,
  MAIL_LINK_BRIDGE_JS,
} from "@/lib/mail/link-bridge";

/**
 * Renders untrusted email HTML safely.
 *
 * - The HTML is sanitized against an element and attribute blocklist. Scripts,
 *   embeds, forms, event handlers and javascript: URLs cannot survive it.
 * - It is shown in an iframe, which keeps the sender's CSS and layout away
 *   from the app.
 * - A CSP <meta> inside that frame stops code from running. `default-src
 *   'none'` refuses everything, and `script-src` names the sha256 of one
 *   script: the link bridge below.
 * - The same CSP refuses every network fetch — tracking pixels, remote CSS
 *   backgrounds — until the reader asks for images.
 *
 * The sandbox attribute is not what stops code here, and this comment said
 * for a while that it was. The frame needs `allow-scripts` for the link
 * bridge, and `allow-same-origin` so the height can be measured from
 * `contentDocument`. Those two together leave the frame same-origin with this
 * page, which is also what lets find-in-thread read it. So the hash in
 * `script-src` is the control that keeps anything the sanitizer missed from
 * running. `MAIL_LINK_BRIDGE_JS` and its hash live in `lib/mail/link-bridge`,
 * where a suite checks that they still agree: a drift between them disables
 * the bridge, and it is the pin that would have moved.
 */

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

/** Carries a mail link URL on a <span> so HTML5 parse cannot strip it. */
import {
  MAIL_HREF_ATTR,
  MAIL_PLAIN_LINK_ATTR,
  softenAnchorsForParse,
} from "@/lib/mail/soften-anchors";

export { softenAnchorsForParse };

/** @deprecated Use softenAnchorsForParse — kept for any older imports. */
export function demoteNestedAnchors(html: string): string {
  return softenAnchorsForParse(html);
}

/**
 * Realm-safe Element check. Parent-page `instanceof Element` is false for
 * iframe nodes (separate JS globals). Prefer nodeType — works across realms
 * even when `view` is missing.
 */
function asElement(node: EventTarget | null): Element | null {
  if (!node || typeof (node as Node).nodeType !== "number") return null;
  if ((node as Node).nodeType !== 1) return null;
  return node as Element;
}

/** postMessage payload from the srcdoc click bridge. */
const MAIL_OPEN_MSG_SOURCE = "dh-mail";
const MAIL_OPEN_MSG_TYPE = "open-url";


/**
 * Follow a link from a message.
 *
 * An address opens our own composer, not whatever mail client the machine
 * would otherwise start. This app is the mail client.
 */
async function followMailLink(target: string): Promise<void> {
  if (/^mailto:/i.test(target)) {
    // A mailto can carry ?subject=… and more. Only the address is taken.
    const address = target.slice("mailto:".length).split("?")[0];
    requestMailComposeTo(decodeURIComponent(address));
    return;
  }
  const ok = await openExternalUrl(target);
  if (!ok) toast.error(mailSay("couldNotOpenLink"));
}

/**
 * Resolve what a link points at: an http(s) URL, or a `mailto:` address.
 *
 * Works on an <a href> and on a softened mail link span alike.
 */
function linkTargetFromEl(el: Element): string | null {
  const raw = (
    el.getAttribute("href") ||
    el.getAttribute(MAIL_HREF_ATTR) ||
    ""
  ).trim();
  if (!raw || raw.startsWith("#")) return null;
  if (/^mailto:/i.test(raw)) return raw;
  // about:srcdoc is a useless base for relative URLs — use the parent origin.
  const base =
    !el.baseURI || el.baseURI === "about:srcdoc"
      ? window.location.href
      : el.baseURI;
  try {
    const abs = new URL(raw, base).href;
    if (/^https?:/i.test(abs)) return abs;
  } catch {
    /* ignore invalid */
  }
  if (el.tagName === "A") {
    const href = (el as HTMLAnchorElement).href;
    return href && /^https?:/i.test(href) ? href : null;
  }
  return null;
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
    const text = (el.textContent ?? "").trim();
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

const PREVIEW_INLINE_TAGS = new Set([
  "b",
  "strong",
  "i",
  "em",
  "a",
  "u",
  "s",
  "strike",
  "code",
]);

/**
 * Compact HTML for collapsed-thread previews: keep bold/italic/links, flatten
 * the rest to text so line-clamp works without a full iframe.
 */
export function emailHtmlPreviewSnippet(html: string): string {
  if (typeof window === "undefined") return "";
  const { html: trimmed } = stripQuotedHtml(html);
  const doc = new DOMParser().parseFromString(
    sanitizeEmailHtml(trimmed),
    "text/html"
  );
  if (!doc.body) return "";

  for (const el of doc.body.querySelectorAll("img, svg, style, script, hr")) {
    el.remove();
  }
  for (const br of doc.body.querySelectorAll("br")) {
    br.replaceWith(doc.createTextNode(" "));
  }
  for (const block of doc.body.querySelectorAll(
    "div, p, li, tr, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th"
  )) {
    block.append(doc.createTextNode(" "));
  }

  // Unwrap everything that isn't a simple emphasis/link tag.
  for (const el of [...doc.body.querySelectorAll("*")].reverse()) {
    const tag = el.tagName.toLowerCase();
    const mailHref = el.getAttribute(MAIL_HREF_ATTR);
    if (mailHref && !UNSAFE_URL_RE.test(mailHref)) {
      const a = doc.createElement("a");
      a.setAttribute("href", mailHref);
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noreferrer noopener");
      while (el.firstChild) a.appendChild(el.firstChild);
      el.replaceWith(a);
      continue;
    }
    if (PREVIEW_INLINE_TAGS.has(tag)) {
      if (tag === "a") {
        const href = el.getAttribute("href");
        for (const attr of [...el.attributes]) el.removeAttribute(attr.name);
        if (href && !UNSAFE_URL_RE.test(href)) {
          el.setAttribute("href", href);
          el.setAttribute("target", "_blank");
          el.setAttribute("rel", "noreferrer noopener");
        }
      } else {
        for (const attr of [...el.attributes]) el.removeAttribute(attr.name);
      }
      continue;
    }
    while (el.firstChild) el.parentNode?.insertBefore(el.firstChild, el);
    el.remove();
  }

  return (doc.body.innerHTML || "").replace(/\s+/g, " ").trim();
}

function buildSrcDoc(
  sanitized: string,
  allowImages: boolean,
  origin: string,
  imageMaxHeight?: number,
  bodyColor?: string
): string {
  // Remote images are rewritten to the same-origin proxy when allowed, so the
  // iframe never hits CORP/hotlink blocks on the sender's CDN. data: (cid)
  // images stay inlined and always allowed.
  const body = allowImages
    ? rewriteRemoteImagesThroughProxy(sanitized, origin)
    : sanitized;
  // allow-scripts is only for MAIL_LINK_BRIDGE_JS (hash-pinned). Email HTML is
  // sanitized and still cannot load remote scripts (default-src 'none').
  const imgSrc = allowImages
    ? `img-src ${MAIL_IMAGE_CSP_SOURCE} data:;`
    : "img-src data:;";
  const csp = `default-src 'none'; ${imgSrc} style-src 'unsafe-inline'; script-src '${MAIL_LINK_BRIDGE_CSP_HASH}'`;
  return [
    // data-dh-mail marks our document, so the reader can tell the new frame
    // from the one it replaces while srcDoc swaps.
    '<!doctype html><html data-dh-mail="1"><head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    '<meta name="referrer" content="no-referrer">',
    '<base target="_blank">',
    "<style>",
    // Prefer auto height (thread pane scrolls). Keep overflow-y auto as a
    // fallback if measurement still undershoots a marketing footer.
    /*
      No scrollbars in here. The frame is sized to its content and the
      thread does the scrolling; a bar inside a message is a bar drawn
      across the foot and up the right of every card, which is what it was
      — two pale rules that no colour of ours could reach, because a
      scrollbar is painted by the platform.

      `overflow-x:auto` stays for a table wider than the pane, but its bar
      is hidden too: it can be dragged sideways with a trackpad, and a
      permanent gutter costs every message to serve the few that are wide.
    */
    "html,body{margin:0;overflow-x:auto;overflow-y:hidden;scrollbar-width:none}",
    "html::-webkit-scrollbar,body::-webkit-scrollbar{width:0;height:0;display:none}",
    ...(bodyColor ? ["html{color-scheme:dark}"] : []),
    /*
      `overflow-wrap`, not `word-break:break-word`.

      They read as the same wish — do not let one long unbreakable string
      run off the side — and they are not. `word-break:break-word` is the
      deprecated spelling of `overflow-wrap:anywhere`, and `anywhere` counts
      towards how narrow a box may be squeezed: a table column may then be
      one letter wide. A mail from GitHub laid out as a table came through
      with its Status heading spelled down the page, one letter per line,
      because the column had been allowed to shrink that far.

      `overflow-wrap:break-word` breaks the same long string, and leaves a
      column's natural minimum alone. Measured on a table three columns
      wide in a 150px box: the heading kept 53px and one line under this
      rule, and was cut to 37px and two lines under the other.
    */
    `body{padding:12px 14px 20px;font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${bodyColor ?? "#292524"};overflow-wrap:break-word;background:transparent}`,
    /*
      Links may break anywhere, and only links.

      `break-word` above breaks a long string when it is drawn but does not
      count the break when the box is measured, so a message with a
      tracking link three hundred characters long measured as three
      hundred characters wide. The bubble was given that width, the pane
      could not, and the whole message was scaled down to fit the link —
      a body of tiny text that no zoom could enlarge, because the zoom was
      being cancelled to fit the same link. `anywhere` counts the break,
      so the link no longer sets the message's width. Only on links: the
      table-column reason above still holds for everything else, and a
      string that long in ordinary text is rare.

      A link in a message is not an <a> by the time it is drawn: every one
      is softened to a span before the parser sees it (see soften-anchors),
      so the rule has to name the span. Written for <a> alone it matched
      nothing, and a message from a Windows Live Mail sender with one long
      Google link measured 1383px at its narrowest — and was scaled down to
      fit it, at every zoom. With the span named it measures 428px.
    */
    `a,[${MAIL_HREF_ATTR}]{overflow-wrap:anywhere}`,
    "img{max-width:100%;height:auto}",
    // A view with a ceiling of its own — the peek at the first message —
    // asks for a ceiling on the pictures too. A screenshot pasted into an
    // issue is a few hundred pixels wide and a thousand tall, and at full
    // height it is the whole of a short view with none of the words.
    ...(imageMaxHeight
      ? [`img{max-height:${imageMaxHeight}px;width:auto;object-fit:contain}`]
      : []),
    // Softened mail CTAs (see softenAnchorsForParse) — keep button styling.
    `[${MAIL_HREF_ATTR}]{cursor:pointer;color:inherit;text-decoration:inherit}`,
    /*
      A link should look like one.

      Two kinds reach this point unstyled. The bare addresses we found in
      the text ourselves, which are still real anchors — every link the
      sender wrote became a span above, so `a` can only be ours. And the
      ones the sender wrote but never dressed, marked while softening.

      Both get the teal the rest of the app underlines a link in, and
      neither can reach a sender's button: that keeps whatever it was
      given. After the rule above, so it wins on equal specificity.
    */
    `a,[${MAIL_PLAIN_LINK_ATTR}]{color:${
      bodyColor ? "#5ecfbe" : "#0d7a6f"
    };text-decoration:underline;text-underline-offset:2px}`,
    // Reading in the dark: the body's own colour is the light one the
    // caller passes, and every colour the sender declared is re-lit by
    // `recolorEmailForDark` once the frame has laid out — see there. That
    // used to be a blanket "everything inherits", which threw away a
    // heading's navy and a call-out's pink along with the black.
    "</style>",
    "</head><body>",
    body,
    `<script>${MAIL_LINK_BRIDGE_JS}</script>`,
    "</body></html>",
  ].join("");
}

/**
 * Frame height for auto-sized email iframes.
 * `body.getBoundingClientRect().height` alone drops trailing margins on
 * marketing footers (Outlook tables), which clips the last few pixels.
 */
/**
 * The scrolling box a frame sits in — the thread stream, usually.
 *
 * Measuring collapses the frame for a moment (see `measure`), and a
 * collapsed frame is a shorter thread. The browser clamps the scroll to a
 * shorter thread at once and does not put it back when the height returns,
 * so the measurement has to hold the place itself.
 */
function scrollParentOf(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node) {
    const overflow = window.getComputedStyle(node).overflowY;
    if (
      (overflow === "auto" || overflow === "scroll") &&
      node.scrollHeight > node.clientHeight
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

function measureEmailFrameHeight(doc: Document): number {
  const body = doc.body;
  if (!body) return 0;
  const win = doc.defaultView;
  const bodyTop = body.getBoundingClientRect().top;
  let bottom = body.getBoundingClientRect().bottom;

  const include = (el: Element) => {
    const rect = el.getBoundingClientRect();
    const marginBottom = win
      ? parseFloat(win.getComputedStyle(el).marginBottom) || 0
      : 0;
    bottom = Math.max(bottom, rect.bottom + marginBottom);
  };

  for (const child of body.children) include(child);

  // Nested trailing margins (table > tbody > tr > td > …).
  let el: Element | null = body.lastElementChild;
  while (el) {
    include(el);
    el = el.lastElementChild;
  }

  /*
    And whatever the frame says it can scroll.

    The rect walk above measures boxes; `scrollHeight` measures the whole
    of what is laid out, and it is the exact quantity that decides whether
    a scrollbar appears. Taking the larger of the two is what keeps one
    from appearing: the rect walk catches trailing margins that
    scrollHeight rounds off, and scrollHeight catches everything the rect
    walk cannot see.

    The two are not read in the same units. The reader's size is a `zoom`
    on the body, and `scrollHeight` on a zoomed element answers in that
    element's own scale, while everything else here — the rects, the root,
    the frame being sized — is in the frame's. Below 100% the body's
    unscaled number is the larger of the two while being the shorter
    distance, so it won every comparison and the frame came out as much
    too tall as the reader had zoomed out: at 80%, a quarter of the
    message again in empty space under the footer. At 100% the two agree,
    which is why it only ever showed on one side of it.
  */
  const bodyZoom = parseFloat(body.style.zoom) || 1;
  const scrolled = Math.max(
    doc.documentElement?.scrollHeight ?? 0,
    (body.scrollHeight ?? 0) * bodyZoom
  );

  const content = Math.max(bottom - bodyTop, scrolled);
  /*
    Nothing measured is not a short message.

    A frame asked for its height before it has laid out answers zero, and
    zero plus the slack below is six — small enough to look like a bug and
    large enough to pass the `> 0` test that was meant to catch exactly
    this. So the caller keeps the height it had and waits for the observer.
  */
  if (content <= 0) return 0;

  // Slack for sub-pixels and collapsed margins so the footer never clips.
  return Math.ceil(content + 6);
}

/*
 * Reading a sender's mail in the dark.
 *
 * A message is written for a white page. Its black words, its navy
 * headings, its pale pink call-out box are all choices made against white,
 * and putting them on a dark card as they are gives dark words on a dark
 * card. The answer every mail client has settled on — Outlook, Apple Mail,
 * Gmail — is not to protect the white page but to re-light the message:
 * flip the light backgrounds dark, lift the dark text light, and leave
 * alone the colours that already read either way.
 *
 * Done to the computed colours, from outside the frame, once it has laid
 * out. Computed rather than declared, because a colour can arrive by
 * `bgcolor=`, by inheritance, by a class in a `<style>` block, and the
 * result is what matters. Written back inline with `!important`, which
 * outranks anything the sender wrote.
 *
 * The rules, in HSL:
 *
 *   background, near-grey and light  → dark. White becomes the card's
 *                                      shade, a light grey a step above it,
 *                                      so a table with alternating rows
 *                                      keeps its rows.
 *   background, coloured and pale    → the same hue, dusky and dark: a pale
 *                                      pink box becomes a deep rose one.
 *   background, coloured and strong  → left. A brand's green band or blue
 *                                      button is legible on anything and is
 *                                      the sender's own mark.
 *   text, dark                       → light, keeping the hue: black to
 *                                      near-white, navy to a light blue.
 *   text, mid grey                   → lifted, so a footnote is readable.
 *   text, light                      → left; it was written for the coloured
 *                                      band it sits on.
 *   borders                          → as backgrounds.
 *   pictures                         → untouched. A logo on a white PNG
 *                                      stays a white PNG; so does Outlook's.
 *
 * A mail that carries its own dark styles — `prefers-color-scheme` in a
 * style block, or a `color-scheme` meta — is left to them and not
 * re-lit twice.
 */

type Hsl = { h: number; s: number; l: number; a: number };

function parseCssColor(value: string): Hsl | null {
  const m = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/i);
  if (!m) return null;
  const r = Number(m[1]) / 255;
  const g = Number(m[2]) / 255;
  const b = Number(m[3]) / 255;
  let a = 1;
  if (m[4] != null) a = m[4].endsWith("%") ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let sat = 0;
  if (max !== min) {
    const d = max - min;
    sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h, s: sat, l, a };
}

function hslToCss({ h, s, l, a }: Hsl): string {
  const H = Math.round(h * 360);
  const S = Math.round(s * 100);
  const L = Math.round(l * 100);
  return a < 1 ? `hsla(${H},${S}%,${L}%,${a})` : `hsl(${H},${S}%,${L}%)`;
}

/** The lightness the card is: what white becomes. */
const DARK_PAGE_L = 0.16;

function darkBackground(c: Hsl): Hsl | null {
  if (c.a === 0) return null;
  if (c.s < 0.28) {
    // Near-grey. Only the light ones move; a dark grey box was already
    // designed for the dark.
    if (c.l < 0.55) return null;
    // White → the page shade; light greys step up from it in the same
    // order they stepped down from white, so stripes stay stripes.
    return { ...c, s: Math.min(c.s, 0.12), l: DARK_PAGE_L + (1 - c.l) * 0.28 };
  }
  // Coloured. Pale tints — a pink call-out, a mint banner — go dusky and
  // dark in the same hue; strong colours are the sender's own and stay.
  if (c.l >= 0.72) return { ...c, s: c.s * 0.5, l: 0.24 + (1 - c.l) * 0.35 };
  return null;
}

function darkText(c: Hsl): Hsl | null {
  if (c.a === 0) return null;
  if (c.s < 0.3) {
    // Grey words. Near-black goes near-white; a mid grey — a footnote, a
    // timestamp — is unreadable on a dark card at the lightness it was
    // given for a white one, and comes up too.
    if (c.l <= 0.45) return { ...c, l: Math.max(0.88, 1 - c.l) };
    if (c.l < 0.66) return { ...c, l: 0.74 };
    return null;
  }
  // Coloured words: a navy heading, the blue of a link. Lightness alone
  // undersells how dark a saturated blue is — pure #0000ee is L 0.47 and
  // all but invisible on navy — so anything under 0.6 comes up to a light
  // tint of its own hue, and keeps it.
  if (c.l < 0.6) return { ...c, s: Math.min(c.s, 0.75), l: Math.max(0.74, 1 - c.l) };
  return null;
}

function darkBorder(c: Hsl): Hsl | null {
  if (c.a === 0) return null;
  if (c.s < 0.3 && c.l >= 0.5) return { ...c, s: Math.min(c.s, 0.1), l: 0.32 };
  return null;
}

/** Elements whose colours are their own business. */
const RECOLOR_SKIP = new Set(["IMG", "SVG", "VIDEO", "CANVAS", "PICTURE", "SOURCE", "SCRIPT", "STYLE"]);

export function recolorEmailForDark(doc: Document): void {
  const win = doc.defaultView;
  if (!win || !doc.body) return;
  // A mail that already knows about the dark is left to its own styles.
  const declares =
    doc.querySelector('meta[name="color-scheme"]') != null ||
    [...doc.querySelectorAll("style")].some((s) => /prefers-color-scheme\s*:\s*dark/i.test(s.textContent ?? ""));
  if (declares) {
    doc.documentElement.style.setProperty("color-scheme", "dark");
    return;
  }
  /**
   * What each element's background was before this darkened it.
   *
   * Pictures are left alone here — a photograph recoloured is a photograph
   * ruined — but a picture was drawn for the colour behind it, and that
   * colour is about to stop existing. Keeping the old one is what lets a
   * logo have it back.
   */
  const wasLight = new Map<HTMLElement, string>();
  const all = doc.body.querySelectorAll<HTMLElement>("*");
  for (const el of all) {
    if (RECOLOR_SKIP.has(el.tagName)) continue;
    // Inside an SVG the tag names are lower-case and the colours are fills.
    if (el.namespaceURI && el.namespaceURI !== "http://www.w3.org/1999/xhtml") continue;
    const cs = win.getComputedStyle(el);
    const bg = parseCssColor(cs.backgroundColor);
    if (bg) {
      const next = darkBackground(bg);
      if (next) {
        if (bg.l > 0.6) wasLight.set(el, hslToCss(bg));
        el.style.setProperty("background-color", hslToCss(next), "important");
      }
    }
    const fg = parseCssColor(cs.color);
    if (fg) {
      const next = darkText(fg);
      if (next) el.style.setProperty("color", hslToCss(next), "important");
    }
    // Only a border that is actually drawn.
    if (cs.borderTopStyle !== "none" && parseFloat(cs.borderTopWidth) > 0) {
      const bc = parseCssColor(cs.borderTopColor);
      const next = bc && darkBorder(bc);
      if (next) el.style.setProperty("border-color", hslToCss(next), "important");
    }
  }

  backPicturesWithTheirOwnGround(doc, wasLight);
}

/**
 * Give a picture back the colour it was drawn against.
 *
 * A wordmark at the head of a newsletter is a PNG with a transparent
 * ground: the sender drew it dark because their mail is on white. Darken
 * the white and the letters are still there and still dark, on almost the
 * same dark — legible only by selecting them. Recolouring the picture
 * itself is not the answer, because a picture is not text and the same
 * treatment that rescues a logo ruins a photograph.
 *
 * So the picture keeps the ground it expected. Where a picture is opaque —
 * every photograph — this cannot be seen at all: it is behind the pixels.
 * It shows only through transparency, which is exactly where the sender was
 * relying on a colour that this reader no longer has.
 *
 * Only small ones, which is where the fault bites and where being wrong
 * costs least. A hero image with soft corners would show a pale edge, and
 * it is not the thing anybody is failing to read.
 */
const LOGO_MAX_HEIGHT_PX = 160;
/**
 * Under this in either direction it is not a picture, it is a measurement.
 *
 * Mail is full of images that are not pictures: the 1px transparent GIF
 * that opens a message's read receipt, and the spacer stretched across a
 * table to hold a column open. Giving one of those the ground it was drawn
 * against paints a white rule straight across the message — which is what
 * it did, on the first evening it shipped.
 */
const LOGO_MIN_SIDE_PX = 12;

/** The gutter `.mail-bubble-column` keeps beside itself — see mail.css. */
const BUBBLE_GUTTER_PX = 14;

/**
 * How much room the bubble would have at 100%, in the bubble's own pixels.
 *
 * At rest, deliberately, because this decides the size a mail is *started*
 * at and not the size it is held to. Measured at the size currently shown,
 * the room shrinks exactly as fast as the reader zooms — every pixel asked
 * for came back off the room — so the mail stayed pinned to the pane and
 * the zoom control did nothing at all for it.
 *
 * The column's parent gives it: full-width, so it measures the pane, and
 * the same in screen pixels whatever the stream is zoomed to.
 *
 * Not `getComputedStyle().maxWidth` on the column, which hands back the
 * `min()` expression as written rather than a length — it parsed as
 * nothing, every mail read as having room enough, and the scaling this
 * feeds never ran at all.
 */
function roomAtRest(column: HTMLElement, chrome: number): number {
  const parent = column.parentElement;
  const width = parent?.getBoundingClientRect().width ?? 0;
  if (!(width > 0)) return Number.POSITIVE_INFINITY;
  return width - BUBBLE_GUTTER_PX - chrome;
}

/**
 * What the bubble puts around the frame: borders and padding, added up.
 *
 * Not the difference between the column's width and the frame's, which is
 * what this was first. That is the border only when the mail happens to
 * fill the column; for anything narrower it is the empty space beside the
 * message, which is hundreds of pixels, and which moves when the mail is
 * resized. Used as the chrome it made the room look far too small, so a
 * mail with a whole pane to spread into was scaled down anyway — and since
 * it moved with the answer it fed, it never settled.
 *
 * Borders and padding do not move. They are also already in the column's
 * own pixels, zoom or no zoom: a 1px border computes as 1px whatever it is
 * painted at.
 */
function chromeAroundFrame(frame: HTMLElement, column: HTMLElement): number {
  let total = 0;
  let node: HTMLElement | null = frame.parentElement;
  while (node) {
    const styles = window.getComputedStyle(node);
    total +=
      (parseFloat(styles.borderLeftWidth) || 0) +
      (parseFloat(styles.borderRightWidth) || 0) +
      (parseFloat(styles.paddingLeft) || 0) +
      (parseFloat(styles.paddingRight) || 0);
    if (node === column) break;
    node = node.parentElement;
  }
  return total;
}

function backPicturesWithTheirOwnGround(
  doc: Document,
  wasLight: Map<HTMLElement, string>
): void {
  if (wasLight.size === 0) return;
  const ground = (img: HTMLElement): string | null => {
    let node: HTMLElement | null = img.parentElement;
    while (node) {
      const found = wasLight.get(node);
      if (found) return found;
      node = node.parentElement;
    }
    return null;
  };
  const win = doc.defaultView;
  for (const img of doc.images) {
    const behind = ground(img);
    if (!behind) continue;
    const apply = () => {
      const box = img.getBoundingClientRect();
      const height = box.height;
      if (height <= 0 || height > LOGO_MAX_HEIGHT_PX) return;
      // Not a spacer, a tracking pixel, or a hairline rule.
      if (height < LOGO_MIN_SIDE_PX || box.width < LOGO_MIN_SIDE_PX) return;
      if (img.naturalWidth <= 2 || img.naturalHeight <= 2) return;
      img.style.setProperty("background-color", behind, "important");
      /*
        A little beyond its own edges, and rounded, so it reads as a card
        the mark is standing on rather than as the picture being cut out of
        the page. The spread goes on a shadow rather than on padding: this
        runs after the mail is laid out, and padding would move everything
        under it a few pixels down.
      */
      img.style.setProperty("box-shadow", `0 0 0 3px ${behind}`, "important");
      img.style.setProperty("border-radius", "3px", "important");
    };
    /*
      After a layout, not before one.

      This runs as the document is set up, which is before anything in it
      has been placed, so every picture measured nought high — the test for
      "small enough to be a logo" threw all of them away, including the one
      it was written for. A frame later they have their sizes.
    */
    if (img.complete && img.naturalWidth > 0) {
      if (win) win.requestAnimationFrame(apply);
      else apply();
    } else {
      img.addEventListener(
        "load",
        () => {
          if (win) win.requestAnimationFrame(apply);
          else apply();
        },
        { once: true }
      );
    }
  }
}

/**
 * Pinches over the sandboxed iframe never reach the thread pane's listeners,
 * so forward them to the parent window (as raw wheel deltas / scale ratios)
 * for the mail zoom to consume. Listeners run in the parent context — the
 * iframe itself stays script-free.
 */
function attachPinchForwarding(doc: Document, frame: HTMLIFrameElement) {
  /*
    Where the fingers are, in the parent's pixels.

    The zoom holds the point under the pointer still, and the pointer is in
    here, so the point has to travel with the gesture. The frame is sized to
    its own content, so a y down the frame's viewport is the same fraction
    of the frame element in the parent, whatever either one is zoomed by.
  */
  const parentY = (frameY: number): number | null => {
    const box = frame.getBoundingClientRect();
    const viewport = doc.defaultView?.innerHeight || 0;
    if (!viewport || !box.height) return null;
    return box.top + (frameY / viewport) * box.height;
  };

  const wheelOpts: AddEventListenerOptions = { passive: false, capture: true };
  doc.addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey) return; // plain scrolling, not a pinch
      e.preventDefault();
      window.dispatchEvent(
        new CustomEvent(MAIL_PINCH_WHEEL_EVENT, {
          detail: { value: e.deltaY, y: parentY(e.clientY) },
        })
      );
    },
    wheelOpts
  );

  // WebKit (Safari, the Mac app's webview) reports pinches as gesture events.
  let lastScale = 1;
  const gestureOpts: AddEventListenerOptions = { capture: true, passive: false };
  doc.addEventListener(
    "gesturestart",
    ((e: Event) => {
      e.preventDefault();
      lastScale = (e as Event & { scale?: number }).scale ?? 1;
    }) as EventListener,
    gestureOpts
  );
  doc.addEventListener(
    "gesturechange",
    ((e: Event) => {
      e.preventDefault();
      const scale = (e as Event & { scale?: number }).scale ?? 1;
      if (lastScale > 0) {
        const at = (e as Event & { clientY?: number }).clientY;
        window.dispatchEvent(
          new CustomEvent(MAIL_PINCH_SCALE_EVENT, {
            detail: {
              value: scale / lastScale,
              y: typeof at === "number" ? parentY(at) : null,
            },
          })
        );
      }
      lastScale = scale;
    }) as EventListener,
    gestureOpts
  );
}

/**
 * Keystrokes inside the iframe reach the app's shortcuts.
 *
 * The shortcut listeners live on the top window, and a click on the email
 * body gives the iframe's document the keyboard — after which every key
 * fires in here and the app hears nothing. WebKit is also reluctant to
 * hand focus back when the next click lands on something in the parent
 * that is not focusable, so the dead zone was bigger than the message.
 *
 * The keys are re-dispatched on the parent window as synthetic keyboard
 * events, the same bridge the pinch uses. A synthetic event cannot cancel
 * what the key does inside the iframe, and should not: copy, arrows and
 * text selection keep their meanings — the app's own guard ignores keys
 * typed into fields, and a field inside a message is left alone here too.
 */
function attachKeyForwarding(doc: Document) {
  doc.addEventListener(
    "keydown",
    (e) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) {
        return;
      }
      const consumed = !window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: e.key,
          code: e.code,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          altKey: e.altKey,
          shiftKey: e.shiftKey,
          repeat: e.repeat,
          cancelable: true,
        })
      );
      // The app took the key, so its default in here must not also run —
      // some shortcuts ride keys the webview has plans for (Cmd+R would
      // reload the whole app on top of opening the reply). dispatchEvent
      // runs the parent's listeners synchronously and reports whether one
      // of them called preventDefault, so the answer is already in hand.
      if (consumed) e.preventDefault();
    },
    { capture: true }
  );
}

/**
 * Meet / RSVP / etc. in invite HTML are normal <a> tags. Tauri's WebView
 * silently drops target=_blank navigations that originate inside an iframe,
 * and the shell's document-level click hook never sees iframe clicks — so
 * open http(s) links from the parent via the opener plugin (or window.open).
 */
function attachExternalLinkHandling(doc: Document) {
  // Backup when the in-frame bridge is blocked; WKWebView often skips this.
  doc.addEventListener(
    "click",
    (event) => {
      // composedPath survives nested SVG/table quirks better than closest alone.
      const path = event.composedPath();
      let el: Element | null = null;
      for (const node of path) {
        const candidate = asElement(node);
        if (!candidate) continue;
        if (candidate.tagName === "A" && candidate.hasAttribute("href")) {
          el = candidate;
          break;
        }
        if (candidate.hasAttribute(MAIL_HREF_ATTR)) {
          el = candidate;
          break;
        }
      }
      if (!el) {
        const target = asElement(event.target);
        el = target?.closest(`a[href], [${MAIL_HREF_ATTR}]`) ?? null;
      }
      if (!el) return;
      const target = linkTargetFromEl(el);
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      void followMailLink(target);
    },
    true
  );
}

/** A right-click on a link, in the frame's own coordinates. */
type LinkMenuRequest = {
  target: string;
  /** Pointer position in the frame's viewport, before the frame's zoom. */
  frameX: number;
  frameY: number;
};

/**
 * The right-click menu on a link.
 *
 * Every link in the frame is a span (see `softenAnchorsForParse`), so the
 * browser's own menu treats it as text: Look Up, Translate, Search — and no
 * Copy Link, which is the one thing a reader right-clicks a link for. So the
 * frame takes the event over on links, and only there. Right-click on plain
 * text keeps the browser's menu, which is good and which nothing here would
 * improve on.
 *
 * A link inside a selection the reader made is treated as text too: they
 * selected it, so the selection is what they mean. That is decided on
 * mousedown, because WebKit selects the word under a right-click before it
 * fires `contextmenu`, and by then every link looks selected. The same
 * snapshot puts the selection back the way it was once the menu is ours, so
 * the word does not stay highlighted under it.
 */
function attachLinkContextMenu(
  doc: Document,
  onRequest: (request: LinkMenuRequest) => void,
  onDismiss: () => void
) {
  const linkFromEvent = (event: Event): Element | null => {
    for (const node of event.composedPath()) {
      const candidate = asElement(node);
      if (!candidate) continue;
      if (candidate.tagName === "A" && candidate.hasAttribute("href")) {
        return candidate;
      }
      if (candidate.hasAttribute(MAIL_HREF_ATTR)) return candidate;
    }
    const target = asElement(event.target);
    return target?.closest(`a[href], [${MAIL_HREF_ATTR}]`) ?? null;
  };

  let selectionBefore: Range[] = [];
  let linkWasSelected = false;

  doc.addEventListener(
    "mousedown",
    (event) => {
      // Any press closes a menu that is open; a right-click on a link opens
      // a new one a moment later, through `contextmenu`.
      onDismiss();
      const secondary =
        event.button === 2 || (event.button === 0 && event.ctrlKey);
      if (!secondary) return;
      const sel = doc.getSelection();
      selectionBefore = [];
      linkWasSelected = false;
      if (!sel || sel.isCollapsed) return;
      for (let i = 0; i < sel.rangeCount; i += 1) {
        selectionBefore.push(sel.getRangeAt(i).cloneRange());
      }
      const link = linkFromEvent(event);
      if (link) {
        linkWasSelected = selectionBefore.some((range) =>
          range.intersectsNode(link)
        );
      }
    },
    true
  );

  doc.addEventListener("scroll", onDismiss, true);
  doc.addEventListener("wheel", onDismiss, { capture: true, passive: true });

  doc.addEventListener(
    "contextmenu",
    (event) => {
      const link = linkFromEvent(event);
      if (!link || linkWasSelected) return;
      const target = linkTargetFromEl(link);
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      // The word WebKit selected under the pointer goes back to whatever was
      // selected before, which is usually nothing.
      const sel = doc.getSelection();
      if (sel) {
        sel.removeAllRanges();
        for (const range of selectionBefore) sel.addRange(range);
      }
      onRequest({ target, frameX: event.clientX, frameY: event.clientY });
    },
    true
  );
}

/** Put text on the clipboard, one way or another. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* fall through to the old way */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * The menu itself, in the page over the frame.
 *
 * Placed at the pointer and clamped to the window, like the folder menu in
 * the rail. The destination is the first row and is not a button: it is
 * there to be read. People right-click a link partly to see where it really
 * goes, and a mail client that softens every anchor owes them that.
 */
function LinkContextMenu({
  model,
  x,
  y,
  onDismiss,
}: {
  model: MailLinkMenuModel;
  x: number;
  y: number;
  onDismiss: () => void;
}) {
  const t = useMailT();
  const ref = React.useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = React.useState({ left: x, top: y });

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    setPlaced({
      left: Math.max(8, Math.min(x, window.innerWidth - box.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - box.height - 8)),
    });
  }, [x, y]);

  React.useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (ref.current?.contains(event.target as Node)) return;
      onDismiss();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onDismiss, true);
    window.addEventListener("blur", onDismiss);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onDismiss, true);
      window.removeEventListener("blur", onDismiss);
    };
  }, [onDismiss]);

  const OpenIcon = model.kind === "mailto" ? Mail : ExternalLink;
  const item =
    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-stone-800 hover:bg-stone-100";

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={t("link")}
      style={{ left: placed.left, top: placed.top }}
      /* Portalled, so its events travel up the React tree rather than the
         DOM: without this a click in here reaches the message view around
         it, whose double-click opens the thread in a window. */
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      className="mail-light-surface fixed z-50 w-max max-w-[min(28rem,calc(100vw-1rem))] rounded-lg border border-stone-200 bg-white py-1 shadow-lg"
    >
      <div
        className="truncate px-3 pb-1.5 pt-1 text-xs text-stone-500"
        title={model.target}
      >
        {model.shown}
      </div>
      <div className="mb-1 border-t border-stone-200" />
      <button
        type="button"
        role="menuitem"
        autoFocus
        className={item}
        onClick={() => {
          onDismiss();
          void followMailLink(model.target);
        }}
      >
        <OpenIcon className="h-3.5 w-3.5 shrink-0 text-stone-500" aria-hidden />
        {model.openLabel}
      </button>
      <button
        type="button"
        role="menuitem"
        className={item}
        onClick={() => {
          onDismiss();
          void copyText(model.copyText).then((ok) => {
            if (ok) toast(model.kind === "mailto" ? "Address copied" : "Link copied");
            else toast.error(mailSay("couldNotCopy"));
          });
        }}
      >
        <Copy className="h-3.5 w-3.5 shrink-0 text-stone-500" aria-hidden />
        {model.copyLabel}
      </button>
    </div>,
    document.body
  );
}

/**
 * A double-click on the sender's page, forwarded out of the frame.
 *
 * The bubble shows its details when it is double-clicked, and the body of
 * an HTML message is a frame, so a double-click on the words, which is
 * most of the bubble, never reaches the handler outside it. This carries
 * it out. Double-clicks inside the sandboxed iframe never bubble to React
 * parents, and WebKit/Tauri is also flaky with dblclick on srcdoc frames,
 * so a second click within a short window counts as well as the native
 * dblclick event.
 *
 * Not on something that does its own job: a link, a button, a field the
 * sender put there. `instanceof Element` is no use for that test, the
 * frame is a separate global, so `asElement` does the narrowing.
 */
function attachDoubleClickForwarding(
  doc: Document,
  onDoubleClick: () => void
) {
  const INTERACTIVE =
    `a[href], [${MAIL_HREF_ATTR}], button, input, select, textarea, label,` +
    ` [role='button'], [role='link'], [contenteditable='true']`;
  let lastClickAt = 0;
  let lastFireAt = 0;
  const isControl = (event: Event) =>
    Boolean(asElement(event.target)?.closest(INTERACTIVE));
  const fire = (event: Event) => {
    if (isControl(event)) return;
    const now = Date.now();
    // Click-pair detector and native dblclick often both fire — only once.
    if (now - lastFireAt < 400) return;
    lastFireAt = now;
    lastClickAt = 0;
    event.preventDefault();
    onDoubleClick();
  };
  doc.addEventListener(
    "click",
    (event) => {
      if (isControl(event)) {
        lastClickAt = 0;
        return;
      }
      const now = Date.now();
      if (now - lastClickAt < 400) {
        fire(event);
        return;
      }
      lastClickAt = now;
    },
    true
  );
  doc.addEventListener("dblclick", fire, true);
}

export function EmailHtmlView({
  html,
  allowImages,
  inlineImages,
  zoom = 1,
  imageMaxHeight,
  bodyColor,
  onContentDoubleClick,
  darkRecolor = false,
}: {
  html: string;
  allowImages: boolean;
  inlineImages?: Record<string, string>;
  /**
   * Tallest a picture may be, in frame pixels.
   *
   * For a view with a ceiling of its own, where a full-height screenshot
   * would fill it and leave no room for the message it came with. Unset in
   * the thread, where a picture is shown at the size it was sent.
   */
  imageMaxHeight?: number;
  /**
   * The color the words take when the HTML names none of its own.
   *
   * Unset means #292524, which is what a sender's mail assumes it is being
   * read on white. A message of your own on the dark theme passes a light
   * one instead: the composer names no colors, so there is nothing to argue
   * with, and the bubble under it can be dark. See `ownWordsInTheDark`.
   */
  bodyColor?: string;
  /**
   * Thread-pane zoom. CSS zoom on an ancestor never reaches an iframe's
   * document properly — WebKit scales the frame's rendered pixels (blurry,
   * and stale after zoom changes), Chromium leaves the content unscaled — so
   * the ancestor zoom is cancelled on the iframe element (zoom: 1/z) and
   * re-applied inside the document, where text re-lays-out crisply.
   */
  zoom?: number;
  /** A double-click on the sender's page — see attachDoubleClickForwarding. */
  onContentDoubleClick?: () => void;
  /** Re-light the sender's colours for a dark card. See recolorEmailForDark. */
  darkRecolor?: boolean;
}) {
  const t = useMailT();
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const onDblClickRef = React.useRef(onContentDoubleClick);
  onDblClickRef.current = onContentDoubleClick;
  const darkRecolorRef = React.useRef(darkRecolor);
  darkRecolorRef.current = darkRecolor;
  const zoomRef = React.useRef(zoom);
  zoomRef.current = zoom;
  const [height, setHeight] = React.useState(140);
  /**
   * The width the content would take if nothing constrained it.
   *
   * Null until measured, and the frame fills the bubble as it always did.
   * Measured, it goes on the frame as its width, so a message of two words
   * takes two words' worth of bubble instead of the whole pane — the same
   * as a plain-text message. A newsletter's fixed 600px table answers
   * 600px and is none the narrower. `max-width: 100%` still caps it, so a
   * wide answer never pushes past the bubble; the document just reflows to
   * what it is given, as it did when the frame was always full width.
   */
  const [naturalWidth, setNaturalWidth] = React.useState<number | null>(null);
  /*
    The size the mail is shown at inside the frame — the reader's zoom,
    less whatever it was scaled by to fit. Kept beside the width so the
    frame is sized from the two without waiting for a measurement: a
    zoom that changed the body but not the frame left a newsletter cut
    off at the frame's edge with its right third out of reach.
  */
  const [bodyZoom, setBodyZoom] = React.useState(1);
  const [linkMenu, setLinkMenu] = React.useState<{
    model: MailLinkMenuModel;
    x: number;
    y: number;
  } | null>(null);
  const dismissLinkMenu = React.useCallback(() => setLinkMenu(null), []);
  /** False until the first iframe paint — avoids an empty cut-off bubble. */
  const [ready, setReady] = React.useState(false);
  /** Only show the spinner if paint is slow — cache reopen should not flash it. */
  const [showPlaceholder, setShowPlaceholder] = React.useState(false);

  const srcDoc = React.useMemo(() => {
    if (typeof window === "undefined") return "";
    return buildSrcDoc(
      sanitizeEmailHtml(html, inlineImages),
      allowImages,
      window.location.origin,
      imageMaxHeight,
      bodyColor
    );
  }, [html, allowImages, inlineImages, imageMaxHeight, bodyColor]);

  React.useEffect(() => {
    if (ready) {
      setShowPlaceholder(false);
      return;
    }
    const timer = window.setTimeout(() => setShowPlaceholder(true), 120);
    return () => window.clearTimeout(timer);
  }, [ready]);

  // In-frame bridge (see MAIL_LINK_BRIDGE_JS) — reliable under Tauri WKWebView.
  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as {
        source?: unknown;
        type?: unknown;
        url?: unknown;
      } | null;
      if (!data || data.source !== MAIL_OPEN_MSG_SOURCE) return;
      if (data.type !== MAIL_OPEN_MSG_TYPE) return;
      if (typeof data.url !== "string") return;
      if (!/^(https?:|mailto:)/i.test(data.url)) return;
      void followMailLink(data.url);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  /** Asks for a measurement on the next frame; set up in `initDoc`. */
  const scheduleMeasureRef = React.useRef<(() => void) | null>(null);

  /** Documents already wired up — a frame is set up once, however we reach it. */
  const initedDocsRef = React.useRef<WeakSet<Document>>(new WeakSet());
  const observerRef = React.useRef<ResizeObserver | null>(null);
  /** Cancels a measurement queued for the frame — see `scheduleMeasure`. */
  const pendingMeasureRef = React.useRef<(() => void) | null>(null);

  /** Returns true when this call did the setup. */
  const initDoc = React.useCallback((doc: Document): boolean => {
    if (!doc.body) return false;
    if (initedDocsRef.current.has(doc)) return false;
    initedDocsRef.current.add(doc);

    doc.body.style.zoom = String(zoomRef.current);
    // Before anything is measured or shown: the recolour changes no
    // geometry, but the reader should never see the white version first.
    if (darkRecolorRef.current) recolorEmailForDark(doc);
    const measure = () => {
      // Not while the pane is sliding: its width is wrong on every frame
      // of the slide, and a ceiling read from it stuck the mail small
      // until something else moved. One reading at the end says the
      // same thing. The observer below already waits; the first
      // measure, the zoom's, and the timer's did not.
      if (mailPaneSliding()) {
        afterMailPaneSlide(() => scheduleMeasureRef.current?.());
        return;
      }
      /*
        Collapsed first, then measured.

        A mail with `height:100%` on its wrapper — a table, a body wrapper,
        an Outlook shell — is as tall as the frame it is given. Measure it
        in the frame we last sized, and the answer is that frame; set that
        as the height and the next measurement is bigger again. A message
        of two lines ended up hundreds of pixels tall, clamped, with a
        "show the whole message" button under an acre of nothing.

        At nought the percentage has nothing to be a percentage of, so what
        is left is the content's own height. The frame is put back before
        anything is painted.

        Two forced layouts, so it is not done sixty times a second: a pinch
        changes the zoom on every event, each change resizes the body, and
        the observer below answers each resize. That put four reflows per
        frame between the reader's fingers and the screen. Once per frame
        is enough — see `scheduleMeasure`.
      */
      const frame = iframeRef.current;
      const held = frame?.style.height ?? "";
      /*
        And the reader's place is held across it.

        A frame at nought is a thread that much shorter, and the browser
        clamps the scroll to the shorter one before this line returns.
        Putting the height back does not put the scroll back. On a thread
        of one message the frame is the whole thread, so the clamp was the
        whole way: every measurement — a size change, a picture arriving —
        put the reader back at the top of the message they were reading.
      */
      const scroller = frame ? scrollParentOf(frame) : null;
      const heldScroll = scroller?.scrollTop ?? 0;
      if (frame) frame.style.height = "0px";
      // Prefer content bounds (incl. trailing margins) over body.rect alone so
      // the frame keeps its height across content swaps (e.g. images toggle)
      // without clipping marketing footers.
      const next = measureEmailFrameHeight(doc);
      if (frame) frame.style.height = held;
      if (scroller && scroller.scrollTop !== heldScroll) {
        scroller.scrollTop = heldScroll;
      }
      if (next > 0) setHeight(next);
      /*
        And how wide it wants to be, the same way.

        `max-content` on the body sizes every block to its content, which
        is the width the mail would take with nothing to fill. That answer
        does not depend on the frame's width, so unlike the height there is
        no frame to collapse first and nothing to feed back. The margins
        are added by hand: the rect is the body's box, and the mail's own
        margin stands outside it, scaled by the reader's zoom like
        everything else in the frame.

        A floor of 160px, so a one-word message still has room for the
        time in its corner.
      */
      const body = doc.body;
      if (body) {
        const heldWidth = body.style.width;
        body.style.width = "max-content";
        const naturalBody = body.getBoundingClientRect().width;
        /*
          And the narrowest it can be, which is a different question and
          the more useful one.

          `max-content` says what it would like. `min-content` says what it
          cannot go under — for a mail of paragraphs that is about the
          longest word, and for a newsletter built on a fixed table it is
          that table's width. So the two together say whether a mail can
          reflow at all, without anybody having to guess from its markup.

          The bubble's cap reads it: a mail that cannot reflow is given the
          room it needs rather than clipped at three quarters of the pane.
          See `.mail-bubble-column` in mail.css.
        */
        body.style.width = "min-content";
        /*
          Read with every string breakable and every line allowed to wrap,
          so that what is measured is the width of things that have one —
          a table told to be 600px, a picture, a fixed column — and not the
          length of the longest word or the one paragraph a sender set to
          nowrap. Words wrap; that is what the bubble is for.

          A message was scaled down to fit a tracking link, then one from
          Outlook to fit something nobody could point to, and both were
          the same mistake: taking a string for a shape. Ruling strings out
          here, rather than one kind at a time, ends the series. The sheet
          is in the document only while the rect is read.
        */
        const probe = doc.createElement("style");
        probe.textContent =
          "*{overflow-wrap:anywhere!important;white-space:normal!important}";
        (doc.head ?? doc.documentElement).appendChild(probe);
        const narrowestBody = body.getBoundingClientRect().width;
        probe.remove();
        body.style.width = heldWidth;
        const styles = doc.defaultView?.getComputedStyle(body);
        const bodyZoom = parseFloat(body.style.zoom) || 1;
        const rawMargins = styles
          ? (parseFloat(styles.marginLeft) || 0) +
            (parseFloat(styles.marginRight) || 0)
          : 0;
        // Without the zoom in it: the frame multiplies its own size back
        // in, so a change of size needs no new measurement to size it.
        const wanted = Math.ceil(naturalBody / bodyZoom + rawMargins);
        if (wanted > 0) setNaturalWidth(Math.max(wanted, 160));
        /*
          Published without the reader's zoom in it.

          The bubble lays out inside the zoomed stream, so its own pixels
          are the unzoomed ones; the frame's are not, because the frame
          cancels the ancestor zoom and applies it again inside. Dividing
          it out here is what makes the two comparable, and it is the step
          that decides whether this works at any size but 100%.
        */
        const narrowestCss = Math.ceil(narrowestBody / bodyZoom + rawMargins);
        const column = frame?.closest<HTMLElement>(".mail-bubble-column");
        /*
          Whatever the bubble puts around the frame — see
          `chromeAroundFrame`. Asking the column for exactly the mail's
          width left it two pixels short, which is enough for a fixed table
          to overflow and be clipped, and clipping is the whole thing this
          is here to stop. Measured rather than named: it is one pixel
          today, it is not the frame's business, and a number written here
          would stay wrong quietly.
        */
        const chrome =
          frame && column ? chromeAroundFrame(frame, column) : 0;
        if (column && narrowestCss > 0) {
          column.style.setProperty(
            "--mail-bubble-fixed",
            `${Math.ceil(narrowestCss + chrome)}px`
          );
        }
        /*
          And when even the whole pane is not enough, it is scaled to fit
          rather than cut off.

          The cap can only give what the pane has. A narrow window, or a
          reader who has turned the size up, and a mail that cannot reflow
          still does not fit — and the choice then is between showing all
          of it smaller and showing part of it at the asked-for size. Every
          mail client that handles this well picks the first: a newsletter
          half off the right edge is not a smaller problem than a
          newsletter a fifth too small to read comfortably.

          Both sides of it are the bubble's own pixels, and neither is the
          frame's. The frame's width is the wrong thing to measure twice
          over: it is in screen pixels while the mail's width is in the
          bubble's, and it moves when the size below is set — so the first
          go at this compared the two directly, agreed with itself at 100%
          where they happen to be equal, and at 143% shrank, re-measured,
          grew, and flickered between the two for ever.

          What is asked instead is the room the bubble would have at 100%,
          which answers the same whatever size the mail is being shown at.
          `narrowestCss` carries no zoom in it either. Neither side moves
          when the size below is set, so it settles in one pass.

          And because the room is the one at rest, this sets where the mail
          starts rather than where it stops: at 100% it fills the bubble,
          and the reader's own size multiplies on top of that. Past the
          point where it fits, the mail is wider than its bubble and can be
          dragged sideways — the frame keeps `overflow-x:auto` with the bar
          hidden for exactly this, and being able to go on zooming into a
          newsletter matters more than never seeing an edge.
        */
        const room = column
          ? roomAtRest(column, chrome)
          : Number.POSITIVE_INFINITY;
        const base = zoomRef.current;
        const fit =
          room > 0 && narrowestCss > room ? room / narrowestCss : 1;
        /*
          And never wider than the pane, whatever the size asked for.

          The size below starts the mail where it fills the bubble and
          lets the reader's zoom multiply on top. Past the pane's edge
          that used to be a sideways drag with the bar hidden, which read
          as a cut-off newsletter and not as a zoomed one. The pane is
          the ceiling now: the zoom control grows a fixed mail until it
          fills the pane and stops there. The room is read at the size
          shown, in screen pixels, so it is the ceiling as painted.
        */
        const parentReal = column?.parentElement?.getBoundingClientRect().width ?? 0;
        const ceiling =
          parentReal > 0 && narrowestCss > 0
            ? (parentReal - (BUBBLE_GUTTER_PX + chrome) * base) / narrowestCss
            : Number.POSITIVE_INFINITY;
        const applied = Math.min(base * fit, Math.max(ceiling, 0.25));
        setBodyZoom(applied);
        if (Math.abs((parseFloat(body.style.zoom) || 1) - applied) > 0.002) {
          body.style.zoom = String(applied);
          // The height was read at the old size; the observer will answer
          // again now the frame has laid out at this one.
          scheduleMeasureRef.current?.();
        }
      }
    };
    let queued = 0;
    let fallback = 0;
    const scheduleMeasure = () => {
      if (queued) return;
      const run = () => {
        if (queued) cancelAnimationFrame(queued);
        window.clearTimeout(fallback);
        queued = 0;
        fallback = 0;
        // Not a document that has since been swapped out or unmounted.
        if (iframeRef.current?.contentDocument !== doc) return;
        measure();
      };
      queued = requestAnimationFrame(run);
      // A frame that never comes. A webview that is not on screen — the
      // planner's mail pane put away, a window minimised — stops its
      // animation frames, and a measurement queued behind one waited for
      // ever, with every later ask turned away at the door above. A
      // timer runs it instead, and the first of the two to arrive wins.
      fallback = window.setTimeout(run, 300);
      pendingMeasureRef.current = () => {
        if (queued) cancelAnimationFrame(queued);
        window.clearTimeout(fallback);
        queued = 0;
        fallback = 0;
      };
    };
    scheduleMeasureRef.current = scheduleMeasure;

    measure();
    setReady(true);
    scheduleMeasure();
    // Late layout shifts (e.g. images arriving after the reveal) resize the frame.
    observerRef.current?.disconnect();
    if (typeof ResizeObserver !== "undefined") {
      /*
        Not while a pane is sliding. This measurement collapses the frame
        to nothing and reads the content back, twice over, and the reader's
        width changes on every frame of a slide. One reading at the end
        says the same thing.
      */
      const observer = new ResizeObserver(() => {
        if (afterMailPaneSlide(scheduleMeasure)) return;
        scheduleMeasure();
      });
      observer.observe(doc.body);
      observer.observe(doc.documentElement);
      // Not the frame itself. Watching it from the outside was what fed
      // the width back into its own measure — see the latch in `measure`.
      // The pane not having laid out on the first pass is answered there
      // instead, by not recording an answer until there is a frame.
      /*
        The bubble's column is watched, though, and has to be.

        How much room there is decides whether a mail that cannot reflow is
        scaled down, and the room changes when the window or the pane does.
        Without this a mail scaled to fit a narrow pane stayed scaled after
        the pane was widened, because nothing inside the frame had moved
        and so nothing asked again.

        Safe to watch where the frame is not: the column is full-width
        under a ceiling, so it measures the room and never the mail. It is
        an input to the size below, not an answer to it.
      */
      const column = iframeRef.current?.closest<HTMLElement>(
        ".mail-bubble-column"
      );
      if (column) observer.observe(column);
      observerRef.current = observer;
    }
    for (const img of doc.images) {
      if (img.complete) continue;
      img.addEventListener("load", scheduleMeasure, { once: true });
      img.addEventListener("error", scheduleMeasure, { once: true });
    }
    const frameEl = iframeRef.current;
    if (frameEl) attachPinchForwarding(doc, frameEl);
    attachKeyForwarding(doc);
    // In-frame bridge owns link clicks when CSP allowed it to run.
    if (doc.documentElement.getAttribute("data-dh-bridge") !== "1") {
      attachExternalLinkHandling(doc);
    }
    attachDoubleClickForwarding(doc, () => onDblClickRef.current?.());
    attachLinkContextMenu(
      doc,
      ({ target, frameX, frameY }) => {
        const model = mailLinkMenuModel(target);
        const frame = iframeRef.current;
        if (!model || !frame) return;
        /**
         * A point in the frame, in the page's own pixels.
         *
         * Measured rather than worked out from the zoom. The frame is drawn
         * at 1/zoom, its body at zoom, and the whole stream sits in an
         * element at zoom again (see ThreadPane) — so the scale from frame
         * pixels to page pixels is some product of those, and reading the
         * zoom prop got it wrong by exactly that ancestor: at 80% the menu
         * opened a sixth of the frame below the pointer.
         *
         * The frame's rect is its size in page pixels and its own
         * `innerHeight` is that same box in frame pixels. The ratio is the
         * scale, whatever the zooms above it happen to be.
         */
        const box = frame.getBoundingClientRect();
        const view = frame.contentWindow;
        const scaleX =
          view && view.innerWidth > 0 ? box.width / view.innerWidth : 1;
        const scaleY =
          view && view.innerHeight > 0 ? box.height / view.innerHeight : 1;
        setLinkMenu({
          model,
          x: box.left + frameX * scaleX,
          y: box.top + frameY * scaleY,
        });
      },
      dismissLinkMenu
    );
    return true;
  }, [dismissLinkMenu]);

  const handleLoad = React.useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    if (doc) initDoc(doc);
  }, [initDoc]);

  React.useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      pendingMeasureRef.current?.();
      pendingMeasureRef.current = null;
    };
  }, []);

  /**
   * Show the message as soon as the document parses. The iframe `load` event
   * waits for every remote image, which adds seconds to a marketing email —
   * the observer and the per-image handlers above correct the height when the
   * images land.
   */
  React.useEffect(() => {
    if (!srcDoc) return;
    const deadline = Date.now() + 15_000;
    let raf = 0;
    const poll = () => {
      const doc = iframeRef.current?.contentDocument;
      const parsed =
        doc?.body &&
        doc.readyState !== "loading" &&
        doc.documentElement.getAttribute("data-dh-mail") === "1";
      // A false return means this is still the frame we are replacing.
      if (parsed && initDoc(doc)) return;
      if (Date.now() > deadline) return;
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [srcDoc, initDoc]);

  // Zoom changes restyle the already-loaded document; measured rects include
  // zoom, so height follows.
  React.useEffect(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc?.body) return;
    doc.body.style.zoom = String(zoom);
    // The frame follows at once; the measurement refines it to the size
    // that fits, which is this one unless the pane is narrower.
    setBodyZoom(zoom);
    /*
      Measured again once the frame has laid out at the new size — reading
      the rect in the same tick as the zoom hands back the geometry from
      before it, and the words would no longer fit the height.
    */
    // Through the queue: a pinch lands tens of these a second, and each one
    // measuring on the spot is what made the zoom lag the fingers.
    scheduleMeasureRef.current?.();
  }, [zoom]);

  return (
    <div className="relative w-full" style={{ minHeight: ready ? undefined : 140 }}>
      {showPlaceholder && !ready ? (
        <div
          className="flex min-h-[140px] items-center justify-center gap-2 px-4 py-10 text-sm text-stone-500"
          aria-live="polite"
        >
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
          {t("loadingMessage")}
        </div>
      ) : null}
      <iframe
        ref={iframeRef}
        title={t("emailContent")}
        srcDoc={srcDoc}
        sandbox="allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        onLoad={handleLoad}
        className={
          ready
            ? "block w-full border-0 bg-transparent"
            : "pointer-events-none absolute inset-x-0 top-0 block w-full border-0 opacity-0"
        }
        style={{
          height: ready ? height : 140,
          // Its own width once known — see `naturalWidth`. The class keeps
          // `w-full` for the frame still measuring, and the inline value
          // wins once there is one. Never past the bubble.
          width:
            ready && naturalWidth != null
              ? Math.ceil(naturalWidth * bodyZoom)
              : undefined,
          maxWidth: "100%",
          /*
            The frame's own scheme, which decides two things the mail does
            not: what colour the canvas behind it is, and what colour the
            scrollbars are. Pinned to light, a re-lit message got a pale
            gutter along the foot and the right edge of every card — a
            light rule under the words, from the one part of the frame the
            recolour cannot reach.
          */
          colorScheme: darkRecolor ? "dark" : "light",
          zoom: 1 / zoom,
        }}
      />
      {linkMenu ? (
        <LinkContextMenu
          model={linkMenu.model}
          x={linkMenu.x}
          y={linkMenu.y}
          onDismiss={dismissLinkMenu}
        />
      ) : null}
    </div>
  );
}

export {
  MAIL_PINCH_SCALE_EVENT,
  MAIL_PINCH_WHEEL_EVENT,
};
