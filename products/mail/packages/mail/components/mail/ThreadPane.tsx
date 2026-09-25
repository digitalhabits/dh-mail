"use client";

/**
 * The open thread: its messages, the actions above them, and the reply box.
 *
 * Everything it needs arrives as a prop — it holds no page state of its own,
 * which is why 2,389 lines could leave MailPage without untangling anything.
 */

import { Loader2, Trash2 } from "lucide-react";

import { ThreadFindBar } from "@/components/mail/ThreadFindBar";
import {
  AttachmentPreviewDialog,
  DraftAttachmentPreviewDialog,
} from "@/components/mail/attachment-preview";
import { type MailChatPartSummary } from "@/lib/mail/chat-types";
import { OriginalMessageSheet } from "@/components/mail/OriginalMessageSheet";
import { shortDate } from "@/lib/mail/date-format";
import { draftThreadProblem } from "@/lib/mail/thread-gone";
import { focusChatPopout } from "@/lib/native-shell";
import { cn } from "@/lib/utils";
import { FloatingCardChrome } from "@/components/mail/floating-card";
import { threadPeople } from "@/components/mail/ThreadParticipants";
import { PopoutStrip } from "@/components/mail/PopoutStrip";
import { useThreadPane, type ThreadPaneProps } from "@/components/mail/use-thread-pane";
import { ThreadPaneDialogs, ReplyButtons, ThreadMessages, ThreadHeader } from "@/components/mail/thread-pane-parts";
import { ThreadComposerBand } from "@/components/mail/thread-pane-composer";
import { threadActionClass } from "@/components/mail/thread-pane-classes";


/**
 * The action strip folds from a measurement of the row itself.
 *
 * A pane-width guess misses the attachments chip, Reply all, and the zoom
 * pill. `useThreadToolbarFold` closes the gaps first, then hides one
 * control at a time, the one the pane can spare first, and puts it behind
 * the ellipsis.
 */

