"use client";

/*
 * Say that something happened, with Undo, where the other confirmations
 * are: in the stack at the foot of the list or the reader (undo-slot-row).
 * A window with neither, such as a composer window of its own, keeps a
 * toast. Archive, delete, move and snooze fill the stack through
 * use-mail-undo; a send through undo-send. This is for the rest, such as a
 * discarded draft (2026-10-28).
 */

import { mailSay } from "@/lib/mail/i18n-strings";
import { toast } from "@/lib/mail/toast";
import { mailUndoSlot, UNDO_SLOT_MS, type UndoSlotAction } from "@/lib/mail/undo-slot";

export function confirmWithUndo(options: {
  action: UndoSlotAction;
  /** What happened, in bold: "Draft discarded". */
  verb: string;
  /** What it happened to: a subject. */
  object?: string;
  /** The whole sentence, for the toast. */
  label: string;
  ms?: number;
  onUndo: () => void;
  /** It went without Undo: its time ran out, or another pushed it off. */
  onGone?: () => void;
}): void {
  let undone = false;
  const gone = () => {
    if (!undone) options.onGone?.();
  };
  const undo = () => {
    if (undone) return;
    undone = true;
    options.onUndo();
  };
  const { listOn, stripOn } = mailUndoSlot.get();
  if (listOn > 0 || stripOn > 0) {
    const id = `${options.action}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    mailUndoSlot.show({
      id,
      action: options.action,
      verb: options.verb,
      object: options.object?.trim() ?? "",
      label: options.label,
      ms: options.ms,
      onGone: gone,
      undo: () => {
        undo();
        mailUndoSlot.clear(id);
      },
    });
    return;
  }
  toast(options.label, {
    duration: options.ms ?? UNDO_SLOT_MS,
    onAutoClose: gone,
    onDismiss: gone,
    action: { label: mailSay("undo"), onClick: undo },
  });
}
