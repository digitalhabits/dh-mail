"use client";

/**
 * Floating chat window for one mail thread ("pop out" from the mail client).
 * Rendered by the /mail-popout route inside a small always-on-top Tauri
 * window (see src-tauri open_chat_popout) or a browser popup. Two states:
 *  - expanded: chat bubbles + composer (560pt tall)
 *  - collapsed: a pill with avatar/name/subject; a green badge counts
 *    messages that arrived since the thread was last seen (72pt tall)
 * The OS window is resized to match via resize_chat_popout / resizeTo.
 *
 * Messages render through the thread reader's own MailBubble, so HTML
 * bodies, inline images, quoted-text folding, and attachments behave
 * exactly like the main mail client.
 */

import { ChatComposer, ChatHeader, ChatMessages } from "@/components/mail/chat-popout-parts";
import { MAIL_POPOUT_SENT_KEY, POPOUT_SEEN_PREFIX } from "@/lib/mail/storage-keys";
import { earlierFromSameSender } from "@/lib/mail/repeat-signature";
import * as React from "react";

import { ComposerDropOverlay, useComposerFileDrop, useComposerPaste, useDraftAttachments } from "@/components/mail/draft-attachments";
import {
  DraftAttachmentPreviewDialog,
} from "@/components/mail/attachment-preview";
import { type RichTextEditorHandle } from "@/components/ui/RichTextEditor";
import { bodyToEmailHtml, htmlToPlainText } from "@/lib/client-email-html";
import {
  CHAT_POPOUT_COLLAPSED_HEIGHT,
  CHAT_POPOUT_EXPANDED_HEIGHT,
  CHAT_POPOUT_WIDTH,
  readPopoutSeed,
  signalPopoutSend,
  signalEditAsNewRequest,
  signalForwardRequest,
} from "@/lib/mail/popout";
import { messageStamp } from "@/lib/mail/date-format";
import { quotedReplyMessage, reactionMessage } from "@/lib/mail/reaction-message";
import type { MailMessage, MailThreadDetail } from "@/lib/mail/types";
import { closeChatPopout, resizeChatPopout } from "@/lib/native-shell";
import { actionForEvent } from "@/lib/mail/shortcuts";
import { useMailShortcuts } from "@/lib/mail/use-mail-shortcuts";
import { saveThreadDraft, threadDraftKey } from "@/lib/mail/local-drafts";
import { mailSay, useMailT } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";
import { mailApiJson as apiJson } from "@/lib/mail/api";
import { useMailColorMode } from "@/lib/mail/theme";


const POLL_MS = 30_000;

/** The same page of the same conversation, word for word. */
function sameThreadPage(a: MailThreadDetail, b: MailThreadDetail): boolean {
  if (a.messages.length !== b.messages.length) return false;
  for (let i = 0; i < a.messages.length; i++) {
    const x = a.messages[i];
    const y = b.messages[i];
    if (
      x.id !== y.id ||
      x.bodyText !== y.bodyText ||
      (x.bodyHtml ?? "") !== (y.bodyHtml ?? "")
    ) {
      return false;
    }
  }
  return true;
}





type LocalBubble = {
  id: string;
  bodyText: string;
  /** A reaction paints its emoji and quote, so the bubble matches what went. */
  bodyHtml?: string;
  sentAt: string;
};

/** The thread a chat window shows. */
export type ChatPopoutProps = {
  account: string;
  threadId: string;
  personName: string;
  personEmail: string;
  subject: string;
};

/*
 * How tall the box may grow — about six lines, past which the window is the
 * wrong place for the message — is `max-height` on .mail-chat-input in
 * `mail.css`. The box is not a textarea, because a textarea is the one
 * element that will not grow with its content.
 */

