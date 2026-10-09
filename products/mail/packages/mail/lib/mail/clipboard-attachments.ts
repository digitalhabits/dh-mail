/**
 * Files on the clipboard, for pasting into a composer.
 *
 * A screenshot, or a file copied in Finder, arrives as a real `File` on the
 * paste event. Ordinary text does not, which is what tells the two apart: a
 * paste carrying no file is left alone entirely, so pasting text keeps working
 * the way it always has.
 *
 * Copying a paragraph that contains a picture is a text paste, not a file one —
 * the browser puts HTML on the clipboard and no file — so it still lands in the
 * message body rather than becoming an attachment.
 */

/** What a paste event hands over. Narrower than `DataTransfer` so it can be tested. */
export type ClipboardLike = {
  files?: ArrayLike<File> | null;
  items?: ArrayLike<{ kind: string; getAsFile: () => File | null }> | null;
};

/**
 * A sensible extension for a file the clipboard did not name.
 *
 * The subtype is right often enough — `image/png` is `.png` — and the two
 * exceptions are the two that matter most in mail.
 */
function extensionFor(mimeType: string): string {
  const subtype = mimeType.split("/")[1]?.split(";")[0]?.trim().toLowerCase();
  if (!subtype || subtype === "octet-stream") return "bin";
  if (subtype === "jpeg") return "jpg";
  if (subtype === "svg+xml") return "svg";
  return subtype.replace(/[^a-z0-9]/g, "") || "bin";
}

/**
 * The same file, named.
 *
 * A pasted screenshot usually has no name, and "attachment" tells the reader
 * nothing about what they have been sent. Gmail calls these `image.png`, and
 * matching that is less surprising than inventing something.
 */
function named(file: File): File {
  if (file.name) return file;
  // "image.pdf" would be a lie. Only what is actually a picture is called one.
  const kind = file.type.startsWith("image/") ? "image" : "file";
  const name = `${kind}.${extensionFor(file.type)}`;
  // A File cannot be renamed, so this is a new one over the same bytes.
  return new File([file], name, {
    type: file.type || "application/octet-stream",
    lastModified: file.lastModified,
  });
}

/**
 * Every file on the clipboard, named, or an empty list for a text paste.
 *
 * `files` is what a browser fills for a pasted screenshot. `items` is the
 * older road to the same thing, and is read only when `files` is empty.
 */
export function clipboardAttachments(data: ClipboardLike | null): File[] {
  if (!data) return [];

  const direct = data.files ? Array.from(data.files) : [];
  if (direct.length) return direct.map(named);

  const fromItems = Array.from(data.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file != null);
  return fromItems.map(named);
}

/**
 * Make a name that no attachment in `taken` already has.
 *
 * Two pasted screenshots are both `image.png`, and two chips reading the same
 * thing is a way to send the wrong one. Mail itself does not care — each part
 * carries its own name — so this is for the person looking at the composer.
 */
export function uniqueAttachmentName(name: string, taken: string[]): string {
  const used = new Set(taken.map((n) => n.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${stem} ${n}${extension}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return name;
}
