/**
 * Message markup on its way into the writing box.
 *
 * The box stands in the app's own document, and it is given the markup of a
 * received message in three places: a queued message taken back, a draft
 * imported from the provider, and a new mail written from an older one.
 *
 * Quill drops what can run. Measured in
 * `apps/mail/tests/mounted-editor-keeps`: a style block, an SVG and an
 * event handler all go, and the words of the style block are not read as
 * writing. One thing comes through, on every path and on a paste: a
 * picture.
 *
 * A picture on a sender's server is a fetch from our own page the moment
 * the box opens. It tells the sender that the mail was opened, it goes
 * around the reader's "Load images by default" setting, and the reading
 * frame exists so that no such fetch is ever made from this document.
 *
 * So a picture that would go to a host goes. A picture the message carries
 * itself stays, because it asks nobody anything.
 *
 * This works on the text rather than through a parse. The markup is about
 * to be parsed by the editor, and a parse and a write-out of our own is one
 * more round for a mutation to ride — the same reason the preview is shown
 * in a frame. The shape is the one `sizeInlineImages` uses on the way out.
 *
 * The cost of that is a tag which holds a raw `>` inside an attribute, which
 * this reads as the end of the tag. Nothing reaching here holds one: every
 * path either goes through `sanitizeEmailHtml`, which writes the markup out
 * of a DOM, or comes from a provider, which does the same. A picture on a
 * relative address is left alone, because it names our own page and not a
 * host.
 */

/**
 * A `src` that names a host: `https://`, `http://`, or `//` for whichever
 * scheme the page is on. The space in front keeps it off `data-src`.
 */
const REMOTE_IMAGE_SRC = /\ssrc\s*=\s*["']?\s*(?:https?:)?\/\//i;

/**
 * Is there a picture here at all?
 *
 * Case-insensitive, like the two patterns it stands in front of. Written as
 * a plain `includes` it answered no to `<IMG SRC=…>` and handed the markup
 * back whole. Two of the three callers take HTML from a provider, which no
 * DOM of ours has written out, so the capitals are theirs to choose.
 */
const HAS_IMAGE = /<img\b/i;

/** Take out every picture that would be fetched from a host. */
export function dropRemoteImagesForEditing(html: string): string {
  if (!html || !HAS_IMAGE.test(html)) return html;
  return html.replace(/<img\b[^>]*>/gi, (tag) =>
    REMOTE_IMAGE_SRC.test(tag) ? "" : tag
  );
}
