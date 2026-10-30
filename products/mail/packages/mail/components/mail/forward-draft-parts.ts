/**
 * A forward another program asked for through the drafts folder
 * (use-drafts-inbox): its subject, and the files of the message it carries.
 *
 * A person's forward fetches the message's files into the composer when it
 * starts (use-forward-files), and the draft keeps them. A draft from the
 * folder never passes through that composer, so it gets them here, before
 * it is saved. Without them the forward went out with no files: a calendar
 * invite with no calendar entry.
 *
 * A file that cannot be fetched stops the draft. A forward that leaves a
 * file behind and does not say so is worse than no forward.
 */

import { mailApiFetch, mailApiJson } from "@/lib/mail/api";
import { attachmentUrl } from "@/lib/mail/attachment-save";
import type { DraftAttachmentSnapshot, ThreadMailDraft } from "@/lib/mail/local-drafts";
import type { MailThreadDetail } from "@/lib/mail/types";

type ForwardParts =
  | { ok: true; subject: string; files: DraftAttachmentSnapshot[] }
  | { ok: false; reason: string };

async function base64Of(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** The subject a forward of this thread starts with, as the composer gives it. */
export function forwardSubjectOf(threadSubject: string): string {
  return /^fwd?:/i.test(threadSubject) ? threadSubject : `Fwd: ${threadSubject}`;
}

export async function forwardDraftParts(
  draft: Pick<ThreadMailDraft, "account" | "threadId" | "subject" | "quoteMessageId">,
  key: string
): Promise<ForwardParts> {
  const params = new URLSearchParams({ account: draft.account, id: draft.threadId, markRead: "0" });
  let thread: MailThreadDetail;
  try {
    thread = (await mailApiJson<{ thread: MailThreadDetail }>(`/api/mail/thread?${params.toString()}`)).thread;
  } catch {
    return { ok: false, reason: "Mail could not open the thread to forward." };
  }
  const source = draft.quoteMessageId
    ? thread.messages.find((m) => m.id === draft.quoteMessageId)
    : thread.messages[thread.messages.length - 1];
  if (!source) {
    return {
      ok: false,
      reason: draft.quoteMessageId
        ? `The thread has no message ${draft.quoteMessageId} among its newest ones.`
        : "The thread has no message to forward.",
    };
  }
  const files: DraftAttachmentSnapshot[] = [];
  const missing: string[] = [];
  for (const attachment of source.attachments ?? []) {
    try {
      const res = await mailApiFetch(
        // A message merged in from another mailbox is that mailbox's.
        attachmentUrl({ account: source.account ?? draft.account, messageId: source.id, attachment })
      );
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      files.push({
        id: `${key}-fwd-${files.length}`,
        filename: attachment.filename,
        mimeType: attachment.mimeType || blob.type,
        size: blob.size,
        progress: null,
        contentBase64: await base64Of(blob),
      });
    } catch {
      missing.push(attachment.filename);
    }
  }
  if (missing.length) {
    return { ok: false, reason: `Mail could not fetch the message's files: ${missing.join(", ")}. No forward was made.` };
  }
  return { ok: true, subject: draft.subject?.trim() || forwardSubjectOf(thread.subject), files };
}
