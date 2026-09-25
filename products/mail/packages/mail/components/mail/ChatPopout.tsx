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

import * as React from "react";
import { Minus, Square, X } from "lucide-react";

import { attachmentUrl } from "@/lib/mail/attachment-save";
import {
  AttachmentSizeSummary,
  AttachToolbarButton,
  ComposerDropOverlay,
  DraftAttachmentThumbs,
  useComposerFileDrop,
  useComposerPaste,
  useDraftAttachments,
} from "@/components/mail/draft-attachments";
import {
  DraftAttachmentPreviewDialog,
} from "@/components/mail/attachment-preview";
import { openAttachmentOutside } from "@/components/mail/attachment-files";
import { MailBubble } from "@/components/mail/MailBubble";
import { EmojiPickerButton } from "@/components/ui/EmojiPicker";
import {
  RichTextEditor,
  type RichTextEditorHandle,
} from "@/components/ui/RichTextEditor";
import { bodyToEmailHtml, htmlToPlainText } from "@/lib/client-email-html";
import {
  avatarStyle,
  senderInitials,
} from "@/components/mail/avatar";
import {
  CHAT_POPOUT_COLLAPSED_HEIGHT,
  CHAT_POPOUT_EXPANDED_HEIGHT,
  CHAT_POPOUT_WIDTH,
  readPopoutSeed,
  MAIL_POPOUT_SENT_KEY,
  signalPopoutSend,
  signalEditAsNewRequest,
  signalForwardRequest,
} from "@/lib/mail/popout";
import {
  chatDayLabel,
  messageStamp,
  sameDay,
  timeOfDay,
} from "@/lib/mail/date-format";
import {
  quotedReplyMessage,
  reactionMessage,
  reactionQuoteText,
} from "@/lib/mail/reaction-message";
import { teamAvatarSrc } from "@/lib/mail/team-avatars";
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

/*
 * How tall the box may grow — about six lines, past which the window is the
 * wrong place for the message — is `max-height` on .mail-chat-input in
 * `mail.css`. The box measured and set its own height while it was a
 * textarea, which is the one element that will not grow with its content.
 */