export function ChatPopout({
  account,
  threadId,
  personName,
  personEmail,
  subject,
}: ChatPopoutProps) {
  const { addAttachFiles, attachDragging, attachDropHandlers, attachItems, attachPasteHandlers, attachTotalBytes, attachmentPayload, attachmentsReady, clearAttachments, collapsed, collapsedRef, colorMode, composerKey, composerRef, contentRef, draft, draftPreviewId, draftText, inputRef, lastSeenAt, loadError, localBubbles, ownSignalAtRef, pendingCaretRef, readerScrolledRef, removeAttach, scrollRef, seenKey, sendError, sending, setCollapsed, setComposerKey, setDraft, setDraftPreviewId, setLastSeenAt, setLoadError, setLocalBubbles, setSendError, setSending, setThread, t, thread } = useChatState({ account, threadId });
  const { loadThread, markSeen } = useChatLoad({ account, collapsedRef, ownSignalAtRef, pendingCaretRef, seenKey, setDraft, setLastSeenAt, setLoadError, setLocalBubbles, setThread, threadId });
  const { canLoadOlder, earlierBySender, loadOlder, loadingOlder, messages, unseenCount } = useChatHistory({ account, collapsed, contentRef, lastSeenAt, localBubbles, readerScrolledRef, scrollRef, thread, threadId });
  const { setWindowCollapsed } = useChatWindow({ account, collapsed, collapsedRef, composerRef, draft, draftText, inputRef, markSeen, pendingCaretRef, personEmail, setCollapsed, thread, threadId });
  const { bubbleActions, close, insertEmoji, quotedForReply, send, setQuoteMessageId } = useChatSend({ account, attachmentPayload, attachmentsReady, clearAttachments, draft, draftText, inputRef, loadThread, ownSignalAtRef, personEmail, sending, setComposerKey, setDraft, setLocalBubbles, setSendError, setSending, thread, threadId });

  const header = (
    <ChatHeader close={close} collapsed={collapsed} personEmail={personEmail} personName={personName} setWindowCollapsed={setWindowCollapsed} subject={subject} t={t} unseenCount={unseenCount} />
  );

  return (
    <>
      {/* The Tauri window is transparent; this page draws the rounded card. */}
      <style>{`html, body { background: transparent !important; } body { overflow: hidden; }`}</style>
      {/*
        The card fills the window exactly.

        It does not sit six pixels in with a CSS shadow around it. A shadow
        that size wants about twenty-five, so the window's edge cuts it off
        square. That shows as a hairline under the popout, with the desktop
        showing through the six pixels above it. macOS draws a
        shadow round the window's opaque content by itself, and does not clip
        it, so this leaves that to macOS and keeps only the card.
      */}
      <div className="fixed inset-0 flex">
        <div
          className={cn(
            // mail-shell provides the bubble CSS variables MailBubble uses.
            // min-w-0: never let a long unbreakable token (URLs in emails)
            // widen the card past the window via flex min-content sizing.
            // mail-surface-root: the card is the shell itself, so the dark
            // rules for descendants cannot reach it. See mail.css.
            "mail-shell mail-surface-root flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-surface border border-stone-200 bg-white",
            // relative: the drop overlay covers the card, not the desktop.
            !collapsed && "relative"
          )}
          data-theme={colorMode}
          {...(collapsed ? null : attachDropHandlers)}
        >
          {!collapsed ? <ComposerDropOverlay visible={attachDragging} /> : null}
          {header}
          {!collapsed ? (
            <>
              <ChatMessages account={account} bubbleActions={bubbleActions} canLoadOlder={canLoadOlder} contentRef={contentRef} earlierBySender={earlierBySender} loadError={loadError} loadOlder={loadOlder} loadingOlder={loadingOlder} messages={messages} readerScrolledRef={readerScrolledRef} scrollRef={scrollRef} subject={subject} t={t} thread={thread} />
              {/* The same inset as the messages above, so the box lines up with the
                  bubbles rather than sitting a few pixels inside them. */}
              <ChatComposer addAttachFiles={addAttachFiles} attachItems={attachItems} attachPasteHandlers={attachPasteHandlers} attachTotalBytes={attachTotalBytes} composerKey={composerKey} composerRef={composerRef} draft={draft} inputRef={inputRef} insertEmoji={insertEmoji} quotedForReply={quotedForReply} removeAttach={removeAttach} send={send} sendError={sendError} sending={sending} setDraft={setDraft} setDraftPreviewId={setDraftPreviewId} setQuoteMessageId={setQuoteMessageId} t={t} thread={thread} />
            </>
          ) : null}
        </div>
      </div>
      <DraftAttachmentPreviewDialog
        items={attachItems}
        previewId={draftPreviewId}
        onSelect={setDraftPreviewId}
        onClose={() => setDraftPreviewId(null)}
      />
    </>
  );
}



