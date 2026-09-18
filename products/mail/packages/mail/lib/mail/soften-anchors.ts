/**
 * Every link in an email becomes a span before the parser sees it.
 *
 * HTML5 forbids <a> wrapping a <table>, which marketing CTAs do constantly.
 * The parser hoists the table out and leaves an empty <a>, so the visible
 * "View message" button loses its link. A span may wrap a table, so the
 * address survives; the frame's click bridge opens it.
 *
 * No React and no DOM in here, so a test can read it.
 */

export const MAIL_HREF_ATTR = "data-dh-href";
/** A softened link the sender styled in no way at all — see below. */
export const MAIL_PLAIN_LINK_ATTR = "data-dh-plain";

/**
 * Turn every <a href> into <span data-dh-href> before DOMParser runs.
 *
 * HTML5 forbids <a> wrapping a <table> (common in LinkedIn / marketing CTAs).
 * The parser hoists the table out and leaves an empty <a> — the visible
 * "View message" button then has no link. Spans may wrap tables, so the URL
 * survives; the iframe click handler opens data-dh-href via openExternalUrl.
 */
export function softenAnchorsForParse(html: string): string {
  const tagRe = /<\/a\s*>|<a\b([^>]*)>/gi;
  const styled = classesWithRules(html);
  let out = "";
  let last = 0;
  for (const match of html.matchAll(tagRe)) {
    const index = match.index ?? 0;
    out += html.slice(last, index);
    if (/^<\/a/i.test(match[0])) {
      out += "</span>";
    } else {
      const attrs = match[1] ?? "";
      const hrefMatch = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(
        attrs
      );
      const href = hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? "";
      let rest = attrs.replace(
        /\s*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i,
        ""
      );
      rest = rest.replace(
        /\s*\bdata-dh-href\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i,
        ""
      );
      // Ours to set, not the sender's to claim: it decides how the link is
      // painted, and a button could otherwise ask to be painted as text.
      rest = rest.replace(
        /\s*\bdata-dh-plain\s*(?:=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/i,
        ""
      );
      const escaped = href
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;");
      /*
        A link the sender dressed themselves keeps what they gave it — that
        is what the softening is for, so a "View message" button stays a
        button. One they left alone has nothing at all once it is a span,
        and read as ordinary words: no colour, no underline, no sign that
        it goes anywhere. Those are marked here and painted like a link.

        Marked from the tag rather than in CSS because CSS cannot ask
        whether the sender said anything; `style` on the anchor, or a
        class one of the sender's own `<style>` blocks has a rule for, is
        the nearest honest answer to that question. A class nothing
        styles is a name and not a dress: Ryanair's links carry one, and
        counting it left "see shops here" as ordinary words.
      */
      const classMatch = /(?:^|\s)class\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(rest);
      const classes = (classMatch?.[1] ?? classMatch?.[2] ?? classMatch?.[3] ?? "")
        .split(/\s+/)
        .filter(Boolean);
      const dressed =
        /(?:^|\s)style\s*=/i.test(rest) || classes.some((c) => styled.has(c.toLowerCase()));
      out += `<span ${MAIL_HREF_ATTR}="${escaped}"${
        dressed ? "" : ` ${MAIL_PLAIN_LINK_ATTR}=""`
      }${rest}>`;
    }
    last = index + match[0].length;
  }
  out += html.slice(last);
  return out;
}

/**
 * The class names the message's own `<style>` blocks have a rule for.
 *
 * Read off the text with a regular expression rather than parsed: this
 * runs before the HTML is parsed at all, and a name after a dot in a
 * stylesheet is a class selector often enough for the question asked
 * here — did the sender style this link, or only name it.
 */
function classesWithRules(html: string): Set<string> {
  const out = new Set<string>();
  const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
  for (const block of html.matchAll(styleRe)) {
    const css = block[1] ?? "";
    for (const m of css.matchAll(/\.([A-Za-z_-][\w-]*)/g)) {
      out.add(m[1].toLowerCase());
    }
  }
  return out;
}

/**
 * The links put back, for a message being written rather than read.
 *
 * The softening above is for the reading frame, where a span carries the
 * address and the click bridge opens it. An editor knows nothing of that
 * bridge: it sees a span, keeps the words and drops the link — so a
 * message copied into the composer arrived with its links as plain text.
 *
 * This is the way back. Every softened span becomes an anchor again, and
 * its matching close tag with it, counting the spans in between so a span
 * inside a link closes the right one.
 */
export function restoreAnchorsForEditing(html: string): string {
  const tagRe = /<span\b([^>]*)>|<\/span\s*>/gi;
  let out = "";
  let last = 0;
  /** One entry per open span: the tag to close it with. */
  const open: ("a" | "span")[] = [];
  for (const match of html.matchAll(tagRe)) {
    const index = match.index ?? 0;
    out += html.slice(last, index);
    last = index + match[0].length;
    if (match[0].startsWith("</")) {
      out += open.pop() === "a" ? "</a>" : "</span>";
      continue;
    }
    const attrs = match[1] ?? "";
    const hrefMatch = new RegExp(
      `\\b${MAIL_HREF_ATTR}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
      "i"
    ).exec(attrs);
    const href = hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? "";
    if (!href) {
      open.push("span");
      out += match[0];
      continue;
    }
    // What the softening added comes off again: the address is an href now,
    // and how it is painted is the editor's business.
    let rest = attrs
      .replace(
        new RegExp(
          `\\s*\\b${MAIL_HREF_ATTR}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`,
          "i"
        ),
        ""
      )
      .replace(
        new RegExp(
          `\\s*\\b${MAIL_PLAIN_LINK_ATTR}\\s*(?:=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+))?`,
          "i"
        ),
        ""
      )
      .replace(/\s*\brole\s*=\s*(?:"link"|'link'|link)/i, "");
    rest = rest.trimEnd();
    open.push("a");
    out += `<a href="${href}"${rest}>`;
  }
  out += html.slice(last);
  return trimAnchorEdges(out);
}

/**
 * Whitespace pushed out of the ends of a link.
 *
 * Mail written elsewhere puts it inside: Outlook in particular hands over
 * `<a> text</a>`, and the space is then underlined and coloured as though
 * it were part of the address. Copied into the composer it reads as a link
 * that begins one character early, and every editor after that treats the
 * space as link text.
 *
 * The gap is kept — it is a real space between words — and only moves to
 * the outside, where it belongs. `&nbsp;` counts: it is what Outlook
 * writes.
 */
export function trimAnchorEdges(html: string): string {
  const GAP = "(?:\\s|&nbsp;|&#160;)+";
  const isGap = (value: string) => /(?:\s|&nbsp;|&#160;)$/.test(value);
  /** A gap is not needed against a tag boundary, only against words. */
  const out = html.replace(
    new RegExp(`(<a\\b[^>]*>)(${GAP})`, "gi"),
    (_match, tag: string, _ws: string, offset: number, full: string) => {
      const before = full.slice(0, offset);
      return (before && !isGap(before) && !before.endsWith(">") ? " " : "") + tag;
    }
  );
  return out.replace(
    new RegExp(`(${GAP})(</a\\s*>)`, "gi"),
    (match, _ws: string, tag: string, offset: number, full: string) => {
      const after = full.slice(offset + match.length);
      return tag + (after && !/^(?:\s|&nbsp;|&#160;|<)/.test(after) ? " " : "");
    }
  );
}
