/**
 * What a file dragged onto a composer is for.
 *
 * A picture dropped on the words goes into the message, where it was
 * dropped, the way it does in Outlook. Everything else is an attachment: a
 * PDF or a Word file has nothing to show inside a sentence, so it hangs off
 * the end of the message wherever it lands.
 *
 * The rule is read from the drag itself, before it is dropped, because the
 * composer has to say what the drop will do while the file is still in the
 * air — it either shows the overlay or shows the caret. See
 * `useComposerFileDrop`.
 */

/**
 * What a drag hands over. Narrower than `DataTransfer` so it can be tested.
 *
 * `kind` and `type` are all a drag exposes before the drop. The files
 * themselves cannot be opened until they land, so the names are not there
 * to read.
 */
export type DragItemLike = { kind: string; type: string };

/**
 * Whether a drag carries pictures and nothing else.
 *
 * Nothing else: one PDF among four pictures makes the whole drop a set of
 * attachments, because a drop is one action and splitting it would put
 * half the files in the message and half on the end of it.
 *
 * A file of a type the system does not name is not a picture. That is the
 * safe way round — an unknown file becomes an attachment, which is what
 * every file that is not a picture becomes.
 */
export function dragCarriesOnlyImages(
  items: ArrayLike<DragItemLike> | null | undefined
): boolean {
  const list = items ? Array.from(items) : [];
  if (!list.length) return false;
  return list.every(
    (item) => item.kind === "file" && item.type.startsWith("image/")
  );
}
