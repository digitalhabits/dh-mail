"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";

/**
 * The question before mail is deleted for good.
 *
 * Every other action in the list can be undone, and says so with an Undo in
 * its toast. "Delete forever" cannot, so it asks first, and the dialog says
 * in words that there is no way back.
 *
 * Focus starts on Cancel. Return on a dialog that has just opened must not
 * delete anything: the reader who pressed a key by habit keeps the mail.
 *
 * `role="dialog"` and not `alertdialog`: the list and the reader both leave
 * their keyboard shortcuts alone while the focus is inside `[role="dialog"]`,
 * and Backspace here must not reach the delete shortcut behind the dialog.
 */
export function ConfirmPurgeDialog({
  title,
  body,
  note,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  /** A second paragraph, for a fact the reader could not see in the list. */
  note?: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = React.useRef<HTMLButtonElement | null>(null);
  const confirmRef = React.useRef<HTMLButtonElement | null>(null);
  const titleId = React.useId();
  const bodyId = React.useId();

  React.useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => before?.focus?.();
  }, []);

  /*
    The Mac web view does not tab to buttons, so Tab and the arrow keys are
    moved by hand between the two. There is nothing else to reach.
  */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
      return;
    }
    /*
      Return and Space press the button that has the focus. The page behind
      has key handlers of its own that take Return before the button sees
      it, so the dialog does not wait for the browser to press it. With the
      focus anywhere but the red button, that is Cancel.
    */
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      if (document.activeElement === confirmRef.current) onConfirm();
      else onCancel();
      return;
    }
    if (e.key === "Tab" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const onCancelNow = document.activeElement === cancelRef.current;
      (onCancelNow ? confirmRef : cancelRef).current?.focus();
    }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/30 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onKeyDown={onKeyDown}
        className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-5 text-stone-800 shadow-xl"
      >
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>
        <p id={bodyId} className="mt-2 text-sm leading-relaxed text-stone-600">
          {body}
        </p>
        {note ? (
          <p className="mt-2 text-sm leading-relaxed text-stone-600">{note}</p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-full border border-stone-300 bg-white px-4 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-400"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
          >
            {/* The plain bin: the button is red already, and a red mark would not show on it. */}
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