/** The window's state: the thread, the draft, what is sending, what was seen, the elements, and the attachments. */
export function useChatState({
  account,
  threadId,
}: { account: ChatPopoutProps["account"]; threadId: ChatPopoutProps["threadId"] }) {
  const t = useMailT();
  const colorMode = useMailColorMode();
  /*
    Folded or not — asked of the window, not assumed.

    The window keeps its size across a reload, but the state does not. If
    the state is assumed, a chat parked as a bar comes back as open. It
    draws the header and the composer into fifty-six pixels, and shows a
    clipped name above a box with no conversation over it. Anything that
    reloads the page does this — the app restarting, and the dev server on
    every save.

    The window's own height is the answer. Halfway between the two heights
    is the line, so neither a title bar nor a pixel of rounding can put it
    on the wrong side.
  */
  const [collapsed, setCollapsed] = React.useState(() => {
    if (typeof window === "undefined") return false;
    const midpoint =
      (CHAT_POPOUT_COLLAPSED_HEIGHT + CHAT_POPOUT_EXPANDED_HEIGHT) / 2;
    return window.innerHeight > 0 && window.innerHeight < midpoint;
  });
  const [thread, setThread] = React.useState<MailThreadDetail | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  /**
   * HTML, as the reader's own reply box holds it.
   *
   * A message typed here can be bold or carry a link, so what is typed is
   * not plain text any more. `draftText` below is the same thing in words
   * only — for asking whether anything has been written, and for the plain
   * part of what is sent.
   */
  const [draft, setDraft] = React.useState("");
  const draftText = React.useMemo(() => htmlToPlainText(draft), [draft]);
  /** Bumped to build a new editor, which is how the box is emptied. */
  const [composerKey, setComposerKey] = React.useState(0);
  const [sending, setSending] = React.useState(false);
  const [sendError, setSendError] = React.useState<string | null>(null);
  const [localBubbles, setLocalBubbles] = React.useState<LocalBubble[]>([]);
  const seenKey = `${POPOUT_SEEN_PREFIX}${account}|${threadId}`;
  const [lastSeenAt, setLastSeenAt] = React.useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(seenKey) ?? "";
  });
  const collapsedRef = React.useRef(collapsed);
  collapsedRef.current = collapsed;
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  /**
   * The reader has taken hold of the scroll themselves.
   *
   * Set by a wheel, a drag, or a key — the things only a person does. Never
   * by a scroll event, because the browser fires those whenever content
   * resizes, and the window resizes itself for a second or two after it
   * opens. Reading intent off those is what made the view let go part way
   * down and stop short of the end.
   */
  const readerScrolledRef = React.useRef(false);
  /** When this window last announced a send of its own. */
  const ownSignalAtRef = React.useRef(0);
  const inputRef = React.useRef<RichTextEditorHandle | null>(null);
  /** The box and its buttons — for asking whether the caret is in there. */
  const composerRef = React.useRef<HTMLDivElement>(null);
  /** Where the caret goes once the box exists and has been focused. */
  const pendingCaretRef = React.useRef<number | null>(null);
  const {
    items: attachItems,
    totalBytes: attachTotalBytes,
    ready: attachmentsReady,
    addFiles: addAttachFiles,
    remove: removeAttach,
    clear: clearAttachments,
    payload: attachmentPayload,
  } = useDraftAttachments();
  /** The draft attachment open in the preview, by strip id. */
  const [draftPreviewId, setDraftPreviewId] = React.useState<string | null>(
    null
  );
  /**
   * A file dropped anywhere on the window is attached to the reply.
   *
   * Anywhere, rather than only on the box: this window is one conversation
   * and one message being written, so there is nowhere else a file could be
   * meant for.
   */
  const { dragging: attachDragging, dropHandlers: attachDropHandlers } =
    useComposerFileDrop(addAttachFiles);
  const { pasteHandlers: attachPasteHandlers } =
    useComposerPaste(addAttachFiles);
  return { addAttachFiles, attachDragging, attachDropHandlers, attachItems, attachPasteHandlers, attachTotalBytes, attachmentPayload, attachmentsReady, clearAttachments, collapsed, collapsedRef, colorMode, composerKey, composerRef, contentRef, draft, draftPreviewId, draftText, inputRef, lastSeenAt, loadError, localBubbles, ownSignalAtRef, pendingCaretRef, readerScrolledRef, removeAttach, scrollRef, seenKey, sendError, sending, setCollapsed, setComposerKey, setDraft, setDraftPreviewId, setLastSeenAt, setLoadError, setLocalBubbles, setSendError, setSending, setThread, t, thread };
}

