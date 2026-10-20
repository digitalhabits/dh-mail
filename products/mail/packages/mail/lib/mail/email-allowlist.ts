/**
 * The allowlist a message's HTML goes through: which elements, attributes
 * and addresses it may keep.
 *
 * This replaced a blocklist (2026-10). A blocklist lets through each thing
 * that nobody thought to name, and mail is full of things nobody names. An
 * allowlist keeps only what is named here, and takes everything else away.
 *
 * The rules:
 *
 * - An element is kept only if it is an HTML element (not SVG, not MathML)
 *   and its name is in KEPT_TAGS. Any other element goes. Its words stay,
 *   unless it is in DROPPED_WITH_CONTENT.
 * - SVG and MathML go whole. Mail almost never uses them (Gmail removes
 *   them too), and markup that parses one way inside them and another way
 *   outside them is the usual route past a sanitizer.
 * - An attribute is kept only if its name is in KEPT_ATTRS. So every `on…`
 *   handler goes, and so does every attribute that a browser could read as
 *   an instruction.
 * - An address is kept only if `email-url-policy.ts` allows its scheme.
 * - Comments go. A <style> block stays, unless its text could close the
 *   block early when the frame parses it again.
 *
 * Why not DOMPurify: under happy-dom, which the test suites use, it lets
 * everything through, so no suite could hold it to anything. Each rule
 * here is small enough to read, and `email-html.test.mjs` checks them in
 * the same DOM that it runs in.
 *
 * Everything that is kept was made by the HTML parser, as an HTML element.
 * The result is written out and parsed again in the frame. A tree with only
 * these elements and these attributes parses back to the same elements.
 */

import {
  isAllowedImageUrl,
  isAllowedLinkUrl,
  isAllowedSrcset,
} from "@/lib/mail/email-url-policy";
import { MAIL_HREF_ATTR, MAIL_PLAIN_LINK_ATTR } from "@/lib/mail/soften-anchors";
import { inertHtmlBody } from "@/lib/inert-html";

const HTML_NS = "http://www.w3.org/1999/xhtml";

/** Elements a message may keep. */
const KEPT_TAGS = new Set([
  "a", "abbr", "acronym", "address", "article", "aside", "b", "bdi", "bdo",
  "big", "blockquote", "br", "caption", "center", "cite", "code", "col",
  "colgroup", "dd", "del", "details", "dfn", "dir", "div", "dl", "dt", "em",
  "fieldset", "figcaption", "figure", "font", "footer", "h1", "h2", "h3",
  "h4", "h5", "h6", "header", "hgroup", "hr", "i", "img", "ins", "kbd",
  "label", "legend", "li", "main", "mark", "menu", "nav", "nobr", "ol", "p",
  "picture", "pre", "q", "rp", "rt", "ruby", "s", "samp", "section", "small",
  "span", "strike", "strong", "style", "sub", "summary", "sup", "table",
  "tbody", "td", "tfoot", "th", "thead", "time", "tr", "tt", "u", "ul",
  "var", "wbr",
]);

/**
 * Elements that go with everything inside them.
 *
 * Code, and elements whose contents a browser does not show as words:
 * raw text it reads in one way here and in another way in the frame (a
 * <noscript> with scripts off and on), or a value nobody reads.
 */
const DROPPED_WITH_CONTENT = new Set([
  "script", "noscript", "template", "iframe", "frame", "frameset", "object",
  "embed", "applet", "noembed", "noframes", "textarea", "select", "datalist",
  "title", "head", "svg", "math", "canvas", "dialog", "audio", "video",
]);

/** Attributes a message may keep, on any kept element. */
const KEPT_ATTRS = new Set([
  "abbr", "align", "alt", "axis", "background", "bgcolor", "border",
  "bordercolor", "cellpadding", "cellspacing", "char", "charoff", "cite",
  "class", "clear", "color", "cols", "colspan", "compact", "datetime", "dir",
  "face", "frame", "headers", "height", "href", "hspace", "id", "lang",
  "nowrap", "open", "originalsrc", "reversed", "rowspan", "rules", "scope",
  "size", "sizes", "span", "src", "srcset", "start", "style", "summary",
  "title", "type", "valign", "value", "vspace", "width",
  MAIL_HREF_ATTR, MAIL_PLAIN_LINK_ATTR,
]);