export function ChatPopout({
  account,
  threadId,
  personName,
  personEmail,
  subject,
}: {
  account: string;
  threadId: string;
  personName: string;
  personEmail: string;
  subject: string;
}) {
  const t = useMailT();
  const colorMode = useMailColorMode();
  /*
    Folded or not — asked of the window, not assumed.

    The window keeps its size across a reload and the state did not: a
    chat parked as a bar came back believing it was open, drew the header
    and the composer into fifty-six pixels, and showed a clipped name
    above a box with no conversation over it. Anything that reloads the
    page does this — the app restarting, and the dev server on every save.

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


  const seenKey = `redd-plan-chat-popout-seen:${account}|${threadId}`;
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
   * meant for. Dropping one used to do nothing at all.
   */
  const { dragging: attachDragging, dropHandlers: attachDropHandlers } =
    useComposerFileDrop(addAttachFiles);
  const { pasteHandlers: attachPasteHandlers } =
    useComposerPaste(addAttachFiles);

  /*
   * The box grows with the message, to a few lines, and then scrolls.
   *
   * A min-height and a max-height do all of it now, in `mail.css`. The box
   * used to be a textarea, which is one line tall whatever is in it, so its
   * height had to be measured and set on every keystroke.
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
    [seenKey]
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

        Every poll used to replace the thread object whether or not anything
        changed, and every replacement re-rendered the message frames and
        attachment tiles — whose heights settle again a beat later, jolting
        a reader parked at the bottom a few hundred pixels up. Same
        messages, same words: nothing to paint.
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
  }, [account, threadId, markSeen]);

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
      // And in the same place in it. The caret is put after the box has
      // been filled and focused, or focusing would take it to the end
      // again — which is where it always used to land.
      if (seed.caret != null) pendingCaretRef.current = seed.caret;
    }
  }, [account, threadId]);

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
  }, [account, threadId, loadThread]);

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
  }, [older, thread, loadingOlder, account, threadId]);

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

  const latestId = messages.length ? messages[messages.length - 1].id : null;


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
   * Earlier versions tried to work out, at each of those moments, whether the
   * reader was still at the bottom, and read the answer off scroll events.
   * The browser fires those when content resizes, so the window's own loading
   * kept being mistaken for the reader scrolling away, and the view let go
   * half way through and settled short. That is what the bouncing was.
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
  }, [collapsed]);

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
  }, [collapsed, messages.length, thread?.threadId]);

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
  }, [draft, draftText, thread, account, threadId, personEmail]);

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
  }, [collapsed]);

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
  }, []);

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
    // card the reaction uses. Sent as the quoted history it was folded away
    // behind a "…" by the reader, and dropped altogether by a chat-style
    // thread — so what was picked never showed.
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
  }, [
    draft,
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
    quoteMessageId,
  ]);

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
  }, []);

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
    [account, threadId, send]
  );

  const close = React.useCallback(() => {
    void closeChatPopout().catch(() => window.close());
  }, []);

  const header = (
    <div
      data-tauri-drag-region
      // The same cream as the main window's chrome, so the strip that names
      // who you are talking to reads as chrome here too, and the messages
      // below it keep the pane to themselves. The rule only makes sense when
      // there is something under it — folded, this strip is the whole card,
      // and fills it.
      className={cn(
        "flex shrink-0 items-center bg-[var(--mail-chrome)]",
        // Folded it is the whole window, so it gives back the room it does
        // not need: a smaller face, less air around it.
        collapsed ? "gap-2.5 px-3 py-1.5" : "gap-3 px-4 py-2",
        // Folded, this strip is the whole card, so it takes the whole of it.
        // Left at its own height it sat centred in a taller white card, and
        // the card showed above and below it as two white bands.
        collapsed && "grow",
        !collapsed && "border-b border-[var(--mail-chrome-border)]"
      )}
    >
      {teamAvatarSrc(personEmail) ? (
        <img
          aria-hidden
          data-tauri-drag-region
          src={teamAvatarSrc(personEmail)}
          alt=""
          className={cn(
            "shrink-0 rounded-full object-cover",
            collapsed ? "h-8 w-8" : "h-10 w-10"
          )}
        />
      ) : (
        <span
          aria-hidden
          data-tauri-drag-region
          className={cn(
            "flex shrink-0 items-center justify-center rounded-full text-xs font-semibold",
            collapsed ? "h-8 w-8" : "h-10 w-10",
            avatarStyle((personEmail || personName).toLowerCase())
          )}
        >
          <span data-tauri-drag-region className="pointer-events-none">
            {senderInitials(personName, personEmail)}
          </span>
        </span>
      )}
      <div data-tauri-drag-region className="min-w-0 flex-1">
        <p
          data-tauri-drag-region
          className="truncate text-[15px] font-bold leading-tight text-stone-900"
        >
          {personName || personEmail}
        </p>
        <p
          data-tauri-drag-region
          className="truncate text-[13px] leading-tight text-stone-500"
        >
          {subject}
        </p>
      </div>
      {unseenCount > 0 ? (
        <span className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-teal-600 px-1.5 text-xs font-semibold text-white">
          {unseenCount}
        </span>
      ) : null}
      <button
        type="button"
        aria-label={collapsed ? "Expand" : "Collapse"}
        title={collapsed ? "Expand" : "Collapse"}
        className="rounded-md p-1.5 text-stone-500 hover:bg-stone-100 hover:text-stone-800"
        onClick={() => void setWindowCollapsed(!collapsed)}
      >
        {collapsed ? (
          <Square className="h-4 w-4" />
        ) : (
          <Minus className="h-4 w-4" />
        )}
      </button>
      <button
        type="button"
        aria-label={t("close")}
        title={t("close")}
        className="rounded-md p-1.5 text-stone-500 hover:bg-stone-100 hover:text-stone-800"
        onClick={close}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );

  return (
    <>
      {/* The Tauri window is transparent; this page draws the rounded card. */}
      <style>{`html, body { background: transparent !important; } body { overflow: hidden; }`}</style>
      {/*
        The card fills the window exactly.

        It used to sit six pixels in, with a CSS shadow around it. A shadow
        that size wants about twenty-five, so it was cut off square at the
        window's edge — which is what the hairline under the popout was, with
        the desktop showing through the six pixels above it. macOS draws a
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
            "mail-shell mail-surface-root flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-stone-200 bg-white",
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
              <div
                ref={scrollRef}
                className="mail-thread-surface min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-2"
                /**
                 * The browser must not move the view for us.
                 *
                 * Scroll anchoring shifts scrollTop when content around the
                 * view resizes, which is a second thing pulling at the scroll
                 * while the window loads. One rule owns the position here.
                 */
                style={{ overflowAnchor: "none" }}
                /* A person did this. Nothing else sets it. */
                onWheel={() => {
                  readerScrolledRef.current = true;
                }}
                onTouchMove={() => {
                  readerScrolledRef.current = true;
                }}
                onKeyDown={() => {
                  readerScrolledRef.current = true;
                }}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  // Only ever hands the view back. Scrolling to the end says
                  // "keep me here"; nothing a scroll event says can take the
                  // end away, because the window's own loading fires these.
                  if (el.scrollHeight - el.scrollTop - el.clientHeight < 40) {
                    readerScrolledRef.current = false;
                  }
                  // Near the top and there is more behind it.
                  //
                  // Only for a reader who scrolled there. A window that has
                  // just opened is also at the top: every HTML message is a
                  // frame 140pt tall until it paints, so a long thread is far
                  // shorter than it will be, and the pin to the end lands at
                  // the start and fires this. The window then fetched a page
                  // nobody asked for and put the view back where that page
                  // began — which is the wrong place, held for as long as the
                  // fetch took, until the frames settled and the pin threw
                  // the reader to the end.
                  if (!readerScrolledRef.current) return;
                  if (el.scrollTop > 60) return;
                  if (!canLoadOlder || loadingOlder) return;
                  void loadOlder();
                }}
              >
                {/* One box around the messages, so their growth is one thing
                    to watch. The spacing rides with them. */}
                <div ref={contentRef} className="space-y-2">
                {canLoadOlder ? (
                  <p className="py-2 text-center text-[11px] text-stone-400">
                    {loadingOlder ? t("loadingEarlierMessages") : t("scrollUpForEarlier")}
                  </p>
                ) : null}
                {loadError && !thread ? (
                  <p className="pt-6 text-center text-sm text-stone-400">
                    {loadError}
                  </p>
                ) : !thread ? (
                  <p className="pt-6 text-center text-sm text-stone-400">
                    {t("loading")}
                  </p>
                ) : null}
                {messages.map((m, i) => {
                  const previous = messages[i - 1];
                  const newDay =
                    !previous || !sameDay(previous.sentAt, m.sentAt);
                  return (
                  <React.Fragment key={`day-${m.id}`}>
                  {/* The day, once, over the messages that belong to it —
                      in the mail list's small capitals, the same as the
                      thread reader's. This window shows the same
                      conversation the reader does. */}
                  {newDay && m.sentAt ? (
                    <p className="pb-1 pt-3 text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--mail-chrome-faint)]">
                      {chatDayLabel(m.sentAt, t)}
                    </p>
                  ) : null}
                  <div key={m.id} className="min-w-0">
                    <MailBubble
                      {...bubbleActions(m)}
                      showPrint={false}
                      // One window, one conversation, one person: their name
                      // over every message says nothing that the window does
                      // not already. The time goes in the bubble instead.
                      showMeta={false}
                      timeLabel={timeOfDay(m.sentAt)}
                      message={m}
                      account={account}
                      subject={subject}
                      defaultAllowImages
                      // Never folded here. This window holds one short
                      // conversation, and a fold in it hid the very thing
                      // somebody opened the window to read.
                      isLatest={m.id === latestId}
                      sendStatus={
                        m.id.startsWith("local-") ? "sending" : undefined
                      }
                      onPreviewAttachment={(attachment) =>
                        openAttachmentOutside({
                          path: attachmentUrl({
                            account,
                            messageId: m.id,
                            attachment,
                          }),
                          filename: attachment.filename,
                        })
                      }
                    />
                  </div>
                  </React.Fragment>
                  );
                })}
                </div>
              </div>
              {/* The same inset as the messages above, so the box lines up with the
                  bubbles rather than sitting a few pixels inside them. */}
              <div className="shrink-0 px-3 pb-3 pt-0">
                {sendError ? (
                  <p className="pb-1.5 text-xs text-red-600">{sendError}</p>
                ) : null}
                {/* In the colour of a message from you, because that is what
                    it is about to be. On the card's own white, with a rule
                    above it, a waiting file read as part of the window rather
                    than part of what was being written. */}
                {/* What the next send will quote. Picking a message to reply
                    to used to do nothing you could see — the box took the
                    caret and the quote was invisible until it arrived at the
                    other end. */}
                {quotedForReply ? (
                  <div className="mb-1 flex items-start gap-2 rounded-2xl border border-[var(--mail-bubble-own-border)] bg-[var(--mail-bubble-own)] px-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] font-semibold text-stone-500">
                        Replying to{" "}
                        {quotedForReply.own
                          ? "yourself"
                          : quotedForReply.fromName || quotedForReply.fromEmail}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-stone-600">
                        {reactionQuoteText(quotedForReply.bodyText) ||
                          "(no text)"}
                      </span>
                    </span>
                    <button
                      type="button"
                      title={t("dontQuoteIt")}
                      aria-label={t("dontQuoteIt")}
                      className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                      onClick={() => setQuoteMessageId(null)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : null}
                {attachItems.length ? (
                  <div className="mb-1 rounded-2xl border border-[var(--mail-bubble-own-border)] bg-[var(--mail-bubble-own)] px-1 pb-1.5 pt-1">
                    <DraftAttachmentThumbs
                      items={attachItems}
                      onRemove={removeAttach}
                      onPreview={setDraftPreviewId}
                    />
                    <div className="px-1 pt-1">
                      <AttachmentSizeSummary
                        count={attachItems.length}
                        totalBytes={attachTotalBytes}
                      />
                    </div>
                  </div>
                ) : null}
                {/* Ends aligned. The offsets below put both icons level with
                    the first line, which is where the box starts — so they
                    read as centred on an empty box and stay in the bottom
                    corner as it grows, rather than drifting up the middle of
                    a paragraph. */}
                <div ref={composerRef} className="flex items-end gap-2">
                  {/* The paste handlers sit here rather than on the box:
                      the editor takes no DOM props of its own, and a paste
                      into it bubbles up to this either way. */}
                  <div
                    className="relative min-w-0 flex-1"
                    {...attachPasteHandlers}
                  >
                  {/* The same editor as the reply box in the reader, in
                      Quill's bubble theme: no toolbar of its own, and B,
                      I, U and the link over whatever is selected. There is
                      no room in a window this size for a permanent bar,
                      and this is a window for short messages anyway.

                      rounded-xl, the same as New email in the main window,
                      so the two boxes you type into are the same shape.
                      The heights and the room kept for the emoji button
                      are in `mail.css`, on .mail-chat-input. */}
                  <RichTextEditor
                    key={composerKey}
                    className="mail-chat-input"
                    variant="bubble"
                    handleRef={inputRef}
                    defaultValue={draft}
                    onChange={setDraft}
                    // Enter sends, shift-Enter starts a line — the same as
                    // every chat window. Also with nothing typed, when a
                    // file is waiting: there is no Send button to reach for.
                    onEnter={() => void send()}
                    // Just "Message". The name is the window's title and is
                    // right above this; when there is no display name it was
                    // the address, which filled the box and said nothing.
                    placeholder={sending ? "Sending…" : "Message"}
                    minHeight={41}
                  />
                  {/* In the box, on the right, where every chat app puts it
                      — it writes into the box, so it belongs in it.
                      The offsets here and on the paperclip are what the eye
                      wants rather than what the box measures: a glyph is not
                      centred in its own viewBox, and the two are not centred
                      the same way, so they need different numbers to sit on
                      the same line. */}
                  <span className="absolute bottom-1 right-1.5">
                    <EmojiPickerButton
                      onPick={insertEmoji}
                      className="inline-flex h-7 w-7 items-center justify-center rounded text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                    />
                  </span>
                  </div>
                  {/* The paperclip stays outside: it attaches a file to the
                      message rather than putting anything in the box. */}
                  <span className="flex shrink-0 items-end pb-1.5">
                    <AttachToolbarButton
                      onPick={addAttachFiles}
                      disabled={!thread || sending}
                      // Optically the size of the emoji, not numerically:
                      // a paperclip fills its box top to bottom, a smiley is
                      // a circle inside one, so equal boxes do not look
                      // equal.
                      iconClassName="h-[18px] w-[18px]"
                    />
                  </span>
                </div>
              </div>
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