export function ThreadPane(props: ThreadPaneProps) {
  const m = useThreadPane(props);
  const {
    account,
    accounts,
    attachItems,
    attachmentPreview,
    bringBackPopout,
    card,
    cardHadComposer,
    draftPreviewId,
    error,
    find,
    floating,
    fromDrafts,
    mode,
    olderParts,
    onChatThreadChanged,
    onFloatReply,
    originalOf,
    popoutOpen,
    replyFocus,
    discardComposer,
    setAttachmentPreview,
    setDraftPreviewId,
    setOriginalOf,
    setPaneNode,
    t,
    thread,
    threadId,
  } = m;

  if (error) {
    /*
      A reply draft whose conversation is gone, or whose mailbox is no
      longer connected: say so, and offer the one thing left to do with it.
      The delete key does the same.

      Straight to the discard, not the "Discard draft?" question: that
      question lives in the thread's own dialogs, which this view does not
      draw, so asking it here showed nothing and deleted nothing. This page
      already says what is going; the toast still offers Undo.
    */
    const problem = fromDrafts ? draftThreadProblem(error) : null;
    if (problem) {
      return (
        <div className="flex flex-col items-start gap-3 px-8 py-8 text-sm text-[var(--mail-chrome-muted)]">
          <p>
            {problem === "mailbox"
              ? t("draftMailboxNotConnected", { account })
              : t("draftThreadGone")}
          </p>
          <button
            type="button"
            className={threadActionClass}
            onClick={discardComposer}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            {t("discardDraft")}
          </button>
        </div>
      );
    }
    return <p className="px-8 py-8 text-sm text-red-600">{error}</p>;
  }
  if (!thread) {
    return (
      <div className="mail-thread-surface flex min-h-0 flex-1 flex-col bg-[var(--mail-thread)]">
        <div
          className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-8 text-sm text-stone-500"
          aria-live="polite"
        >
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
          {t("loadingMessage")}
        </div>
      </div>
    );
  }
  const first = thread.messages[0];
  const last = thread.messages[thread.messages.length - 1];
  /* Everyone on the thread but us — who a saved list would hold. Plainly,
     not memoized: this sits after the early returns above, where a hook
     would change the order React counts. */
  const threadOthers = threadPeople(thread.messages, [account, ...accounts])
    .others;
  const dateRange =
    first?.sentAt && last?.sentAt && shortDate(first.sentAt) !== shortDate(last.sentAt)
      ? `${shortDate(first.sentAt)} – ${shortDate(last.sentAt)}`
      : shortDate(last?.sentAt ?? null);
  // The thread's own total when the provider gave one, so the header does
  // not undercount a thread that is only partly loaded. Older parts still
  // count what is on hand — their totals are not known here.
  const totalMessageCount =
    olderParts.reduce((n, p) => n + p.messages.length, 0) +
    (thread.totalMessageCount ?? thread.messages.length);
  const chat = thread.chat;
  // Missing noQuote on older cached rows means former chat-mode threads.
  const chatStyle = Boolean(chat && chat.noQuote !== false);
  const headerTitle = thread.subject.replace(/^((re|fwd?):\s*)+/i, "");
  // Gmail-style bottom bar: Reply all only when it reaches more people than Reply.
  const showReplyAll =
    new Set(
      [...thread.reply.allTo, ...thread.reply.allCc]
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
    ).size > 1;
  const jumpToPart = (p: MailChatPartSummary) => {
    if (!chat || p.providerThreadId === threadId) return;
    onChatThreadChanged(p.providerThreadId, {
      ...chat,
      partIndex: p.partIndex,
      subject: p.subject,
      isOpenPart: p.status === "open",
    });
  };
  return (
    <div
      ref={setPaneNode}
      /* The size it was dragged to — one for the corner, one for the
         dialog. Put away, neither: that one is its heading, and as wide
         as a heading needs. */
      style={card.style}
      className={cn(
        "mail-thread-surface relative flex flex-col bg-[var(--mail-thread)]",
        floating
          ? // The card. It has a width of its own, so the composer inside
            // measures a pane that width and lays itself out to it — the
            // same rules it follows when a pane is this narrow. Full
            // screen is wide enough that it lays itself out as a pane.
            "mail-floating-reply overflow-hidden rounded-xl border border-stone-300 shadow-2xl"
          : "min-h-0 flex-1",
        card.className,
        /*
          The card is the message being written, so with the composer shut
          there is nothing in it to show — it stood there as an empty thread
          with Reply and Forward on it, over a message that had just gone.

          Out of sight rather than unmounted: the seconds after Send and
          after the bin belong to Undo, which puts the words back in this
          very box. Once the message has left, `closeFloatingCard` takes
          the card away for good.
        */
        floating && !mode && cardHadComposer.current && "hidden"
      )}
    >
      {/*
        The dimmed page, the edges that size the card, and the heading with
        its buttons — all of it the frame both floating cards stand in. The
        card's own way home is the key, not a button: see
        `floatMessageShortcutRef`.
      */}
      <FloatingCardChrome
        card={card}
        title={thread?.subject || "\u2026"}
        hidden={!mode}
        onClose={() => onFloatReply?.()}
      />
      <ThreadHeader m={m} thread={thread} chat={chat} dateRange={dateRange} headerTitle={headerTitle} jumpToPart={jumpToPart} showReplyAll={showReplyAll} threadOthers={threadOthers} totalMessageCount={totalMessageCount} />

      {!floating && !replyFocus && find.open ? (
        <ThreadFindBar
          query={find.query}
          onQueryChange={find.setQuery}
          count={find.count}
          index={find.index}
          onNext={find.next}
          onPrev={find.prev}
          onClose={find.close}
        />
      ) : null}

      {/* The ground the reply sweep plays on: the thread and the composer
          band together, below the toolbar — a band standing absolute
          during the sweep covers the thread, never the controls. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
      {originalOf ? (
        <OriginalMessageSheet
          account={account}
          messageId={originalOf}
          subject={thread?.subject ?? ""}
          onClose={() => setOriginalOf(null)}
        />
      ) : null}
      <ThreadMessages m={m} thread={thread} chat={chat} jumpToPart={jumpToPart} />

      <AttachmentPreviewDialog
        account={account}
        messageId={attachmentPreview?.messageId ?? ""}
        attachment={attachmentPreview?.attachment ?? null}
        siblings={
          attachmentPreview
            ? (thread?.messages.find((m) => m.id === attachmentPreview.messageId)
                ?.attachments ?? [])
            : []
        }
        onSelect={(next) =>
          setAttachmentPreview((current) =>
            current ? { ...current, attachment: next } : current
          )
        }
        onClose={() => setAttachmentPreview(null)}
      />
      <DraftAttachmentPreviewDialog
        items={attachItems}
        previewId={draftPreviewId}
        onSelect={setDraftPreviewId}
        onClose={() => setDraftPreviewId(null)}
      />

      {!mode && popoutOpen ? (
        <PopoutStrip
          onShow={() => void focusChatPopout({ account, threadId })}
          onBringBack={() => void bringBackPopout()}
        />
      ) : null}

      <ReplyButtons m={m} showReplyAll={showReplyAll} />
      <ThreadComposerBand m={m} chatStyle={chatStyle} />
      </div>
      <ThreadPaneDialogs m={m} />
    </div>
  );
}



