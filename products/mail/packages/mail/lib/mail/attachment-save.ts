/**
 * Where an attachment is, and how it is written out.
 *
 * Apart from the tiles that show it: a message's menu saves its files, the
 * composer forwards them, and a test can check what any of that asks for
 * without a React component — and without the PDF viewer the tiles pull in.
 */

import {
  hostSavesAttachments,
  saveAttachment,
} from "@/lib/mail/attachment-source";
import type { MailAttachment } from "@/lib/mail/types";

export function attachmentUrl(opts: {
  account: string;
  messageId: string;
  attachment: MailAttachment;
  download?: boolean;
}): string {
  const params = new URLSearchParams({
    account: opts.account,
    messageId: opts.messageId,
    attachmentId: opts.attachment.attachmentId,
    filename: opts.attachment.filename,
    mimeType: opts.attachment.mimeType,
  });
  if (opts.download) params.set("download", "1");
  return `/api/mail/attachment?${params.toString()}`;
}

/** The files on a message the provider holds — not ones still on their way out. */
export function savableAttachments(
  attachments: MailAttachment[]
): MailAttachment[] {
  return attachments.filter((a) => !a.attachmentId.startsWith("local-"));
}

/** Save one file: the host writes it, or the browser downloads it. */
export async function downloadAttachment(item: {
  path: string;
  filename: string;
}): Promise<void> {
  if (hostSavesAttachments) {
    // The host's own toast carries the error; see openAttachmentOutside.
    await saveAttachment(item).catch(() => undefined);
    return;
  }
  const a = document.createElement("a");
  a.href = item.path;
  a.download = item.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Save every file on this message, one after another.
 *
 * A message with five files is a message where the reader wants all five,
 * and clicking through five previews to save each is the sort of work an
 * app is for. Sequential rather than at once: each save writes a file, and
 * a browser refuses a burst of downloads as a popup.
 */
export async function downloadAllAttachments(
  items: { path: string; filename: string }[]
): Promise<void> {
  for (const item of items) {
    await downloadAttachment(item);
    await new Promise((r) => window.setTimeout(r, 150));
  }
}

/**
 * Save the files on one message from somewhere other than the files.
 *
 * The message's own menu offers this, because the tiles are not always in
 * view: on a long message they are above the fold the reader is at. Files
 * still on their way out are left out — there is nothing to read yet.
 */
export async function saveMessageAttachments(input: {
  account: string;
  messageId: string;
  attachments: MailAttachment[];
}): Promise<void> {
  await downloadAllAttachments(
    savableAttachments(input.attachments).map((attachment) => ({
      path: attachmentUrl({
        account: input.account,
        messageId: input.messageId,
        attachment,
        download: true,
      }),
      filename: attachment.filename,
    }))
  );
}
