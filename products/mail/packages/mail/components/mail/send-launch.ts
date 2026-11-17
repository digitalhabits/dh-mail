/*
 * A message that is ready to go, and the few seconds before it goes.
 *
 * `SendLaunch` is the whole message as Send made it: the request for the
 * provider, the bubble for the thread, and what Undo puts back. It is plain
 * data, so a reply window can hand it to the main window
 * (lib/mail/send-handover.ts), which then runs the same launch.
 *
 * `runSendLaunch` is the count with its Undo. It was the end of `send` and
 * of `sendForward` in use-thread-send.ts. It does its work through
 * `SendLaunchOps`, because there are two places that run it:
 *
 * - a thread pane (use-send-launch.ts), which shows the bubble and puts the
 *   words back in its own reply box
 * - the main window with that conversation not open (`detachedSendOps`
 *   here), which has no bubble, and puts the words back as the thread's
 *   stored draft and opens the conversation
 *
 * No React. The main window says how to open a conversation through
 * `setSendHandoverHost`, and each open pane registers through
 * `registerSendTaker`.
 */

import { sendWithUndo } from "@/components/mail/undo-send";
import { startTeamFollowUp } from "@/components/mail/team-layer";
import type { ReadableThreadAttachment } from "@/components/mail/team-layer-types";
import type { OutboxEntry } from "@/components/mail/thread-messages";
import { mailApiJson as apiJson } from "@/lib/mail/api";
import { noteReplyUnderNewSubject } from "@/components/mail/reply-link-note";
import { mailSay } from "@/lib/mail/i18n";
import { deleteDraft, getDraft, setDraft, threadDraftKey, type ThreadMailDraft } from "@/lib/mail/local-drafts";
import { plainMailError } from "@/lib/mail/plain-mail-error";
import { signalPopoutSend } from "@/lib/mail/popout";
import {
  dropPendingScheduled,
  notifyScheduledChanged,
  settlePendingScheduled,
  showPendingScheduled,
} from "@/lib/mail/scheduled-events";
import { takeOffScheduledOriginal, type ScheduledOriginal } from "@/lib/mail/scheduled-replace";
import { takeAnnouncedHandover } from "@/lib/mail/send-handover";
import { idbHandoverRows } from "@/lib/mail/send-handover-store";
import { toast } from "@/lib/mail/toast";
import type { MailMessage, MailScheduledMessage } from "@/lib/mail/types";
import { sayDone } from "@/lib/mail/undo-slot";

export type SendLaunch = {
  /** The thread that the message was written in. */
  account: string;
  threadId: string;
  /** The id of its bubble and of its outbox row. */
  localId: string;
  entry: OutboxEntry;
  /** The bubble for the thread. Null: a forward, a new subject, a later send. */
  bubble: MailMessage | null;
  /** The one message that the reply answers, for Undo. Null: the thread. */
  quoteMessageId: string | null;
  /** The scheduled message that this one replaces, if it is an edit of one. */
  original: ScheduledOriginal | null;
  /** Set for Send later: the notice, and the row that shows while it waits. */
  later: { notice: string; pending: Omit<MailScheduledMessage, "id"> } | null;
  /** The thread's files, for the follow-up of the records after a send. */
  readableAttachments: ReadableThreadAttachment[];
};

export type SendLaunchOps = {
  /** The outbox row and the bubble. */
  show: (launch: SendLaunch) => void;
  /** Shut the composer that the message was written in. */
  closeComposer: () => void;
  /** The send itself, after the count. */
  dispatch: (launch: SendLaunch) => void;
  /** Undo, or a send that can not start: the words go back. */
  putBack: (launch: SendLaunch) => void;
  /** A later send is with the provider: look at the scheduled list again. */
  scheduledChanged: () => void;
  /** Close the card or the window that held this message and nothing else. */
  closeCard: () => void;
};

