"use client";

/*
 * Edit as new, off MailPage: a message copied out as the start of a new
 * one, to send again.
 *
 * Owns: finding the message to copy (ours, first in the thread, or the one
 * named), copying its words, subject and files into a stored draft, and
 * opening a composer on that draft.
 *
 * Does not own: the composer. It opens through `startCompose`, passed in.
 *
 * No effects. `editAsNewMessageRef` holds the newest `editAsNewMessage`
 * for handlers that were made before it.
 */

import * as React from "react";

import { toast } from "@/lib/mail/toast";
import { mailApiFetch, mailApiJson as apiJson } from "@/lib/mail/api";
import { attachmentUrl } from "@/lib/mail/attachment-save";
import {
  newComposeDraftKey,
  saveComposeDraft,
  type DraftAttachmentSnapshot,
} from "@/lib/mail/local-drafts";
import { sanitizeEmailHtml, stripQuotedHtml } from "@/lib/mail/email-html";
import { plainTextToEditorHtml } from "@/lib/client-email-html";
import { restoreAnchorsForEditing } from "@/lib/mail/soften-anchors";
import { dropRemoteImagesForEditing } from "@/lib/mail/editor-html";
import { formatEmailBody, stripQuotedReplies } from "@/lib/email-mime";
import { decodeHtmlEntities } from "@/lib/html-entities";
import type { useMailT } from "@/lib/mail/i18n";
import type { MailMessage, MailThreadDetail } from "@/lib/mail/types";

export function useEditAsNew({
  startCompose,
  t,
}: {
  startCompose: (seed: {
    to: string[];
    subject: string;
    continuedFromLabel: string;
    draftKey?: string;
  }) => void;
  t: ReturnType<typeof useMailT>;
}) {
  /**
   * A message's attachments, as the snapshots a draft carries.
   *
   * The bytes, not a reference: a draft holds what it will send, so it
   * survives the message it came from being archived or deleted. One that
   * cannot be fetched is left out rather than left broken — the strip
   * shows what is really there.
   */
  const draftAttachmentsOf = React.useCallback(
    async (
      account: string,
      message: MailMessage
    ): Promise<DraftAttachmentSnapshot[]> => {
      const out: DraftAttachmentSnapshot[] = [];
      for (const attachment of message.attachments ?? []) {
        try {
          const res = await mailApiFetch(
            attachmentUrl({ account, messageId: message.id, attachment })
          );
          if (!res.ok) continue;
          const blob = await res.blob();
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const url = String(reader.result || "");
              resolve(url.slice(url.indexOf(",") + 1));
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          });
          out.push({
            id: `att-copy-${out.length}-${attachment.filename}`,
            filename: attachment.filename,
            mimeType: attachment.mimeType || blob.type,
            size: blob.size,
            progress: null,
            contentBase64: base64,
          });
        } catch {
          // Left out. A file that will not come is not one to promise.
        }
      }
      return out;
    },
    []
  );

  /**
   * A message copied out as a new one, to send again.
   *
   * The words and the subject, and nobody in To. A mail worth reusing is a
   * mail being sent to somebody else — carrying the old recipients over
   * would put the last person one keystroke away from getting it twice.
   */
  const editAsNewFromSource = React.useCallback(
    async (account: string, subject: string, source: MailMessage) => {
      try {
        const key = newComposeDraftKey();
        await saveComposeDraft({
          key,
          kind: "compose",
          from: account,
          // The subject without the marks a conversation put on it: this
          // is the first message of another one.
          subject: subject
            .replace(/^\s*((re|fwd?|sv|vs)\s*(\[\d+\])?:\s*)+/i, "")
            .trim(),
          /*
            Its own words, without the conversation under them.

            A mail carries the tail of what it answered, and one being
            reused as a template is being taken out of that conversation —
            so the quoted history is somebody else's message, pasted into
            a new one going to a third party.
          */
          body: source.bodyHtml
            ? (() => {
                const safe = sanitizeEmailHtml(source.bodyHtml);
                const split = stripQuotedHtml(safe);
                const kept =
                  split.hadQuote && split.html.trim() ? split.html : safe;
                // The reader softens every link into a span for its click
                // bridge. An editor knows nothing of that bridge and would
                // keep the words while dropping the address, so the links
                // are put back before the copy is written.
                return dropRemoteImagesForEditing(
                  restoreAnchorsForEditing(kept)
                );
              })()
            : plainTextToEditorHtml(
                stripQuotedReplies(
                  decodeHtmlEntities(formatEmailBody(source.bodyText || ""))
                ).trim() || source.bodyText || ""
              ),
          toList: [],
          ccList: [],
          bccList: [],
          showCc: false,
          showBcc: false,
          includeSignature: false,
          // Its files as well. Most of what is worth sending again is worth
          // sending again with the programme, the invoice or the slides
          // that made it worth sending the first time.
          attachments: await draftAttachmentsOf(account, source),
        });
        startCompose({
          to: [],
          subject: "",
          continuedFromLabel: "",
          draftKey: key,
        });
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : t("editAsNewFailed")
        );
      }
    },
    [draftAttachmentsOf, startCompose, t]
  );

  /**
   * Our own first message in the thread, because a mail reused as a
   * template is the one we wrote to start it. Failing that, the first
   * one there is.
   *
   * Pass a message id to take that message instead — the hover menu on a
   * bubble does, so a later mail in the thread can be the copy.
   */
  const editAsNewMessage = React.useCallback(
    async (
      row: { account: string; threadId: string },
      messageId?: string
    ) => {
      try {
        if (messageId) {
          const params = new URLSearchParams({
            account: row.account,
            id: row.threadId,
            markRead: "0",
            around: messageId,
          });
          const json = await apiJson<{ thread: MailThreadDetail }>(
            `/api/mail/thread?${params.toString()}`
          );
          const source = json.thread.messages.find((m) => m.id === messageId);
          if (!source) {
            toast.error(t("editAsNewFailed"));
            return;
          }
          await editAsNewFromSource(row.account, json.thread.subject, source);
          return;
        }

        // The open thread loads the newest page. The first mail we sent
        // is at the other end, so this walks from the start until it
        // finds one of ours.
        let after: string | null = null;
        let subject = "";
        let source: MailMessage | undefined;
        let first: MailMessage | undefined;
        for (let page = 0; page < 20; page += 1) {
          const params = new URLSearchParams({
            account: row.account,
            id: row.threadId,
            markRead: "0",
          });
          if (after) params.set("after", after);
          else params.set("oldest", "1");
          const json = await apiJson<{ thread: MailThreadDetail }>(
            `/api/mail/thread?${params.toString()}`
          );
          subject = json.thread.subject;
          const messages = json.thread.messages;
          if (!first) first = messages[0];
          source = messages.find((m) => m.own);
          if (source) break;
          const last = messages[messages.length - 1];
          if (!json.thread.hasNewer || !last) break;
          after = last.id;
        }
        source = source ?? first;
        if (!source) {
          toast.error(t("editAsNewEmpty"));
          return;
        }
        await editAsNewFromSource(row.account, subject, source);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : t("editAsNewFailed")
        );
      }
    },
    [editAsNewFromSource, t]
  );
  const editAsNewMessageRef = React.useRef(editAsNewMessage);
  editAsNewMessageRef.current = editAsNewMessage;

  return { editAsNewFromSource, editAsNewMessage, editAsNewMessageRef };
}
