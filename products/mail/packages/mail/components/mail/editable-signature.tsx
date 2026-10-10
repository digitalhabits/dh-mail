"use client";

/**
 * The signature under the message, as a copy that the writer can change.
 *
 * Both composers show it: the new message and the reply under a thread. It
 * starts as the saved signature of the sending address. A change here is
 * for this message only. The saved signature changes only in the Signature
 * dialog, under the box.
 *
 * The composer keeps the copy as `signatureHtml`: null while the writer has
 * not changed it, and the editor's HTML after the first change. Null means
 * "the saved signature", so a new From address brings its own signature
 * until the writer changes it. A changed copy stays through a change of
 * From, and the send carries it (see `outgoingSignature`).
 */

import * as React from "react";

import { signatureToEditorHtml } from "@/components/mail/SignatureDialog";
import {
  RichTextEditor,
  type RichTextEditorHandle,
} from "@/components/ui/RichTextEditor";
import { useMailT } from "@/lib/mail/i18n";

/** A short, stable name for a text, for an editor key. */
function textKey(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return `${text.length}.${hash >>> 0}`;
}

/** The blocks in a fragment: a caret in the last block has one or none after it. */
const BLOCKS = "p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, ol, ul";

/**
 * True when the caret is at an edge of `root`, with no words, picture or
 * line between it and that edge.
 */
function caretAtEdge(root: Element, edge: "start" | "end"): boolean {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.isCollapsed) return false;
  const caret = selection.getRangeAt(0);
  if (!root.contains(caret.startContainer)) return false;
  const span = document.createRange();
  span.selectNodeContents(root);
  if (edge === "start") span.setEnd(caret.startContainer, caret.startOffset);
  else span.setStart(caret.startContainer, caret.startOffset);
  if (span.toString().trim()) return false;
  const rest = span.cloneContents();
  return !rest.querySelector("img") && rest.querySelectorAll(BLOCKS).length <= 1;
}

/**
 * Arrow keys move between the message and the signature.
 *
 * Down at the end of the message goes to the start of the signature. Up at
 * the start of the signature goes to the end of the message. The listener
 * is on the box that holds both, so it hears the message editor's keys too.
 */
function useArrowsBetween(
  wrapRef: React.RefObject<HTMLDivElement | null>,
  bodyHandle: React.RefObject<RichTextEditorHandle | null> | undefined,
  signatureHandle: React.RefObject<RichTextEditorHandle | null>
) {
  React.useEffect(() => {
    const wrap = wrapRef.current;
    const box = wrap?.parentElement;
    if (!wrap || !box || !bodyHandle) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
      const target = event.target instanceof Element ? event.target : null;
      const editor = target?.closest(".ql-editor");
      if (!editor) return;
      if (event.key === "ArrowDown" && !wrap.contains(editor)) {
        if (!editor.closest(".mail-message-editor") || !caretAtEdge(editor, "end")) return;
        event.preventDefault();
        signatureHandle.current?.setCaret(0);
      } else if (event.key === "ArrowUp" && wrap.contains(editor)) {
        if (!caretAtEdge(editor, "start")) return;
        event.preventDefault();
        bodyHandle.current?.setCaret(Number.MAX_SAFE_INTEGER);
      }
    };
    box.addEventListener("keydown", onKeyDown);
    return () => box.removeEventListener("keydown", onKeyDown);
  }, [wrapRef, bodyHandle, signatureHandle]);
}

export function EditableSignature({
  saved,
  copy,
  onChange,
  editorKey,
  bodyHandle,
}: {
  /** The saved signature of the sending address. */
  saved: string;
  /** This message's own copy, or null while it is the saved one. */
  copy: string | null;
  onChange: (html: string) => void;
  /**
   * The composer's editor key. It changes when the message is put in from
   * outside (a draft, Undo), so the copy is read again with the words.
   */
  editorKey: number;
  /** The message editor, for the arrow keys between the two. */
  bodyHandle?: React.RefObject<RichTextEditorHandle | null>;
}) {
  const t = useMailT();
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const signatureHandle = React.useRef<RichTextEditorHandle | null>(null);
  useArrowsBetween(wrapRef, bodyHandle, signatureHandle);
  return (
    /*
      Its own editor, under the message. `data-mail-typing` keeps every
      shortcut quiet here, as in the message: Backspace in the signature
      must delete a letter, not the conversation. The wrapper takes the
      focus on a click beside the words for the same reason.
    */
    <div
      ref={wrapRef}
      className="outline-none"
      tabIndex={-1}
      data-mail-typing=""
      data-signature-copy=""
      title={t("signatureForThisMessage")}
    >
      <RichTextEditor
        /* Made again when the message comes from outside, and when the
           saved signature changes. Not when the writer types: the key
           does not read the copy. */
        key={`${editorKey}:${textKey(saved)}`}
        className="signature-copy-editor"
        variant="bubble"
        handleRef={signatureHandle}
        defaultValue={copy ?? signatureToEditorHtml(saved)}
        onChange={onChange}
        placeholder=""
        minHeight={0}
      />
    </div>
  );
}