/** Reading the thread, again on the poll, and marking it seen. */
export function useChatLoad({
  account,
  collapsedRef,
  ownSignalAtRef,
  pendingCaretRef,
  seenKey,
  setDraft,
  setLastSeenAt,
  setLoadError,
  setLocalBubbles,
  setThread,
  threadId,
}: Pick<ReturnType<typeof useChatState>, "collapsedRef" | "ownSignalAtRef" | "pendingCaretRef" | "seenKey" | "setDraft" | "setLastSeenAt" | "setLoadError" | "setLocalBubbles" | "setThread"> &
  { account: ChatPopoutProps["account"]; threadId: ChatPopoutProps["threadId"] }) {
  /*
   * The box grows with the message, to a few lines, and then scrolls.
   *
   * A min-height and a max-height do all of it, in `mail.css`. The box is
   * not a textarea. A textarea is one line tall whatever is in it, so its
   * height must be measured and set on every keystroke.
   */

  const markSeen = React.useCallback(
    (detail: MailThreadDetail) => {
      const newest = [...detail.messages]
        .reverse()
        .find((m) => m.sentAt)?.sentAt;
      if (!newest) return;
      setLastSeenAt((current) => {
        if (current && current >= newest) return current;
        try {
          window.localStorage.setItem(seenKey, newest);
        } catch {}
        return newest;
      });
    },
    [seenKey, setLastSeenAt]
  );
  const loadThread = React.useCallback(async () => {
    // Only clear provider-side unread when the user is actually looking.
    const viewing = !collapsedRef.current && document.hasFocus();
    const params = new URLSearchParams({ account, id: threadId });
    if (!viewing) params.set("markRead", "0");
    try {
      const json = await apiJson<{ thread: MailThreadDetail }>(
        `/api/mail/thread?${params.toString()}`
      );
      /*
        Keep the state we have when the answer is the state we have.

        A new thread object re-renders the message frames and attachment
        tiles. Their heights settle again a beat later, and that jolts a
        reader parked at the bottom a few hundred pixels up. So a poll that
        changes nothing does not replace the object. Same messages, same
        words: nothing to paint.
      */
      setThread((current) => {
        if (current && sameThreadPage(current, json.thread)) return current;
        return json.thread;
      });
      setLoadError(null);
      // Drop optimistic bubbles once the provider echoes the real message.
      setLocalBubbles((current) =>
        current.filter(
          (b) =>
            !json.thread.messages.some(
              (m) => m.own && m.bodyText.trim().startsWith(b.bodyText.trim())
            )
        )
      );
      if (viewing) markSeen(json.thread);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Couldn't load thread");
    }
  }, [account, threadId, markSeen, collapsedRef, setLoadError, setLocalBubbles, setThread]);
  // Instant first paint: the opener hands the already-loaded thread over via
  // localStorage; the fetch below still refreshes it in the background.
  React.useLayoutEffect(() => {
    const seed = readPopoutSeed(account, threadId);
    if (!seed) return;
    setThread((current) => current ?? seed.thread);
    // A reply already being written in the thread comes with it, so popping
    // out mid-sentence does not leave the sentence behind. Only into an empty
    // box: this window's own draft is never overwritten by a handover.
    if (seed.draft) {
      setDraft((current) => current || seed.draft);
      // And in the same place in it. The caret is put after the box is
      // filled and focused. If it is put before, focusing takes it to the
      // end again.
      if (seed.caret != null) pendingCaretRef.current = seed.caret;
    }
  }, [account, threadId, pendingCaretRef, setDraft, setThread]);
  // Poll for new mail; refresh immediately when the window regains focus.
  React.useEffect(() => {
    void loadThread();
    const timer = window.setInterval(() => void loadThread(), POLL_MS);
    const onFocus = () => void loadThread();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [loadThread]);
  /*
    A reply sent from the reader shows here at once, not at the next poll.

    The reader announces every send the same two ways this window announces
    its own — a localStorage write for browsers, a Tauri event for the
    desktop shell — and a signal naming this thread reloads it on the same
    backoff the reader uses, because the provider can take a moment to
    index the new message into the conversation.
  */
  React.useEffect(() => {
    const matches = (payload: unknown) => {
      const p = payload as { account?: string; threadId?: string } | null;
      if (p?.account !== account || p?.threadId !== threadId) return false;
      // The Tauri broadcast reaches every window, this one included. Its
      // own send already schedules its own reloads.
      return Date.now() - ownSignalAtRef.current > 5000;
    };
    const timers: number[] = [];
    const reloadSoon = () => {
      for (const delay of [400, 1500, 4000]) {
        timers.push(window.setTimeout(() => void loadThread(), delay));
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== MAIL_POPOUT_SENT_KEY || !event.newValue) return;
      try {
        if (matches(JSON.parse(event.newValue))) reloadSoon();
      } catch {}
    };
    window.addEventListener("storage", onStorage);
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    const tauriEvent = (
      window as unknown as {
        __TAURI__?: {
          event?: {
            listen?: (
              name: string,
              handler: (event: { payload: unknown }) => void
            ) => Promise<() => void>;
          };
        };
      }
    ).__TAURI__?.event;
    if (tauriEvent?.listen) {
      void tauriEvent
        .listen("mail-sent", (event) => {
          if (matches(event.payload)) reloadSoon();
        })
        .then((fn) => {
          if (cancelled) fn();
          else unlisten = fn;
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
      unlisten?.();
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [account, threadId, loadThread, ownSignalAtRef]);
  return { loadThread, markSeen };
}

/** The older messages, the bubbles in order, and what is not seen yet. */
export function useChatHistory({
  account,
  collapsed,
  contentRef,
  lastSeenAt,
  localBubbles,
  readerScrolledRef,
  scrollRef,
  thread,
  threadId,
}: Pick<ReturnType<typeof useChatState>, "collapsed" | "contentRef" | "lastSeenAt" | "localBubbles" | "readerScrolledRef" | "scrollRef" | "thread"> &
  { account: ChatPopoutProps["account"]; threadId: ChatPopoutProps["threadId"] }) {
  /**
   * Earlier pages, fetched when a reader scrolls to the top.
   *
   * A thread comes back newest-first and capped, so a long one arrives with
   * its beginning missing. Nothing here could ask for the rest — which never
   * showed while messages were folded, because a fold looks the same as a
   * message that is not there.
   *
   * A reader, and not the window itself: an opening window sits at the top
   * too, and history it fetches for nobody is history that moves the view
   * away from the end.
   */
  const [older, setOlder] = React.useState<MailMessage[]>([]);
  const [olderHasMore, setOlderHasMore] = React.useState<boolean | null>(null);
  const [loadingOlder, setLoadingOlder] = React.useState(false);
  const canLoadOlder = olderHasMore ?? Boolean(thread?.hasOlder);
  React.useEffect(() => {
    // A different thread in the same window starts again from the newest.
    setOlder([]);
    setOlderHasMore(null);
  }, [account, threadId]);
  const loadOlder = React.useCallback(async () => {
    const oldest = older[0] ?? thread?.messages[0];
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    // Keep the reader where they were: prepending pushes everything down by
    // however tall the new messages are, so take that back off the scroll.
    const before = scrollRef.current?.scrollHeight ?? 0;
    try {
      const params = new URLSearchParams({
        account,
        id: threadId,
        before: oldest.id,
        markRead: "0",
      });
      const json = await apiJson<{ thread: MailThreadDetail }>(
        `/api/mail/thread?${params.toString()}`
      );
      const page = json.thread.messages ?? [];
      setOlderHasMore(Boolean(json.thread.hasOlder) && page.length > 0);
      if (page.length) {
        setOlder((current) => [...page, ...current]);
        requestAnimationFrame(() => {
          // Unless the view is still pinned to the end, where one rule owns
          // the position and this would pull against it.
          if (!readerScrolledRef.current) return;
          const el = scrollRef.current;
          if (el) el.scrollTop += el.scrollHeight - before;
        });
      }
    } catch {
      // Leave what is on screen. The next scroll to the top tries again.
    } finally {
      setLoadingOlder(false);
    }
  }, [older, thread, loadingOlder, account, threadId, readerScrolledRef, scrollRef]);
  const messages = React.useMemo<MailMessage[]>(() => {
    const base = [...older, ...(thread?.messages ?? [])];
    const extras = localBubbles.map((b) => ({
      id: b.id,
      fromName: "You",
      fromEmail: account,
      toEmails: [],
      ccEmails: [],
      sentAt: b.sentAt,
      bodyText: b.bodyText,
      bodyHtml: b.bodyHtml,
      own: true,
    }));
    // A paged message can also be in the newest page; keep the first of each.
    const seen = new Set<string>();
    return [...base, ...extras].filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  }, [thread, older, localBubbles, account]);
  /** Each message's previous one from the same sender: its signature folds. */
  const earlierBySender = React.useMemo(() => earlierFromSameSender(messages), [messages]);
  const unseenCount = React.useMemo(
    () =>
      messages.filter(
        (m) => !m.own && m.sentAt && (!lastSeenAt || m.sentAt > lastSeenAt)
      ).length,
    [messages, lastSeenAt]
  );
  /**
   * The window opens at the end of the conversation, and stays there.
   *
   * Nothing here asks where the reader is, because on opening there is no
   * reader yet — there is a window filling itself in. It fills in for a
   * while: the thread is painted from a seed, the fetch replaces it a second
   * later, each HTML frame reports its real height after it renders, and
   * pictures land after that. Every one of those moves the end of the
   * conversation further down.
   *
   * Scroll events cannot tell, at each of those moments, whether the reader
   * is still at the bottom. The browser fires those events when content
   * resizes. If they are used, the window's own loading is mistaken for the
   * reader scrolling away. The view then lets go half way through and settles
   * short, and the conversation bounces.
   *
   * So only one thing turns this off, and it is the reader taking hold of the
   * scroll themselves. A wheel, a drag, or a key is a person. A scroll event
   * is not.
   */
  React.useEffect(() => {
    if (collapsed) return;
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    const pin = () => {
      if (readerScrolledRef.current) return;
      el.scrollTop = el.scrollHeight;
    };
    pin();
    /*
      The messages and the window they are read through.
 
      Watching the messages alone left the view short of the end whenever
      the other half moved: the box at the bottom grows as its signature,
      its attachments and its own toolbar arrive, and every pixel it takes
      is a pixel off the height of the scroll — which is not a change to
      the messages, so nothing asked for the view to be put back. The
      window being resized does the same thing.
    */
    const observer = new ResizeObserver(pin);
    observer.observe(content);
    observer.observe(el);
    window.addEventListener("resize", pin);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", pin);
    };
  }, [collapsed, contentRef, readerScrolledRef, scrollRef]);
  /**
   * And again whenever the conversation itself changes.
   *
   * The observer above is the general answer and it is the right one, but
   * it is the browser's to call, and a window that is still being put on
   * screen is exactly where a browser holds those back. This asks directly
   * — after the messages have been laid out, and once more on the next
   * frame for the heights that arrive with them.
   *
   * The reader still owns the scroll: once they have taken hold, none of
   * this moves it.
   */
  React.useLayoutEffect(() => {
    if (collapsed) return;
    const pin = () => {
      const el = scrollRef.current;
      if (!el || readerScrolledRef.current) return;
      el.scrollTop = el.scrollHeight;
    };
    pin();
    const frame = requestAnimationFrame(pin);
    const settle = window.setTimeout(pin, 120);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(settle);
    };
  }, [collapsed, messages.length, thread?.threadId, readerScrolledRef, scrollRef]);
  return { canLoadOlder, earlierBySender, loadOlder, loadingOlder, messages, unseenCount };
}

/** Handing the thread back to the main window, the window's keys, and folding the window. */
export function useChatWindow({
  account,
  collapsed,
  collapsedRef,
  composerRef,
  draft,
  draftText,
  inputRef,
  markSeen,
  pendingCaretRef,
  personEmail,
  setCollapsed,
  thread,
  threadId,
}: Pick<ReturnType<typeof useChatState>, "collapsed" | "collapsedRef" | "composerRef" | "draft" | "draftText" | "inputRef" | "pendingCaretRef" | "setCollapsed" | "thread"> &
  Pick<ReturnType<typeof useChatLoad>, "markSeen"> &
  { account: ChatPopoutProps["account"]; personEmail: ChatPopoutProps["personEmail"]; threadId: ChatPopoutProps["threadId"] }) {
  /**
   * Give the message back to the thread, and go.
   *
   * A message half-written here is the same message half-written in the
   * thread — the window is a different place to stand, not a different
   * conversation. So it is saved as that thread's reply draft, which is
   * where the reader will next look for it.
   *
   * Saved before the window goes, and the close waits on the write: a draft
   * written into a window that is already closing is a draft nobody has.
   */
  const handBack = React.useCallback(() => {
    const typed = draftText.trim();
    // Read before the window goes, for the same reason the thread reads it
    // before its box closes.
    const caret = inputRef.current?.getCaret() ?? null;
    const done = () => {
      void closeChatPopout().catch(() => window.close());
    };
    if (!typed || !thread) {
      done();
      return;
    }
    const to = thread.reply.to.length
      ? thread.reply.to
      : thread.reply.allTo.length
        ? thread.reply.allTo
        : [personEmail || account];
    const recipients = to.map((email) => ({
      kind: "email" as const,
      email,
    }));
    void saveThreadDraft(
      {
        key: threadDraftKey(account, threadId),
        kind: "thread",
        account,
        threadId,
        mode: "reply",
        body: draft,
        toList: recipients,
        ccList: [],
        showCc: false,
        editRecipients: false,
        includeSignature: false,
        fromAccount: account,
        replyFocus: false,
        ...(caret != null ? { caret } : null),
        // Files picked here are not carried over. They live in this window's
        // own attachment state, and a draft that claimed to have them would
        // be a draft that sends without them.
        attachments: [],
      },
      recipients,
      []
    )
      .catch(() => {
        // Losing the draft is bad; refusing to close is worse.
      })
      .finally(done);
  }, [draft, draftText, thread, account, threadId, personEmail, inputRef]);
  /**
   * Escape asks for it from in here — and so does the key that opened it.
   *
   * A key that shows a window should put it away again; that is what makes
   * it one key rather than two things to remember. It leaves the same way
   * Escape leaves, draft and all.
   */
  const shortcuts = useMailShortcuts();
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const plainEscape =
        event.key === "Escape" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey;
      if (!plainEscape && actionForEvent(event, shortcuts) !== "popOut") return;
      event.preventDefault();
      handBack();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handBack, shortcuts]);
  /**
   * "Bring back" asks for it from the thread.
   *
   * While this window is open the thread shows a strip where its reply box
   * would be, and Bring back on that strip arrives here. Asked of this
   * window rather than done to it: only this end knows what has been typed
   * here, so the asking says nothing about the draft and the handover is
   * the one Escape already does.
   *
   * Read off a ref, because what is typed changes with every key and this
   * listener is registered with the shell — swapping it per keystroke is a
   * lot of asking for one unchanging answer.
   */
  const handBackRef = React.useRef(handBack);
  handBackRef.current = handBack;
  React.useEffect(() => {
    const tauriEvent = (
      window as unknown as {
        __TAURI__?: {
          event?: {
            listen?: (
              name: string,
              handler: () => void
            ) => Promise<() => void>;
          };
        };
      }
    ).__TAURI__?.event;
    if (!tauriEvent?.listen) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void tauriEvent
      .listen("chat-popout-hand-back", () => handBackRef.current())
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
  /**
   * The box is ready to type in as soon as the window is there.
   *
   * A pop-out is opened to say something. Landing in it and having to click
   * the box first is a step that exists for no reason, and the window is
   * small enough that the box is the only thing in it to aim at.
   *
   * `preventScroll`, because focusing scrolls a box into view by default and
   * the thread is meanwhile being pinned to its end — two things moving the
   * same view, which is the argument the scroll pin already had once.
   */
  React.useEffect(() => {
    if (collapsed) return;
    let frame = 0;
    /*
     * Asked for again until it is taken.
     *
     * The editor is loaded on demand, so for the first frames of a window
     * there is a box on screen with no editor behind it yet, and focus put
     * there goes nowhere. One frame was enough for a textarea; this waits
     * for the editor to arrive, and stops the moment it has the caret.
     */
    const tryFocus = (attempt: number) => {
      const box = inputRef.current;
      const held = composerRef.current?.contains(document.activeElement);
      if (!held && box) {
        const caret = pendingCaretRef.current;
        // setCaret focuses as well, so a seeded caret needs no focus call
        // of its own — and asking for one first would land at the end.
        if (caret != null) box.setCaret(caret);
        else box.focus();
      }
      if (composerRef.current?.contains(document.activeElement)) {
        pendingCaretRef.current = null;
        return;
      }
      // About a second, then leave it alone: a window the reader has since
      // clicked into is not one to keep taking the caret back from.
      if (attempt < 60) frame = requestAnimationFrame(() => tryFocus(attempt + 1));
    };
    frame = requestAnimationFrame(() => tryFocus(0));
    return () => cancelAnimationFrame(frame);
  }, [collapsed, composerRef, inputRef, pendingCaretRef]);
  // Seeing the expanded, focused window counts as reading.
  React.useEffect(() => {
    if (collapsed || !thread) return;
    if (document.hasFocus()) markSeen(thread);
  }, [collapsed, thread, markSeen]);
  const setWindowCollapsed = React.useCallback(async (next: boolean) => {
    setCollapsed(next);
    const height = next
      ? CHAT_POPOUT_COLLAPSED_HEIGHT
      : CHAT_POPOUT_EXPANDED_HEIGHT;
    try {
      await resizeChatPopout({ width: CHAT_POPOUT_WIDTH, height });
    } catch {
      // Browser popup: resizeTo works on script-opened windows and takes the
      // outer size, so keep the current chrome height on top of ours.
      try {
        const chrome = window.outerHeight - window.innerHeight;
        window.resizeTo(window.outerWidth, height + Math.max(0, chrome));
      } catch {
        // Plain tab (opened directly): nothing to resize.
      }
    }
  }, [setCollapsed]);
  /**
   * "Show", pressed on the strip in the reader, unfolds this window.
   *
   * Folded is a kind of hidden: somebody asking to see the conversation
   * is not asking for the naming bar it was folded into. The shell brings
   * the window forward and says so here; the fold is this page's to undo,
   * because it is this page that holds it and asks for the resize.
   */
  const unfoldRef = React.useRef<() => void>(() => {});
  unfoldRef.current = () => {
    if (collapsedRef.current) void setWindowCollapsed(false);
  };
  React.useEffect(() => {
    const tauriEvent = (
      window as unknown as {
        __TAURI__?: {
          event?: {
            listen?: (
              name: string,
              handler: () => void
            ) => Promise<() => void>;
          };
        };
      }
    ).__TAURI__?.event;
    if (!tauriEvent?.listen) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void tauriEvent
      .listen("chat-popout-unfold", () => unfoldRef.current())
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
  return { setWindowCollapsed };
}

/** Sending, quoting, emoji, the bubbles' actions, and closing. */
export function useChatSend({
  account,
  attachmentPayload,
  attachmentsReady,
  clearAttachments,
  draft,
  draftText,
  inputRef,
  loadThread,
  ownSignalAtRef,
  personEmail,
  sending,
  setComposerKey,
  setDraft,
  setLocalBubbles,
  setSendError,
  setSending,
  thread,
  threadId,
}: Pick<ReturnType<typeof useChatState>, "attachmentPayload" | "attachmentsReady" | "clearAttachments" | "draft" | "draftText" | "inputRef" | "ownSignalAtRef" | "sending" | "setComposerKey" | "setDraft" | "setLocalBubbles" | "setSendError" | "setSending" | "thread"> &
  Pick<ReturnType<typeof useChatLoad>, "loadThread"> &
  { account: ChatPopoutProps["account"]; personEmail: ChatPopoutProps["personEmail"]; threadId: ChatPopoutProps["threadId"] }) {
  /**
   * Reply quoting one message, rather than answering the thread in general.
   *
   * The recipients are fixed here, so this needs nothing the window does not
   * have. Picking a message parks it; the next send quotes it and then
   * forgets it.
   */
  const [quoteMessageId, setQuoteMessageId] = React.useState<string | null>(
    null
  );
  const send = React.useCallback(async (options?: {
    /** An emoji reaction sends this instead of what is in the box. */
    body?: string;
    /** The message to quote under it, when one was picked. */
    quoteId?: string;
  }) => {
    const body = (options?.body ?? draftText).trim();
    /*
     * What was typed, with its formatting, for the mail's HTML part.
     *
     * A reaction is one emoji and builds its own card, so it has none.
     * Everything else sends both parts: `body` above is the same message
     * as words only, for readers that ask for that.
     */
    const bodyHtml =
      options?.body || !body ? undefined : bodyToEmailHtml(draft);
    const attachments = options?.body ? [] : attachmentPayload();
    // A file on its own is a message. Words are not required for one.
    if ((!body && !attachments.length) || sending || !thread) return;
    if (!attachmentsReady) {
      setSendError(mailSay("stillPreparingFiles"));
      return;
    }
    // Reply recipients strip our own addresses, so a self-addressed thread
    // (e.g. a test note to yourself) ends up with none — fall back sensibly.
    const to = thread.reply.to.length
      ? thread.reply.to
      : thread.reply.allTo.length
        ? thread.reply.allTo
        : [personEmail || account];
    const quoteSource =
      (options?.quoteId ?? quoteMessageId)
        ? thread.messages.find(
            (m) => m.id === (options?.quoteId ?? quoteMessageId)
          )
        : undefined;
    const quoted = quoteSource
      ? {
          fromName:
            quoteSource.fromName === "You" ||
            quoteSource.fromName.toLowerCase() ===
              quoteSource.fromEmail.toLowerCase()
              ? ""
              : quoteSource.fromName,
          fromEmail: quoteSource.fromEmail,
          date: messageStamp(quoteSource.sentAt),
          text: quoteSource.bodyText.trim(),
        }
      : undefined;

    // A reaction carries a line of what it answers, because mail cannot
    // attach one to a message the way a messaging app does. Anything typed
    // goes as itself. See `lib/mail/reaction-message`.
    const reaction = options?.body
      ? reactionMessage(options.body, quoted)
      : null;
    // A reply to one message carries that message in its body, in the same
    // card the reaction uses. If it is sent as the quoted history, the
    // reader folds it away behind a "…", and a chat-style thread drops it
    // altogether. Then what was picked does not show.
    const outgoing =
      reaction ?? (quoted ? quotedReplyMessage(body, quoted, bodyHtml) : null);

    setSending(true);
    setSendError(null);
    const local: LocalBubble = {
      id: `local-${Date.now()}`,
      // A file with no words would otherwise show as an empty bubble until
      // the provider's copy lands. Name what was sent instead.
      bodyText:
        outgoing?.text || body || attachments.map((a) => a.filename).join(", "),
      bodyHtml: outgoing?.html ?? bodyHtml,
      sentAt: new Date().toISOString(),
    };
    setLocalBubbles((current) => [...current, local]);
    // What to put back if the send fails. The box is emptied before the
    // request, so the message looks sent at once — this is the copy.
    const restore = draft;
    if (!options?.body) {
      setDraft("");
      // The editor is seeded once and holds its own words after that, so
      // emptying the state is not emptying the box. A new key is.
      setComposerKey((n) => n + 1);
      clearAttachments();
    }
    setQuoteMessageId(null);
    try {
      await apiJson("/api/mail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account,
          to,
          cc: thread.reply.cc.length ? thread.reply.cc : undefined,
          subject: thread.subject.startsWith("Re:")
            ? thread.subject
            : `Re: ${thread.subject}`,
          includeSignature: false,
          threadId,
          inReplyTo: thread.reply.inReplyTo,
          references: thread.reply.references,
          body: outgoing?.text ?? body,
          html: outgoing?.html ?? bodyHtml,
          // A reply to one message quotes it. A message to the conversation
          // still quotes nothing — that is what makes this read like a chat.
          // A reaction carries its own line, so it needs no history either.
          // The context is in the body now, so never the history as well.
          quote: undefined,
          noQuote: true,
          messageCount: thread.messages.length,
          attachments: attachments.length ? attachments : undefined,
        }),
      });
      // Replace the optimistic bubble with the provider's copy.
      for (const delay of [800, 2000, 4500]) {
        window.setTimeout(() => void loadThread(), delay);
      }
      // Nudge the main window so its list/reader update without waiting
      // for the next poll.
      ownSignalAtRef.current = Date.now();
      signalPopoutSend(account, threadId);
    } catch (err) {
      setLocalBubbles((current) => current.filter((b) => b.id !== local.id));
      // With its formatting, and only for a message from the box: a
      // reaction was never in the box and would appear in it as a
      // half-written reply nobody typed.
      if (!options?.body) {
        setDraft(restore);
        setComposerKey((n) => n + 1);
      }
      setSendError(err instanceof Error ? err.message : "Couldn't send");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [draft,
    draftText,
    sending,
    thread,
    account,
    threadId,
    personEmail,
    loadThread,
    attachmentPayload,
    attachmentsReady,
    clearAttachments,
    quoteMessageId, inputRef, ownSignalAtRef, setComposerKey, setDraft, setLocalBubbles, setSendError, setSending]);
  /**
   * Put an emoji where the caret is, not on the end.
   *
   * Appending would be wrong the moment somebody goes back to add one in the
   * middle of what they have written, which in a chat window is most of the
   * time. The caret is put back after it so typing carries on from there.
   */
  const insertEmoji = React.useCallback((emoji: string) => {
    // The editor knows where its own caret is, puts the emoji there, and
    // moves the caret past it. Its change event updates the draft.
    inputRef.current?.insertText(emoji);
  }, [inputRef]);
  /** The message the next send will quote, when one was picked. */
  const quotedForReply = React.useMemo(
    () => thread?.messages.find((m) => m.id === quoteMessageId) ?? null,
    [thread, quoteMessageId]
  );
  const bubbleActions = React.useCallback(
    (m: { id: string }) => ({
      onReact: (emoji: string) => void send({ body: emoji, quoteId: m.id }),
      onReplyTo: () => {
        setQuoteMessageId(m.id);
        inputRef.current?.focus();
      },
      // No recipient picker and no subject line here. The window that has
      // both is asked to do it, and comes to the front — see popout.ts.
      onForward: () =>
        signalForwardRequest({ account, threadId, messageId: m.id }),
      onEditAsNew: () =>
        signalEditAsNewRequest({ account, threadId, messageId: m.id }),
    }),
    // `send` belongs here. Without it this kept the first one ever made —
    // the one closed over a thread that had not loaded — and every reaction
    // returned at its own `!thread` guard without a word.
    [account, threadId, send, inputRef]
  );
  const close = React.useCallback(() => {
    void closeChatPopout().catch(() => window.close());
  }, []);
  return { bubbleActions, close, insertEmoji, quotedForReply, send, setQuoteMessageId };
}
