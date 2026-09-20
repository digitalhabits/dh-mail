"use client";

/*
 * The beginning of the open thread, off the pane component: whether the
 * thread is taller than its pane, the first message fetched on its own for
 * the chip in the header, the peek at it, and the jump to the start. It
 * reads the stream's state and replaces the window when the reader jumps.
 *
 * The state lives here. New work on the header chip, the peek or the jump
 * goes in this file, not in ThreadPane.
 */

import * as React from "react";
import { toast } from "@/lib/mail/toast";
import { mailApiJson as apiJson } from "@/lib/mail/api";
import { afterMailPaneSlide } from "@/lib/mail/pane-slide";
import { stripQuotedHtml } from "@/components/mail/EmailHtmlView";
import { readImageChoices } from "@/components/mail/MailBubble";
import type { MailChatRef } from "@/lib/mail/chat-types";
import type { MailMessage, MailThreadDetail } from "@/lib/mail/types";
import type { useThreadStreamState } from "@/components/mail/use-thread-stream";

export function useThreadStart(
  stream: ReturnType<typeof useThreadStreamState>,
  input: {
    account: string;
    threadId: string;
    scrollRef: React.RefObject<HTMLDivElement | null>;
    /** Claimed before the window is replaced — see useThreadStream. */
    skipOpenPinRef: React.RefObject<boolean>;
    loadImagesByDefault: boolean;
    /** Thread involves CRM contacts — remote images load by default. */
    inCrm: boolean;
    onChatThreadChanged: (
      threadId: string,
      chat: MailChatRef,
      focusMessageId?: string
    ) => void;
  }
) {
  const { thread, setThread, chatParts, olderParts, setOlderParts } = stream;
  const {
    account,
    threadId,
    scrollRef,
    skipOpenPinRef,
    loadImagesByDefault,
    inCrm,
    onChatThreadChanged,
  } = input;

  /**
   * True when the thread is taller than the pane it sits in.
   *
   * The chip in the header exists to reach a beginning that has scrolled out
   * of sight. On a thread that fits, it would point at something already on
   * screen, so it is not offered.
   */
  const [threadOverflows, setThreadOverflows] = React.useState(false);
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // A few pixels of slack: a thread one line over is not one you lose your
    // place in, and a chip that flickers on a resize is worse than no chip.
    const measure = () =>
      setThreadOverflows(el.scrollHeight > el.clientHeight + 24);
    measure();
    const observer = new ResizeObserver(() => {
      if (afterMailPaneSlide(measure)) return;
      measure();
    });
    observer.observe(el);
    const content = el.firstElementChild;
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, [thread, olderParts, scrollRef]);

  const [firstPeekOpen, setFirstPeekOpen] = React.useState(false);
  React.useEffect(() => {
    setFirstPeekOpen(false);
  }, [threadId]);

  /**
   * Put a message in view, the same way the search deep-link does.
   *
   * A message that has just been prepended is not in the document yet, so
   * this waits a few frames for it rather than doing nothing.
   */
  const scrollToMessage = React.useCallback(async (id: string) => {
    const selector = `[data-message-id="${id
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')}"]`;
    for (let attempt = 0; attempt < 20; attempt++) {
      const el = scrollRef.current;
      const target = el?.querySelector<HTMLElement>(selector);
      if (el && target) {
        const paneTop = el.getBoundingClientRect().top;
        const targetTop = target.getBoundingClientRect().top;
        el.scrollTo({
          top: Math.max(0, el.scrollTop + (targetTop - paneTop) - 16),
          behavior: "auto",
        });
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
  }, [scrollRef]);

  /**
   * The message the thread opened with, fetched on its own.
   *
   * One request, whatever the thread's size: the provider's id list already
   * says where a thread begins, so the oldest page is directly addressable and
   * `limit: 1` asks for that one message. Reading back to it a window at a
   * time would fetch the whole thread to show its first line.
   */
  const [firstMessage, setFirstMessage] = React.useState<MailMessage | null>(
    null
  );

  /**
   * The provider thread holding this conversation's beginning.
   *
   * A rotated conversation keeps its first message in part one, which is a
   * different provider thread from the one on screen. Asking the open thread
   * for its oldest message names the day that part started — on a long chat,
   * days or years after the conversation did.
   *
   * Null while a chat's parts are still arriving. No chip is better than a
   * chip that names the wrong day and corrects itself a moment later.
   */
  const firstPartThreadId = React.useMemo(() => {
    if (!thread?.chat) return threadId;
    if (!chatParts.length) return null;
    return (
      chatParts.find((p) => p.partIndex === 1)?.providerThreadId ?? threadId
    );
  }, [thread?.chat, chatParts, threadId]);

  React.useEffect(() => {
    setFirstMessage(null);
    if (!firstPartThreadId || !account) return;
    let cancelled = false;
    void (async () => {
      try {
        const params = new URLSearchParams({
          account,
          id: firstPartThreadId,
          oldest: "1",
          limit: "1",
          // Reading the first line of a thread is not reading the thread.
          markRead: "0",
        });
        const json = await apiJson<{ thread: MailThreadDetail }>(
          `/api/mail/thread?${params.toString()}`
        );
        if (!cancelled) setFirstMessage(json.thread.messages[0] ?? null);
      } catch {
        // The chip simply does not appear. Nothing else depends on it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firstPartThreadId, account]);

  /**
   * The first message as the thread shows it, not as a stripped-down line.
   *
   * The peek held a plain-text snippet, and a plain-text snippet is a
   * different message from the one below it: a sender who writes in HTML
   * puts links, headings and pictures in tags, and the text alternative
   * beside it — where there is one at all — carries that markup as words.
   * A GitHub notification opened this peek with `<img width="393"
   * height="924" src="…">` sitting in the middle of a sentence.
   *
   * Quoted history is dropped, the same as the bubble's own first view of a
   * message: a peek is the last place to spend six lines on a reply's
   * quotation of what came before it.
   */
  const firstPeekHtml = React.useMemo(() => {
    if (!firstMessage?.bodyHtml) return null;
    const split = stripQuotedHtml(firstMessage.bodyHtml);
    return split.hadQuote ? split.html : firstMessage.bodyHtml;
  }, [firstMessage?.bodyHtml]);

  /**
   * Whether this sender's pictures may load here.
   *
   * The same question the bubble asks, answered from the same two places,
   * so the peek cannot fetch anything the thread would have refused.
   */
  const firstPeekAllowImages = React.useMemo(() => {
    if (!firstMessage) return false;
    const sender = firstMessage.fromEmail.trim().toLowerCase();
    return loadImagesByDefault || (readImageChoices()[sender] ?? inCrm);
  }, [firstMessage, loadImagesByDefault, inCrm]);

  const [loadingToStart, setLoadingToStart] = React.useState(false);

  /**
   * Move the window to the beginning of the thread.
   *
   * A jump, not a walk. The pane already renders a window that has newer
   * messages beyond it — that is what a search deep-link leaves it in — so the
   * oldest page is one request, and scrolling back down pages forward from
   * there.
   */
  const goToFirstMessage = React.useCallback(async () => {
    if (!firstMessage || !account || !firstPartThreadId) return;

    // The beginning sits in an earlier part, so this is a move between
    // provider threads rather than a wider window on this one. It goes the
    // way a search hit goes: the pane reopens on that part, centred on that
    // message. Widening this thread could never reach it.
    const chatRef = thread?.chat;
    if (firstPartThreadId !== threadId && chatRef) {
      const part = chatParts.find((p) => p.partIndex === 1);
      setFirstPeekOpen(false);
      onChatThreadChanged(
        firstPartThreadId,
        {
          ...chatRef,
          partIndex: 1,
          subject: part?.subject ?? chatRef.subject,
          isOpenPart: part?.status === "open",
        },
        firstMessage.id
      );
      return;
    }

    setLoadingToStart(true);
    // Claimed before the fetch, so the pin cannot win a race with it.
    skipOpenPinRef.current = true;
    try {
      const params = new URLSearchParams({
        account,
        id: threadId,
        oldest: "1",
        markRead: "0",
      });
      const json = await apiJson<{ thread: MailThreadDetail }>(
        `/api/mail/thread?${params.toString()}`
      );
      setOlderParts([]);
      setThread(json.thread);
      await scrollToMessage(firstMessage.id);
      setFirstPeekOpen(false);
    } catch (err) {
      skipOpenPinRef.current = false;
      toast.error(
        err instanceof Error ? err.message : "Couldn't open the start"
      );
    } finally {
      setLoadingToStart(false);
    }
  }, [
    firstMessage,
    account,
    threadId,
    firstPartThreadId,
    thread?.chat,
    chatParts,
    onChatThreadChanged,
    scrollToMessage,
    setOlderParts,
    setThread,
    skipOpenPinRef,
  ]);

  return {
    threadOverflows,
    firstPeekOpen,
    setFirstPeekOpen,
    firstMessage,
    firstPeekHtml,
    firstPeekAllowImages,
    loadingToStart,
    goToFirstMessage,
  };
}
