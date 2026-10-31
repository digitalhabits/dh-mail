"use client";

/**
 * Delete and Unschedule on a scheduled message, with Undo (2026-10-31).
 *
 * Neither can be taken back from the server. So the message leaves the list
 * and its conversation at once, the confirmation stands at the foot of the
 * list with Undo, and the server is asked when that time is over. If the
 * window closes first, it is asked then (flushPendingDiscards). Undo shows
 * the message again, and nothing was changed.
 *
 * Unschedule of a message in this computer's outbox makes its draft here
 * at once, so it is in Drafts straight away. The outbox lets the message go
 * when the Undo time is over. Undo deletes that draft again.
 *
 * One exception: a message due within the Undo time could be sent while it
 * waits. For that one the action is done at once, with no Undo. A missed
 * message is never sent by itself, so it always gets the Undo.
 */

import { confirmWithUndo } from "@/components/mail/undo-confirm";
import { mailApiJson as apiJson } from "@/lib/mail/api";
import { mailSay } from "@/lib/mail/i18n-strings";
import type { UnscheduleResult } from "@/lib/mail/inbox";
import { deleteDraft, getDraft, newComposeDraftKey, saveComposeDraft } from "@/lib/mail/local-drafts";
import { cancelPendingDiscard, DISCARD_UNDO_MS, schedulePendingDiscard } from "@/lib/mail/pending-discard";
import { asSnapshot, draftFromHeld } from "@/lib/mail/scheduled-held";
import { hideLeavingScheduled, notifyScheduledChanged, unhideLeavingScheduled } from "@/lib/mail/scheduled-events";
import { toast } from "@/lib/mail/toast";
import type { UndoSlotAction } from "@/lib/mail/undo-slot";
import type { MailScheduledMessage } from "@/lib/mail/types";

/** How long before its time a message is too close to wait for Undo. */
const TOO_CLOSE_MS = DISCARD_UNDO_MS + 30_000;

/** True when the message can wait out the Undo time without being sent. */
export function canWaitForUndo(held: MailScheduledMessage, now = Date.now()): boolean {
  if (held.missed) return true;
  if (held.status === "sending") return false;
  if (held.status === "failed") return true;
  return Date.parse(held.sendAt) - now > TOO_CLOSE_MS;
}

type Action = "delete" | "unschedule" | "cancel";

function post<T = { success?: boolean }>(held: MailScheduledMessage, action: Action): Promise<T> {
  return apiJson<T>("/api/mail/scheduled", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account: held.account, id: held.id, action }),
  });
}

function said(err: unknown): void {
  toast.error(err instanceof Error ? err.message : "Couldn't change the message");
}

/**
 * Hide it, then run `act` when the Undo time is over (or now, when the
 * message cannot wait). If `act` fails, the message is shown again.
 */
function laterWithUndo(
  held: MailScheduledMessage,
  notice: { action: UndoSlotAction; verb: string },
  act: () => Promise<unknown>,
  onUndo: () => void = () => {}
): void {
  hideLeavingScheduled(held);
  const run = () =>
    void act()
      .catch((err) => {
        unhideLeavingScheduled(held);
        said(err);
      })
      .finally(notifyScheduledChanged);
  if (!canWaitForUndo(held)) {
    run();
    return;
  }
  const key = `scheduled-${notice.action}:${held.account.trim().toLowerCase()}|${held.id}`;
  schedulePendingDiscard(key, run);
  confirmWithUndo({
    action: notice.action,
    verb: notice.verb,
    object: held.subject,
    label: notice.verb,
    ms: DISCARD_UNDO_MS,
    onUndo: () => {
      cancelPendingDiscard(key);
      onUndo();
      unhideLeavingScheduled(held);
    },
  });
}

/** Delete: it is never sent, and nothing is kept. `onUndo` runs too, on Undo. */
export function deleteHeldWithUndo(held: MailScheduledMessage, onUndo?: () => void): void {
  laterWithUndo(held, { action: "trash", verb: mailSay("scheduledDeleted") }, () => post(held, "delete"), onUndo);
}

/** The scheduled message an edit in the composer replaces. */
export type EditedOriginal = { account: string; id: string; sendAt: string };

/** An outbox message's id is its row number (inbox-send.ts, heldInOutbox). */
const isOutboxId = (id: string) => /^\d+$/.test(id);

/** The original as a scheduled message, for the steps above. */
function asHeld(original: EditedOriginal, subject: string): MailScheduledMessage {
  const missed = Date.parse(original.sendAt) <= Date.now();
  return {
    id: original.id,
    account: original.account,
    sendAt: original.sendAt,
    threadId: "",
    toName: "",
    subject,
    bodyText: "",
    to: [],
    cc: [],
    heldHere: isOutboxId(original.id),
    ...(missed ? { missed: true, status: "failed" as const } : null),
  };
}

/** The bin while editing: the scheduled message is deleted, with Undo. */
export function deleteEditedOriginal(original: EditedOriginal, subject: string, onUndo: () => void): void {
  deleteHeldWithUndo(asHeld(original, subject), onUndo);
}

/**
 * Don't schedule, while editing (2026-10-31): the edited words are kept as
 * a plain draft, and the original is not sent. An outbox message is deleted:
 * the edit carries its words and its files. A message the mailbox holds is
 * unscheduled there, where it keeps its files. The edited draft is then kept
 * too, only if it was changed (`changed`); else it goes, so there is one draft.
 */
export function keepEditAsDraft(
  original: EditedOriginal,
  subject: string,
  edit: { draftKey: string; changed: boolean },
  onUndo: () => void
): void {
  const held = asHeld(original, subject);
  laterWithUndo(
    held,
    { action: "move", verb: mailSay("keptAsDraft") },
    async () => {
      if (held.heldHere) {
        await post(held, "delete");
        return;
      }
      await post(held, "unschedule");
      if (!edit.changed) await deleteDraft(edit.draftKey);
    },
    onUndo
  );
}

/**
 * Unschedule: it is never sent at its time, and stays as an ordinary draft.
 * If the draft for an outbox message cannot be saved, the message stays
 * scheduled, and the reader is told.
 */
export async function unscheduleHeldWithUndo(held: MailScheduledMessage): Promise<void> {
  const notice = { action: "move" as const, verb: mailSay("movedToDrafts") };
  if (!held.heldHere) {
    laterWithUndo(held, notice, () => post(held, "unschedule"));
    return;
  }
  // Gone from the list now: the steps below can take a moment.
  hideLeavingScheduled(held);
  // The outbox message: its draft here first, with its files.
  let draftKey: string;
  try {
    const result = await post<{ success?: boolean } & Partial<UnscheduleResult>>(held, "unschedule");
    draftKey = newComposeDraftKey();
    const files = result.kept === "local" ? (result.attachments ?? []) : [];
    await saveComposeDraft(draftFromHeld(held, draftKey, files.map(asSnapshot)));
    // A draft save says nothing when it fails (a full disk, a private
    // window). So the draft is read back. Without it, the message stays in
    // the outbox.
    if (!(await getDraft(draftKey))) throw new Error(mailSay("unscheduleNotSaved"));
  } catch (err) {
    // Still scheduled: its row comes back.
    unhideLeavingScheduled(held);
    said(err);
    return;
  }
  laterWithUndo(held, notice, () => post(held, "cancel"), () => void deleteDraft(draftKey));
}