/** Attributes that hold a picture's address. */
const IMAGE_URL_ATTRS = new Set(["src", "background", "originalsrc"]);

/** Attributes that hold an address of another kind. */
const LINK_URL_ATTRS = new Set(["href", MAIL_HREF_ATTR, "cite"]);

/**
 * True when the text of a <style> block could end the block early.
 *
 * In a style block, only `</style` ends the text. `<!--` does nothing
 * there, and old mail wraps its CSS in one, so it stays.
 */
function styleCanEscape(text: string): boolean {
  return /<\/style/i.test(text);
}

/**
 * Keep the attribute, change it, or take it away.
 *
 * `mendLink` turns a link into the address that is checked and kept: see
 * `sanitizeEmailHtml`. An address that a safe link wraps is checked, not
 * the wrapper, because a wrapper can hold any address at all.
 */
function cleanAttribute(el: Element, attr: Attr, mendLink: (value: string) => string): void {
  const name = attr.name.toLowerCase();
  if (!KEPT_ATTRS.has(name) || attr.namespaceURI) {
    el.removeAttributeNode(attr);
    return;
  }
  if (name === "srcset") {
    if (!isAllowedSrcset(attr.value)) el.removeAttributeNode(attr);
    return;
  }
  if (IMAGE_URL_ATTRS.has(name)) {
    if (!isAllowedImageUrl(attr.value)) el.removeAttributeNode(attr);
    return;
  }
  if (!LINK_URL_ATTRS.has(name)) return;
  const mended = name === "cite" ? attr.value : mendLink(attr.value);
  if (!isAllowedLinkUrl(mended)) el.removeAttributeNode(attr);
  else if (mended !== attr.value) attr.value = mended;
}

/** Put an element's children where it was, and take the element away. */
function unwrap(el: Element): void {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

/** Clean one element, and then what is inside it. */
function cleanElement(el: Element, mendLink: (value: string) => string): void {
  const tag = el.localName.toLowerCase();
  if (el.namespaceURI !== HTML_NS || DROPPED_WITH_CONTENT.has(tag)) {
    el.remove();
    return;
  }
  if (tag === "style" && styleCanEscape(el.textContent ?? "")) {
    el.remove();
    return;
  }
  cleanChildren(el, mendLink);
  if (!KEPT_TAGS.has(tag)) {
    unwrap(el);
    return;
  }
  for (const attr of [...el.attributes]) cleanAttribute(el, attr, mendLink);
}

function cleanChildren(parent: Node, mendLink: (value: string) => string): void {
  for (const child of [...parent.childNodes]) {
    if (child.nodeType === 1) cleanElement(child as Element, mendLink);
    else if (child.nodeType !== 3) child.parentNode?.removeChild(child);
  }
}

/**
 * Take from `root` every element, attribute and address the allowlist does
 * not keep. `root` itself stays, with no attributes.
 */
export function applyEmailAllowlist(root: Element, mendLink: (value: string) => string): void {
  for (const attr of [...root.attributes]) root.removeAttributeNode(attr);
  cleanChildren(root, mendLink);
}

/**
 * HTML cleaned to be shown in the app's own page, not in a message frame.
 *
 * The same allowlist, built in an inert document (see inert-html.ts), and
 * stricter on three points, because the page has no frame around it:
 *
 * - A <style> block goes. In the page it would style the app.
 * - An `id` goes, and so does each class name that is not the editor's own
 *   (`ql-…`). The app's CSS must not reach into it, and it must not reach
 *   the app's CSS, such as a class that covers the window.
 * - Links keep their address as it is: nothing here is softened.
 */
export function sanitizeHtmlForPage(html: string): string {
  if (typeof DOMParser === "undefined") return "";
  const body = inertHtmlBody(html);
  applyEmailAllowlist(body, (value) => value);
  for (const style of [...body.querySelectorAll("style")]) style.remove();
  for (const el of [...body.querySelectorAll("[id], [class]")]) {
    el.removeAttribute("id");
    const own = (el.getAttribute("class") ?? "").split(/\s+/).filter((name) => name.startsWith("ql-"));
    if (own.length) el.setAttribute("class", own.join(" "));
    else el.removeAttribute("class");
  }
  return body.innerHTML;
}
