/**
 * Edit on a scheduled message, and what Unschedule shares with it: a held
 * message as a draft on this computer. Also which scheduled message opens
 * after one is deleted. Delete and Unschedule themselves, with their Undo,
 * are in components/mail/scheduled-undo.ts.
 */

import type { MailComposeSlice } from "@/components/mail/mail-page-slices";
import { plainTextToEditorHtml } from "@/lib/client-email-html";
import { mailApiJson as apiJson } from "@/lib/mail/api";
import { dropOwnInkForEditing, dropRemoteImagesForEditing } from "@/lib/mail/editor-html";
import type { OutboxAttachment, UnscheduleResult } from "@/lib/mail/inbox";
import {
  listMailDrafts,
  newComposeDraftKey,
  saveComposeDraft,
  type ComposeMailDraft,
  type DraftAttachmentSnapshot,
} from "@/lib/mail/local-drafts";
import type { MailScheduledMessage } from "@/lib/mail/types";

/** A held message as a new-message draft on this computer: for Edit and Unschedule. */
export function draftFromHeld(
  held: MailScheduledMessage,
  key: string,
  attachments: DraftAttachmentSnapshot[] = []
): Omit<ComposeMailDraft, "updatedAt"> {
  const asRecipients = (list: string[]) => list.map((email) => ({ kind: "email" as const, email }));
  return {
    key,
    kind: "compose",
    from: held.account,
    subject: held.subject,
    body: held.bodyHtml
      ? dropOwnInkForEditing(dropRemoteImagesForEditing(held.bodyHtml))
      : plainTextToEditorHtml(held.bodyText),
    toList: asRecipients(held.to),
    ccList: asRecipients(held.cc),
    bccList: asRecipients(held.bcc ?? []),
    showCc: held.cc.length > 0,
    showBcc: Boolean(held.bcc?.length),
    attachments,
    // A draft's words were kept without the signature, which goes on at the
    // send. An outbox message's words carry it already.
    includeSignature: !held.signed,
  };
}

/** A file of an outbox message, as a draft keeps it. */
export function asSnapshot(file: OutboxAttachment): DraftAttachmentSnapshot {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${file.filename}`,
    filename: file.filename,
    mimeType: file.mimeType,
    size: file.size,
    progress: null,
    contentBase64: file.contentBase64,
  };
}

/** The draft key of an edit of this message already under way, if one is. */
async function editUnderWay(held: MailScheduledMessage): Promise<string | null> {
  const drafts = await listMailDrafts().catch(() => []);
  const account = held.account.trim().toLowerCase();
  const found = drafts.find(
    (d) =>
      d.kind === "compose" &&
      d.replacesScheduled?.id === held.id &&
      d.replacesScheduled.account.trim().toLowerCase() === account
  );
  return found?.key ?? null;
}

/**
 * Edit: the scheduled message in a composer, with its time on Send. It
 * goes on as scheduled until Send is pressed (lib/mail/scheduled-replace).
 * There is one edit per message: Edit again opens the same one, with the
 * changes made so far. An outbox message comes with its files.
 */
export async function editHeldInComposer(
  startCompose: MailComposeSlice["startCompose"],
  held: MailScheduledMessage
): Promise<void> {
  const key = (await editUnderWay(held)) ?? (await newEditDraft(held));
  startCompose({ to: [], subject: "", continuedFromLabel: "", draftKey: key });
}

async function newEditDraft(held: MailScheduledMessage): Promise<string> {
  const key = newComposeDraftKey();
  let files: DraftAttachmentSnapshot[] = [];
  if (held.heldHere) {
    // The outbox hands over its files and changes nothing (inbox-send.ts).
    const result = await apiJson<Partial<UnscheduleResult>>("/api/mail/scheduled", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account: held.account, id: held.id, action: "unschedule" }),
    }).catch(() => null);
    if (result?.kept === "local") files = (result.attachments ?? []).map(asSnapshot);
  }
  await saveComposeDraft({
    ...draftFromHeld(held, key, files),
    replacesScheduled: { account: held.account, id: held.id, sendAt: held.sendAt },
  });
  return key;
}

/**
 * Which scheduled message opens after one is deleted: the next in the list,
 * or else the one before it. None when it was the last, and the reader is
 * then empty. A row still in its seconds of Undo is not one to open.
 */
export function nextHeldAfterDelete(
  list: readonly MailScheduledMessage[],
  deleted: { account: string; id: string },
  isPending: (id: string) => boolean = () => false
): MailScheduledMessage | null {
  const rows = list.filter((m) => !isPending(m.id));
  const at = rows.findIndex((m) => m.id === deleted.id && m.account === deleted.account);
  if (at < 0) return null;
  return rows[at + 1] ?? rows[at - 1] ?? null;
}