/** Hold the message for the count, with Undo, then send it. */
export function runSendLaunch(launch: SendLaunch, ops: SendLaunchOps): void {
  const { entry, original, later } = launch;
  /**
   * A message that has not gone yet does not belong in the conversation.
   *
   * The ordinary path paints the bubble straight away, because the send is
   * on its way and the bubble is only ahead of the provider's copy. This
   * one is not on its way — Exchange is holding it until the time — so the
   * thread would be showing the reader something they have not said.
   */
  if (later) {
    // As a send: the composer closes, and for a few seconds nothing has
    // been handed to anybody, so Undo puts the words back as they were.
    // One notice, which says the one condition: a message this computer
    // sends goes only if it is on with Mail open (docs/mail-send-later.md).
    ops.closeComposer();
    const pendingId = showPendingScheduled(later.pending, original);
    sendWithUndo({
      object: entry.request.subject,
      label: () => later.notice,
      onSend: () =>
        void (async () => {
          try {
            if (original) await takeOffScheduledOriginal(original);
            await apiJson("/api/mail/send", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(entry.request),
            });
            settlePendingScheduled(pendingId);
            ops.closeCard();
            // Twice: the message is held as a draft, and Exchange takes a
            // moment to have it. The first look usually finds it; the
            // second is for when it does not.
            ops.scheduledChanged();
            notifyScheduledChanged();
            window.setTimeout(() => {
              ops.scheduledChanged();
              notifyScheduledChanged();
            }, 1500);
          } catch (err) {
            dropPendingScheduled(pendingId);
            toast.error(err instanceof Error ? err.message : "Couldn't schedule the message");
            ops.putBack(launch);
          }
        })(),
      onUndo: () => {
        dropPendingScheduled(pendingId);
        ops.putBack(launch);
      },
    });
    return;
  }

  ops.show(launch);
  ops.closeComposer();
  /**
   * A few seconds before it leaves.
   *
   * The bubble is already in the thread and the composer is already shut,
   * which is what the reader wanted; what has not happened is the send.
   * Undo is the edit that was always there — it takes the bubble back out
   * and puts the words back in the box.
   */
  sendWithUndo({
    object: entry.request.subject,
    onSend: () => {
      // An edit of a scheduled reply, sent now: the original goes first,
      // and if it cannot, this one is put back rather than sent.
      if (original) {
        void takeOffScheduledOriginal(original).then(
          () => ops.dispatch(launch),
          (err: unknown) => {
            toast.error(err instanceof Error ? err.message : "Couldn't take the scheduled message off");
            ops.putBack(launch);
          }
        );
      } else ops.dispatch(launch);
      // And now the card, which was this message and nothing else. The
      // send takes what it needs with it, so nothing here is waited for.
      ops.closeCard();
    },
    // With the launch, not by a look in the outbox. Each new answer about
    // the thread clears the outbox of rows that have no bubble, and a
    // message with no bubble would then have nothing to come back from.
    onUndo: () => ops.putBack(launch),
  });
}

/**
 * An open thread pane of the main window, which can take a handed-over
 * message: it shows the bubble, and Undo puts the words in its reply box.
 */
export type SendTaker = {
  account: string;
  threadId: string;
  /** False: this pane does not take it now (its own composer is open). */
  take: (launch: SendLaunch) => boolean;
  /** Put the words back in this pane's reply box. */
  putBack: (launch: SendLaunch) => void;
  /** A message is being written in this pane. */
  composerOpen: () => boolean;
};

const takers = new Set<SendTaker>();

export function registerSendTaker(taker: SendTaker): () => void {
  takers.add(taker);
  return () => {
    takers.delete(taker);
  };
}

function findSendTaker(account: string, threadId: string): SendTaker | null {
  for (const taker of takers) {
    if (taker.account === account && taker.threadId === threadId) return taker;
  }
  return null;
}

/** What the main window gives: how to open a conversation in its pane. */
export type SendHandoverHost = {
  openThread: (account: string, threadId: string) => void;
};

let host: SendHandoverHost | null = null;

export function setSendHandoverHost(next: SendHandoverHost): () => void {
  host = next;
  return () => {
    if (host === next) host = null;
  };
}

/** The message as the thread's stored draft, as the composer saves one. */
export function draftFromLaunch(launch: SendLaunch): ThreadMailDraft {
  const { entry } = launch;
  return {
    key: threadDraftKey(launch.account, launch.threadId),
    kind: "thread",
    account: launch.account,
    threadId: launch.threadId,
    mode: entry.mode,
    body: entry.reply,
    subject: entry.subject.trim() || undefined,
    toList: entry.toList,
    ccList: entry.ccList,
    showCc: entry.showCc,
    ...(entry.bccList?.length ? { bccList: entry.bccList } : null),
    editRecipients: entry.editRecipients,
    includeSignature: entry.includeSignature,
    ...(entry.signatureHtml != null ? { signatureHtml: entry.signatureHtml } : null),
    fromAccount: entry.fromAccount,
    replyFocus: false,
    attachments: entry.attachments ?? [],
    quoteMessageId: entry.forward ? entry.forward.quoteMessageId : launch.quoteMessageId,
    updatedAt: Date.now(),
  };
}

