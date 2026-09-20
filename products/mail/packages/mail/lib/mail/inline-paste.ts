/**
 * How large a pasted picture may be, written into the message.
 *
 * A screenshot from a modern display is several megabytes, and base64 adds a
 * third on top. Written into the body, that is what the recipient downloads
 * before they can read the first line — and nobody wants an email that
 * arrives at eight megabytes because a window was photographed.
 *
 * Above this it goes as a file instead, which is what an attachment is for.
 */
export const MAX_INLINE_PASTE_BYTES = 2 * 1024 * 1024;

/** The same, measured on a data: URI — base64 is four bytes for every three. */
export function dataUrlTooBig(dataUrl: string): boolean {
  const comma = dataUrl.indexOf(",");
  const base64 = comma < 0 ? dataUrl : dataUrl.slice(comma + 1);
  return Math.floor((base64.length * 3) / 4) > MAX_INLINE_PASTE_BYTES;
}
