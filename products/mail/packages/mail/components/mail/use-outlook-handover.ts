"use client";

/*
 * "Open in Outlook instead", off the pane component: the message in the
 * composer goes to Outlook, as a draft in a mailbox this app holds or as a
 * new Outlook message with the body on the pasteboard. ThreadPane hands in
 * what the composer holds. What comes back is the function and whether a
 * hand-over is running.
 *
 * Nothing here writes the composer. It reads the values of one render, and
 * every one of them is in the dependency list: a value left out of that list
 * is how a forward went to Outlook under a reply's subject. If the
 * hand-over needs a new value, add it to the input and to the list.
 */

import * as React from "react";
import { toast } from "@/lib/mail/toast";
import { tauriInvoke } from "@/lib/mail/store/tauri";
import {
  bodyTravels,
  ccBackToSelf,
  copyMessageToClipboard,
  handoverFiles,
  saveAttachmentsForHandover,
  withoutTrailingSignature,
  openOutlookCompose,
  outlookComposeUrl,
} from "@/lib/mail/outlook-compose";
import { sanitizeEmailHtml } from "@/components/mail/EmailHtmlView";
import { quotedReplyMessage } from "@/lib/mail/reaction-message";
import { bodyToEmailHtml, htmlToPlainText } from "@/lib/client-email-html";
import { formatEmailBody } from "@/lib/email-mime";
import { decodeHtmlEntities } from "@/lib/html-entities";
import { mailApiJson as apiJson } from "@/lib/mail/api";
import {
  flattenRecipientsForSend,
  type MailRecipient,
} from "@/lib/mail/contact-list-types";
import { messageStamp } from "@/lib/mail/date-format";
import { markDraftHandedOver, threadDraftKey } from "@/lib/mail/local-drafts";
import type { MailMessage, MailThreadDetail } from "@/lib/mail/types";
import { mailSay } from "@/lib/mail/i18n";

/** The quoted message as the send and the hand-over carry it. */
type QuotePayload = Parameters<typeof quotedReplyMessage>[1];
/** What `useDraftAttachments().payload()` answers. */
type AttachmentPayload = Awaited<
  Parameters<typeof saveAttachmentsForHandover>[0]
>;

