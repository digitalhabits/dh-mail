/**
 * What content type an attachment may be served as.
 *
 * **The claimed type comes from whoever sent the message.** It reaches the
 * attachment path as a query parameter, and echoing it back as `Content-Type`
 * on an inline response means a sender chooses what the browser does with the
 * bytes. `text/html` there is script running on this app's own origin, with the
 * reader's session; `image/svg+xml` is the same thing wearing a picture's name.
 *
 * The filename does not save you either: the preview decides it is a PDF from
 * the extension, so `invoice.pdf` holding HTML reaches the frame.
 *
 * So the claim is checked against a list, and anything else is served as bytes
 * to save rather than content to render. A user loses nothing: an attachment
 * this refuses to inline is one no browser was going to display anyway.
 */

/**
 * Types safe to render in place.
 *
 * No `image/svg+xml`: an SVG is a document, and it can carry script.
 * No `text/html`, for the same reason said plainly.
 */
const INLINE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/pjpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/avif",
  "image/heic",
  "image/heif",
  "image/tiff",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "application/pdf",
  "text/plain",
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

/** What a response says when nothing may be rendered: bytes, and no more. */
export const OPAQUE_MIME_TYPE = "application/octet-stream";

/**
 * The content type to answer with.
 *
 * A download is always opaque — the browser is saving the file, so declaring
 * anything else only adds a way to be wrong.
 *
 * Pass the bytes when they are at hand. A sender who labels a PDF as
 * `application/octet-stream` (ticket systems and some Outlook senders do) is
 * not attacking anyone, but an opaque blob in a frame shows as nothing: the
 * preview decided it was a PDF from the name, and the frame got a type the
 * viewer will not open. The bytes say what the file is, so a file that starts
 * as a PDF starts is served as one. That is a PDF viewer, not HTML on this
 * origin, so the reason for the list above does not apply.
 */
export function safeAttachmentMimeType(
  claimed: string | null | undefined,
  options?: { download?: boolean; bytes?: Uint8Array }
): string {
  if (options?.download) return OPAQUE_MIME_TYPE;
  // Parameters such as "; charset=" are dropped: they are not needed to choose,
  // and they are another thing a sender controls.
  const bare = (claimed ?? "").split(";")[0].trim().toLowerCase();
  if (INLINE_TYPES.has(bare)) return bare;
  if (options?.bytes && startsAsPdf(options.bytes)) return "application/pdf";
  return OPAQUE_MIME_TYPE;
}

/** `%PDF-`, which every PDF begins with. */
function startsAsPdf(bytes: Uint8Array): boolean {
  const magic = [0x25, 0x50, 0x44, 0x46, 0x2d];
  return magic.every((b, i) => bytes[i] === b);
}

/**
 * Headers that stop a browser from guessing past the type above.
 *
 * Without `nosniff`, a browser may look at the bytes, decide an
 * `application/octet-stream` is really HTML, and render it — which is the whole
 * hole again.
 */
export const ATTACHMENT_SNIFF_HEADERS = {
  "X-Content-Type-Options": "nosniff",
} as const;

/**
 * A name a header can carry: printable ASCII, no quotes, no backslashes.
 *
 * A quote would end the quoted string early and let the rest of the name be
 * read as header parameters. Everything else outside printable ASCII becomes
 * an underscore, and the real name travels in `filename*` below.
 */
function asciiFilename(filename: string): string {
  const safe = [...filename]
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      if (code < 0x20 || code > 0x7e) return "_";
      return ch === '"' || ch === "\\" ? "_" : ch;
    })
    .join("")
    .trim();
  return safe || "attachment";
}

/**
 * The name as it really is, encoded the way RFC 5987 asks.
 *
 * `encodeURIComponent` leaves `!'()*` alone and those are not allowed here,
 * so they are encoded as well.
 */
function encodedFilename(filename: string): string {
  return encodeURIComponent(filename).replace(
    /['()!*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

/**
 * `Content-Disposition`, with a filename that cannot break the header.
 *
 * A header value is bytes, not text. Dropping a filename straight into one
 * worked until somebody was sent a PDF whose name carried Danish letters:
 * WebKit refused the whole response with a bare `TypeError`, so the file
 * never arrived and the preview window waited for ever.
 *
 * Both parts are sent, as RFC 6266 says to: `filename` for anything that only
 * understands the old form, and `filename*` for the name as it was written.
 * A client that reads both prefers `filename*`, so an accented name arrives
 * intact rather than full of underscores.
 */
export function attachmentContentDisposition(
  filename: string,
  options?: { download?: boolean }
): string {
  const kind = options?.download ? "attachment" : "inline";
  return `${kind}; filename="${asciiFilename(filename)}"; filename*=UTF-8''${encodedFilename(filename)}`;
}
