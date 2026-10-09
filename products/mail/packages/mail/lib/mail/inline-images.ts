/**
 * A picture written into the message, rather than hung off the end of it.
 *
 * The composer holds one as a `data:` URI, which is the only thing an editor
 * can show without a server. That is not what goes out: Gmail's web client
 * and Outlook both refuse to draw a `data:` image, so a message sent that way
 * arrives with a hole where the picture was — and the sender, reading their
 * own copy in this app, sees it perfectly.
 *
 * So on the way out each one becomes a real part of the message with a
 * Content-ID, and the `src` becomes `cid:` that id. That is what every mail
 * client has understood for thirty years.
 *
 * No React and no DOM in here, so a test can read it.
 */

/** One picture lifted out of the body, ready to be sent as its own part. */
export type InlineImage = {
  /** The `cid:` this image is referenced by, without the scheme. */
  contentId: string;
  filename: string;
  mimeType: string;
  /** Standard base64, no data: prefix and no whitespace. */
  contentBase64: string;
};

/**
 * `data:` sources in an `img` tag, and nothing else.
 *
 * Deliberately not a parser: this runs on a string the composer just made,
 * where every such image is one this app put there. A `data:` URI in an
 * attribute the sender typed is not something to go looking for.
 */
const DATA_IMG_SRC =
  /<img\b[^>]*?\bsrc\s*=\s*"data:(image\/[a-z0-9.+-]+);base64,([^"]+)"/gi;

const EXTENSION: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/heic": "heic",
};

/**
 * Every `data:` picture out of the body, replaced by a `cid:` reference.
 *
 * The id is built from the message's own domain-less token and the position,
 * so two pictures in one message never collide and nothing about the sender
 * travels in it.
 *
 * Returns the rewritten HTML and the pictures. A body with no `data:` image
 * comes back as it went in, and with no pictures — the common case, and it
 * must cost nothing.
 */
export function extractInlineImages(html: string): {
  html: string;
  images: InlineImage[];
} {
  if (!html.includes("data:image/")) return { html, images: [] };

  const images: InlineImage[] = [];
  const stamp = Math.random().toString(36).slice(2, 10);
  const out = html.replace(
    DATA_IMG_SRC,
    (whole, mimeType: string, base64: string) => {
      const clean = base64.replace(/\s+/g, "");
      // A src that decodes to nothing is not a picture. Left as it is, so
      // that whatever it was arrives looking the way the sender saw it.
      if (!clean) return whole;
      const index = images.length + 1;
      const contentId = `dh-inline-${stamp}-${index}`;
      const ext = EXTENSION[mimeType.toLowerCase()] ?? "png";
      images.push({
        contentId,
        filename: `image-${index}.${ext}`,
        mimeType: mimeType.toLowerCase(),
        contentBase64: clean,
      });
      return whole.replace(
        /\bsrc\s*=\s*"data:[^"]+"/i,
        `src="cid:${contentId}"`
      );
    }
  );
  return { html: out, images };
}