export function useOutlookHandover(input: {
  account: string;
  threadId: string;
  thread: MailThreadDetail | null;
  attachmentPayload: () => AttachmentPayload;
  attachmentsReady: boolean;
  toList: MailRecipient[];
  ccList: MailRecipient[];
  fromAccount: string;
  /** The mailbox the draft is made in. Empty means no mailbox of ours. */
  outlookTarget: string | null | undefined;
  outlookElsewhere: boolean;
  historyAppendix: { text: string; html: string } | null;
  includeSignature: boolean;
  quoteMessageId: string | null;
  quotePayload: QuotePayload;
  reply: string;
  replyText: string;
  forwarding: boolean;
  forwardSource: MailMessage | undefined;
  outgoingSubject: string;
  /** The reader's signature, as HTML. It is taken off the end of the body. */
  signature: string | undefined;
  /**
   * Close the composer. Its identity never changes, so the toast's button
   * can hold it for its twelve seconds — see `close` in useThreadComposer.
   */
  closeComposer: () => void;
}) {
  const {
    account,
    threadId,
    thread,
    attachmentPayload,
    attachmentsReady,
    toList,
    ccList,
    fromAccount,
    outlookTarget,
    outlookElsewhere,
    historyAppendix,
    includeSignature,
    quoteMessageId,
    quotePayload,
    reply,
    replyText,
    forwarding,
    forwardSource,
    outgoingSubject,
    signature,
    closeComposer,
  } = input;

  /**
   * Finish this one in Outlook.
   *
   * Not a file handed to Outlook: it previews such a file read-only, which
   * is a message to look at rather than one to write. The draft is made in
   * the mailbox instead, where Outlook is already looking — it appears in
   * Drafts, formatted, editable, in the conversation it answers.
   *
   * Nothing here is sent and nothing is thrown away: the reply stays in this
   * composer, so the reader who changes their mind has lost nothing.
   */
  const [handingOver, setHandingOver] = React.useState(false);
  /**
   * The copy this app is keeping, once the message has gone to Outlook.
   *
   * A handover is not a send: the message is in Outlook, or on the
   * pasteboard, and whether it ever leaves is decided over there. So the
   * draft stays here — and then stays, and stays, because nothing in this
   * app will ever see it sent. That is how a Drafts list fills with mail
   * that went out weeks ago.
   *
   * The reader is the only one who knows, and they know it now, with the
   * message in front of them in Outlook. So the toast asks. One press, and
   * the composer closes the way discarding closes it.
   */
  const handoverDiscard = React.useCallback(
    () => ({
      action: {
        label: mailSay("discardTheCopyHere"),
        onClick: () => closeComposer(),
      },
      duration: 12_000,
    }),
    [closeComposer]
  );

  const openInOutlook = React.useCallback(async () => {
    const attachments = attachmentPayload();
    const flatTo = flattenRecipientsForSend(toList);
    const flatCc = flattenRecipientsForSend(ccList);
    if (!thread || !flatTo.emails.length || handingOver) return;
    if (!attachmentsReady) {
      toast.error(mailSay("stillPreparingAttachments"));
      return;
    }
    const chatNoQuote = Boolean(thread.chat && thread.chat.noQuote !== false);
    /**
     * A forward hands over as a forward.
     *
     * This built a reply whatever the composer was doing: the subject went
     * over as "Re:" and the message being forwarded was left behind
     * entirely, so what opened in Outlook was an empty reply to the wrong
     * subject. The forward carries its own subject — the writer's, if they
     * changed it — and the message underneath.
     */
    const forwardHandover = forwarding && forwardSource
      ? {
          fromName: forwardSource.fromName,
          fromEmail: forwardSource.fromEmail,
          date: messageStamp(forwardSource.sentAt),
          subject: thread.subject,
          to: forwardSource.toEmails,
          text: decodeHtmlEntities(
            formatEmailBody(forwardSource.bodyText)
          ).trim(),
          html: forwardSource.bodyHtml
            ? sanitizeEmailHtml(forwardSource.bodyHtml)
            : undefined,
        }
      : undefined;
    const handoverSubject = outgoingSubject;
    const pickedQuote = quoteMessageId ? quotePayload : undefined;
    const noQuote = chatNoQuote || Boolean(pickedQuote);
    const composed = quotedReplyMessage(
      replyText,
      pickedQuote,
      replyText.trim() ? bodyToEmailHtml(reply) : undefined
    );
    setHandingOver(true);
    try {
      /*
        No mailbox of ours: a new Outlook message, and the body pasted in.

        The mailbox the reader wants is often one this app can never hold a
        token for — a university that will not approve a third-party client
        cannot be handed a draft over Graph either. Outlook opens on the
        recipients and the subject, and the message waits on the pasteboard
        with its formatting intact.
      */
      if (!outlookTarget) {
        const html = replyText.trim() || pickedQuote ? composed.html : "";
        // Outlook adds its own signature to what it opens; ours stays here.
        const carrying = withoutTrailingSignature(
          { html: html || composed.text, text: composed.text },
          htmlToPlainText(signature ?? "")
        );
        // Plain and short: the message rides in the URL and the reader has
        // nothing left to do. Otherwise the pasteboard, which keeps the
        // formatting a mailto: cannot.
        const carried = bodyTravels(carrying.html, carrying.text);
        if (!carried) {
          await copyMessageToClipboard(carrying);
        }
        await openOutlookCompose(
          outlookComposeUrl({
            to: flatTo.emails,
            // A copy back to the mailbox it was written from, so what goes
            // out from Outlook lands in this app's mail too.
            cc: ccBackToSelf({
              from: fromAccount,
              to: flatTo.emails,
              cc: flatCc.emails,
            }),
            subject: handoverSubject,
            body: carried ? carrying.text : undefined,
          })
        );
        /*
          The files, which a mailto: cannot carry.

          They were dropped without a word before this: the message opened
          in Outlook and the attachments simply were not on it. Now they go
          to the downloads folder with the file manager pointed at them, and
          the toast says where they are — or says they did not travel, when
          there is nowhere to put them.
        */
        // What did happen here, recorded: the words went to Outlook. See
        // markDraftHandedOver, and the list, which says so rather than
        // showing the copy as an unfinished letter.
        void markDraftHandedOver(threadDraftKey(account, threadId), fromAccount);
        /*
          The pictures in the body, which the pasteboard cannot carry either.

          The HTML on the pasteboard holds each one as a `data:` URI, and
          Outlook drops those on the paste: the message arrived with its
          words and a gap where each picture had been, and nothing said so.

          A send lifts them into parts of the message — see
          `extractInlineImages` — but here there is no message to make
          parts of. So they go to the downloads folder beside the
          attachments, to be dragged in where they belong. The pasteboard
          keeps them as they are: a `cid:` left in a paste is a broken
          picture rather than none, which is worse than the gap.
        */
        const travelling = handoverFiles(attachments, carrying.html);
        const savedFiles = await saveAttachmentsForHandover(travelling);
        toast.success(
          carried ? mailSay("outlookIsOpen") : mailSay("outlookIsOpenPaste"),
          {
            ...(travelling.length
              ? {
                  description: savedFiles
                    ? mailSay("outlookFilesInDownloads", {
                        count: `${savedFiles} file${savedFiles === 1 ? "" : "s"}`,
                      })
                    : mailSay("outlookFilesLeftBehind", {
                        count: `${travelling.length} file${travelling.length === 1 ? "" : "s"}`,
                      }),
                  duration: 12_000,
                }
              : null),
            ...handoverDiscard(),
          }
        );
        return;
      }
      await apiJson("/api/mail/outlook-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account: outlookTarget,
          to: flatTo.emails,
          cc: flatCc.emails.length ? flatCc.emails : undefined,
          bcc: [...flatTo.bccEmails, ...flatCc.bccEmails].length
            ? [...flatTo.bccEmails, ...flatCc.bccEmails]
            : undefined,
          subject: handoverSubject,
          body: composed.text,
          html:
            replyText.trim() || pickedQuote ? composed.html : undefined,
          // The signature belongs to the mailbox the draft is made in, and
          // the reader picks it up there — asking for this one's would put
          // a Digital Habits sign-off on a university address.
          includeSignature: outlookElsewhere ? false : includeSignature,
          /*
            Threaded only where the conversation exists.

            Graph finds the message to reply to by this id, in this mailbox.
            A thread that arrived somewhere else — forwarded in from the
            university, most of the time — has no such id here, so the draft
            is a new message: right recipients, right subject, no place in
            the conversation on this side. Nothing is lost that this end
            ever had.
          */
          threadId:
            !outlookElsewhere && fromAccount === account && !forwarding
              ? threadId
              : undefined,
          // The message being forwarded, under whatever was typed above it.
          forward: forwardHandover,
          appendix:
            noQuote || !historyAppendix
              ? undefined
              : { text: historyAppendix.text, html: historyAppendix.html },
          attachments: attachments.length ? attachments : undefined,
        }),
      });
      // The draft is in the mailbox whether or not Outlook can be raised, so
      // a Mac without it still gets the good news and where to look.
      /*
        The draft is made either way, so a window that will not come
        forward is worth saying out loud rather than logging: the reader is
        looking at this toast, not at a console, and "it did nothing" is
        what a silent failure looks like from there.
      */
      const invoke = tauriInvoke();
      const refused = invoke
        ? await invoke("activate_outlook").then(
            () => "",
            (err: unknown) => {
              console.warn("[mail] couldn't bring Outlook forward:", err);
              // What Rust said, which is what `open` said. A reason on the
              // screen is the difference between a bug report and a shrug.
              return err instanceof Error
                ? err.message
                : String(err) || mailSay("outlookDidNotOpen");
            }
          )
        : mailSay("outlookDidNotOpen");
      const landed = outlookElsewhere
        ? mailSay("draftIsInOutlookFrom", { account: outlookTarget })
        : mailSay("draftIsInOutlook");
      void markDraftHandedOver(threadDraftKey(account, threadId), fromAccount);
      toast.success(landed, {
        ...(refused ? { description: refused } : null),
        ...handoverDiscard(),
      });
    } catch (err) {
      const fallback = outlookTarget
        ? mailSay("couldNotDraftInOutlook")
        : mailSay("couldNotOpenOutlook");
      /*
        Tauri refuses with a string, not an Error.

        Reading `.message` off it and falling back to a sentence of our own
        threw away the only line that said what was wrong — "command not
        found", when the window is older than the command it is calling.
      */
      const said =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : "";
      toast.error(said.trim() || fallback);
    } finally {
      setHandingOver(false);
    }
  }, [
    account,
    attachmentPayload,
    attachmentsReady,
    ccList,
    fromAccount,
    outlookTarget,
    outlookElsewhere,
    handingOver,
    historyAppendix,
    includeSignature,
    quoteMessageId,
    quotePayload,
    reply,
    replyText,
    thread,
    threadId,
    toList,
    // A forward hands over as a forward — without these the callback keeps
    // the first render's answer and sends a reply's subject either way.
    forwarding,
    forwardSource,
    outgoingSubject,
    handoverDiscard,
    // The signature that is taken off the end of the message. It loads after
    // the first render, and the reader can change it while the composer is
    // open.
    signature,
  ]);

  return { handingOver, openInOutlook };
}
