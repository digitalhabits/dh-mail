"use client";

/*
 * The thread composer's attachment strip, off the pane component: the
 * files on the message being written, a picture pasted or dropped into the
 * words, and the drop overlay. ThreadPane hands in the editor's handle and
 * whether a picture can go into the words. What comes back is the strip and
 * the handlers the composer's box spreads onto itself.
 *
 * The three hooks inside are called in the order the pane called them, so
 * their effects run in the same order as before.
 */

import * as React from "react";
import {
  useComposerFileDrop,
  useComposerPaste,
  useDraftAttachments,
} from "@/components/mail/draft-attachments";
import { dataUrlTooBig } from "@/lib/mail/inline-paste";
import type { RichTextEditorHandle } from "@/components/ui/RichTextEditor";

export function useComposerAttachments(input: {
  replyEditorHandle: React.RefObject<RichTextEditorHandle | null>;
  /**
   * False in a chat-shaped thread, where a pasted picture attaches, as the
   * pop-out already does: written inline it rides invisibly in the bubble's
   * HTML — a chat bubble is its words — and the reader watched their
   * screenshot vanish. In a mail-shaped reply it still lands in the words,
   * where a picture in a letter belongs.
   */
  pasteIntoWords: boolean;
}) {
  const { replyEditorHandle, pasteIntoWords } = input;

  /** The strip as of this render, for callbacks that outlive one. */
  const attachItemsRef = React.useRef<
    { id: string; filename: string }[]
  >([]);
  const {
    items: attachItems,
    totalBytes: attachTotalBytes,
    ready: attachmentsReady,
    addFiles: addAttachFiles,
    remove: removeAttach,
    clear: clearAttachments,
    replaceAll: replaceAttachments,
    payload: attachmentPayload,
  } = useDraftAttachments();
  attachItemsRef.current = attachItems;
  /**
   * A picture into the reply itself, at the caret.
   *
   * The same for a paste and for a drop on the words, so both land the
   * same way. Too big to write in, or no editor to write into: it is a
   * file, and the caller attaches it instead.
   */
  const insertInlineImage = React.useCallback((dataUrl: string) => {
    if (dataUrlTooBig(dataUrl) || !replyEditorHandle.current) return false;
    replyEditorHandle.current.insertImage(dataUrl);
  }, [replyEditorHandle]);
  const { dragging: attachDragging, dropHandlers: attachDropHandlers } =
    useComposerFileDrop(addAttachFiles, {
      caretToPoint: (x, y) =>
        replyEditorHandle.current?.caretToPoint(x, y) ?? false,
      insert: insertInlineImage,
    });
  const { pasteHandlers: attachPasteHandlers } = useComposerPaste(
    addAttachFiles,
    pasteIntoWords ? insertInlineImage : undefined
  );

  return {
    attachItemsRef,
    attachItems,
    attachTotalBytes,
    attachmentsReady,
    addAttachFiles,
    removeAttach,
    clearAttachments,
    replaceAttachments,
    attachmentPayload,
    attachDragging,
    attachDropHandlers,
    attachPasteHandlers,
  };
}