/**
 * Put the words back when the pane that showed them is not there.
 *
 * If the conversation is open, the words go into its reply box. If not,
 * they go into the store as that thread's draft, and the conversation
 * opens: the pane reads the draft when it opens, and its composer opens on
 * it.
 */
export function putBackDetached(launch: SendLaunch): void {
  const taker = findSendTaker(launch.account, launch.threadId);
  if (taker) {
    taker.putBack(launch);
    return;
  }
  void setDraft(draftFromLaunch(launch)).then(() => {
    host?.openThread(launch.account, launch.threadId);
  });
}

/**
 * The send with no pane: the request goes, and the list hears of it.
 *
 * A failure can not show a red bubble, because there is no thread on
 * screen. The words go back as the thread's draft, and a notice says so.
 * If something else is written in that thread by then, the draft is not
 * written over: the notice has Retry instead.
 */
async function sendDetached(launch: SendLaunch): Promise<void> {
  const { entry, account, threadId } = launch;
  /* The records' follow-up runs after the send, not inside it: see
     `dispatchOutboxSend` in use-thread-send.ts. */
  const { updateCrmNotes: followUp, ...sendRequest } = entry.request;
  try {
    await apiJson("/api/mail/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sendRequest),
    });
  } catch (err) {
    await sendDetachedFailed(launch, err);
    return;
  }
  if (followUp) {
    startTeamFollowUp({
      origin: { account, threadId },
      sent: {
        to: sendRequest.to,
        cc: sendRequest.cc,
        subject: sendRequest.subject,
        body: sendRequest.body,
      },
      attachments: launch.readableAttachments,
    });
  }
  if (entry.forward) sayDone(mailSay("forwardedTo", { who: entry.forward.who }));
  else if (entry.startsNewThread) {
    sayDone(mailSay("sent"));
    noteReplyUnderNewSubject(account, threadId, entry);
  }
  // The list reads its Sent again, and the conversation reads its newest
  // page if it is open by now.
  signalPopoutSend(entry.request.account, threadId);
}

async function sendDetachedFailed(launch: SendLaunch, err: unknown): Promise<void> {
  const { entry, account, threadId } = launch;
  const who = entry.request.to[0] ?? "";
  const open = findSendTaker(account, threadId);
  const busy = open
    ? open.composerOpen()
    : Boolean(await getDraft(threadDraftKey(account, threadId)));
  if (busy) {
    toast.error(mailSay("handedSendFailed", { who }), {
      description: plainMailError(err),
      duration: 60_000,
      action: { label: mailSay("retry"), onClick: () => void sendDetached(launch) },
    });
    return;
  }
  if (open) open.putBack(launch);
  else await setDraft(draftFromLaunch(launch));
  toast.error(mailSay("handedSendFailedDraft", { who }), {
    description: plainMailError(err),
    duration: 60_000,
    ...(open
      ? null
      : {
          action: {
            label: mailSay("openConversation"),
            onClick: () => host?.openThread(account, threadId),
          },
        }),
  });
}

/** The launch for a conversation that is not open in the main window. */
export const detachedSendOps: SendLaunchOps = {
  show: () => {},
  closeComposer: () => {},
  dispatch: (launch) => void sendDetached(launch),
  putBack: putBackDetached,
  scheduledChanged: () => {},
  closeCard: () => {},
};

const announced = new Set<string>();

/**
 * The main window heard that a reply window offers a message.
 *
 * It claims the offer in the store. Only a claim that the store gave is
 * sent: an offer that was taken before, or that the reply window took
 * back, gives nothing. Then the reply window sees the claim and closes.
 *
 * The conversation's pane takes the message if it is open. If not, the
 * message waits out its count with no bubble.
 */
export async function takeSendHandover(id: string): Promise<void> {
  const launch = await takeAnnouncedHandover<SendLaunch>({
    rows: idbHandoverRows<SendLaunch>(),
    id,
    seen: announced,
  });
  if (!launch) return;
  let launched = false;
  try {
    // The reply window stored its words as the thread's draft before the
    // offer, in case it went away. The message is this window's now.
    void deleteDraft(threadDraftKey(launch.account, launch.threadId));
    const taker = findSendTaker(launch.account, launch.threadId);
    if (taker?.take(launch)) {
      launched = true;
      return;
    }
    runSendLaunch(launch, detachedSendOps);
    launched = true;
  } finally {
    // Claimed, and the count did not start: the words are not lost.
    if (!launched) {
      void setDraft(draftFromLaunch(launch));
      toast.error(mailSay("handedSendNotStarted"), { duration: 60_000 });
    }
  }
}
