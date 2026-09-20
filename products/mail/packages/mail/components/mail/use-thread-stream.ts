"use client";

/*
 * The reader stream of the open thread, off the pane component: the thread
 * and its older parts, the first load from the cache and the provider, the
 * pages to older and newer messages, the refresh when the list shows new
 * mail, where the thread opens, the search hit it lands on, the place that
 * zoom holds, and the "latest" jump. Nothing here knows the composer.
 *
 * Two hooks, and the reason is the order of effects. React runs effects in
 * the order of the hook calls. The pane reads `thread` from its first lines,
 * so the state must stand at the top. The effects always ran lower, after
 * the composer's draft effects. One hook at the top would move every effect
 * here ahead of those. So `useThreadStreamState` holds the state at the top,
 * and `useThreadStream` runs the code at the place where that code stood.
 *
 * The state lives here. The pane writes `thread` for its optimistic sends,
 * through `setThread`, and nothing else. New reader work — loading, paging,
 * scroll position — goes in this file, not in ThreadPane.
 */

import * as React from "react";
import { toast } from "@/lib/mail/toast";
import { mailApiJson as apiJson } from "@/lib/mail/api";
import { afterMailPaneSlide } from "@/lib/mail/pane-slide";
import type { MailChatPartSummary } from "@/lib/mail/chat-types";
import {
  getCachedMailThread,
  isMailThreadCacheFresh,
  loadCachedMailThread,
  setCachedMailThread,
} from "@/lib/mail/thread-cache";
import type { MailMessage, MailThreadDetail } from "@/lib/mail/types";
import {
  mergeNewestThreadPage,
  messageKey,
  messageKeys,
} from "@/components/mail/thread-messages";

/** Close enough to the end of a thread to count as being at it. */
export const NEAR_LATEST_PX = 120;

/** An older chat part, put above the open root thread. */
export type OlderThreadPart = {
  partIndex: number;
  threadId: string;
  subject: string;
  openedAt: string | null;
  messages: MailMessage[];
  hasOlder: boolean;
};

/**
 * Where the reader is in the thread, for zoom to hold on to.
 *
 * Zooming scales the whole stream, so a scroll position measured in
 * pixels means somewhere else afterwards — the further down a long
 * thread, the further it threw them.
 *
 * Two ways of remembering the place, and which one is used is decided
 * by measurement rather than by belief. See `rectsMoveWithScroll`.
 */
type ZoomAnchor =
  /** A message, how far down it the held line cuts, and where that line is. */
  | { kind: "message"; id: string; into: number; line: number }
  /**
   * How far down the content the held line sits, how tall the content was,
   * and how far the line is below the top of the pane.
   */
  | { kind: "fraction"; top: number; content: number; hold: number };

/** The stream's state. Call it at the top of the pane. */
export function useThreadStreamState() {
  const [thread, setThread] = React.useState<MailThreadDetail | null>(null);
  const [loadingOlder, setLoadingOlder] = React.useState(false);
  const [loadingNewer, setLoadingNewer] = React.useState(false);
  const [highlightMessageId, setHighlightMessageId] = React.useState<
    string | null
  >(null);
  const [error, setError] = React.useState<string | null>(null);
  const [chatParts, setChatParts] = React.useState<MailChatPartSummary[]>([]);
  /** Older chat parts prepended above the open root thread (asc by partIndex). */
  const [olderParts, setOlderParts] = React.useState<OlderThreadPart[]>([]);
  return {
    thread,
    setThread,
    loadingOlder,
    setLoadingOlder,
    loadingNewer,
    setLoadingNewer,
    highlightMessageId,
    setHighlightMessageId,
    error,
    setError,
    chatParts,
    setChatParts,
    olderParts,
    setOlderParts,
  };
}

/** The code that drives the stream. Call it where the pane always ran it. */
export function useThreadStream(
  stream: ReturnType<typeof useThreadStreamState>,
  input: {
    account: string;
    threadId: string;
    /** Search hit — open centered on this message instead of the tip. */
    focusMessageId?: string;
    /** Newest-message timestamp from the list; a change means new mail arrived. */
    refreshToken?: string;
    /** Message count from the list row — a short thread loads in one Gmail call. */
    messageCount?: number;
    zoom: number;
    /** The zoom as of this render, for the open pin — see the pane. */
    zoomRef: React.RefObject<number>;
    scrollRef: React.RefObject<HTMLDivElement | null>;
    streamNode: HTMLDivElement | null;
  }
) {
  const {
    thread,
    setThread,
    loadingOlder,
    setLoadingOlder,
    loadingNewer,
    setLoadingNewer,
    highlightMessageId,
    setHighlightMessageId,
    setError,
    chatParts,
    setChatParts,
    olderParts,
    setOlderParts,
  } = stream;
  const {
    account,
    threadId,
    focusMessageId,
    refreshToken,
    messageCount,
    zoom,
    zoomRef,
    scrollRef,
    streamNode,
  } = input;

  const applyThreadChrome = React.useCallback(
    (detail: MailThreadDetail) => {
      // Don't wipe the composer — local drafts restore into it, and revalidation
      // must not clobber in-progress replies. Defaults are applied when Reply /
      // Forward is clicked (or when a draft is hydrated).
      if (
        focusMessageId &&
        detail.messages.some((m) => m.id === focusMessageId)
      ) {
        setHighlightMessageId(focusMessageId);
      } else {
        setHighlightMessageId(null);
      }
    },
    [focusMessageId, setHighlightMessageId]
  );

  // Tracks list tip while this pane is open (also set on cache-fresh opens).
  const seenRefreshToken = React.useRef(refreshToken);

  React.useEffect(() => {
    let cancelled = false;
    setLoadingOlder(false);
    setLoadingNewer(false);
    setError(null);

    const entryCanPaint = (entry: {
      thread: MailThreadDetail;
    }) =>
      !focusMessageId ||
      entry.thread.messages.some((m) => m.id === focusMessageId);

    const paintEntry = (
      entry: NonNullable<ReturnType<typeof getCachedMailThread>>
    ): "fresh" | "stale" | "skip" => {
      if (!entryCanPaint(entry)) return "skip";
      setThread(entry.thread);
      applyThreadChrome(entry.thread);
      if (isMailThreadCacheFresh(entry, refreshToken, focusMessageId)) {
        seenRefreshToken.current = refreshToken;
        return "fresh";
      }
      return "stale";
    };

    const ram = getCachedMailThread(account, threadId);
    if (ram) {
      const status = paintEntry(ram);
      if (status === "fresh") {
        return () => {
          cancelled = true;
        };
      }
      if (status === "skip") {
        setThread(null);
        setHighlightMessageId(null);
      }
      // stale: keep showing cache while we revalidate below
    } else {
      setThread(null);
      setHighlightMessageId(null);
    }

    void (async () => {
      try {
        // Disk hydrate when RAM missed (or could not paint for focus).
        if (!ram || !entryCanPaint(ram)) {
          const disk = await loadCachedMailThread(account, threadId);
          if (cancelled) return;
          if (disk) {
            const status = paintEntry(disk);
            if (status === "fresh") return;
          }
        } else if (
          isMailThreadCacheFresh(ram, refreshToken, focusMessageId)
        ) {
          return;
        }

        const params = new URLSearchParams({ account, id: threadId });
        if (focusMessageId) params.set("around", focusMessageId);
        // Deep links open a window mid-thread, which still needs the id list.
        else if (messageCount) params.set("count", String(messageCount));
        const json = await apiJson<{ thread: MailThreadDetail }>(
          `/api/mail/thread?${params.toString()}`
        );
        if (cancelled) return;
        setThread((current) => {
          if (current) {
            const currentLast = current.messages[current.messages.length - 1];
            const nextLast =
              json.thread.messages[json.thread.messages.length - 1];
            if (currentLast?.id === nextLast?.id) return current;
          }
          return json.thread;
        });
        setCachedMailThread(account, threadId, json.thread, refreshToken);
        applyThreadChrome(json.thread);
        seenRefreshToken.current = refreshToken;
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Couldn't load thread");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // refreshToken read on open for freshness; live tip changes use the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, threadId, focusMessageId, applyThreadChrome]);

  // Keep the LRU in sync as the open pane grows (older pages, sends, merges).
  React.useEffect(() => {
    if (!thread) return;
    setCachedMailThread(account, threadId, thread, refreshToken);
  }, [account, threadId, thread, refreshToken]);

  React.useEffect(() => {
    setOlderParts([]);
  }, [threadId, setOlderParts]);

  React.useEffect(() => {
    const chatId = thread?.chat?.chatId;
    if (!chatId) {
      setChatParts([]);
      return;
    }
    let cancelled = false;
    void apiJson<{ parts: MailChatPartSummary[] }>(
      `/api/mail/chat/parts?${new URLSearchParams({
        account,
        chatId,
      }).toString()}`
    )
      .then((json) => {
        if (!cancelled) setChatParts(json.parts);
      })
      .catch(() => {
        if (!cancelled) setChatParts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [account, thread?.chat?.chatId, setChatParts]);

  const loadOlderMessages = React.useCallback(async () => {
    if (loadingOlder || !thread) return;
    const head = olderParts[0];
    const headPartIndex = head?.partIndex ?? thread.chat?.partIndex ?? 1;
    const headThreadId = head?.threadId ?? threadId;
    const headMessages = head?.messages ?? thread.messages;
    const headHasOlder = head ? head.hasOlder : thread.hasOlder;
    const canCrossPart =
      Boolean(thread.chat) && !headHasOlder && headPartIndex > 1;
    if (!headHasOlder && !canCrossPart) return;
    if (headHasOlder && !headMessages.length) return;

    const scroller = scrollRef.current;
    const prevHeight = scroller?.scrollHeight ?? 0;
    const prevTop = scroller?.scrollTop ?? 0;
    setLoadingOlder(true);
    try {
      if (headHasOlder) {
        const oldestId = headMessages[0].id;
        const params = new URLSearchParams({
          account,
          id: headThreadId,
          before: oldestId,
        });
        const json = await apiJson<{ thread: MailThreadDetail }>(
          `/api/mail/thread?${params.toString()}`
        );
        if (head) {
          setOlderParts((parts) => {
            if (!parts.length) return parts;
            const [first, ...rest] = parts;
            const seen = messageKeys(first.messages);
            const older = json.thread.messages.filter(
              (m) => !seen.has(messageKey(m))
            );
            if (!older.length) {
              return [{ ...first, hasOlder: false }, ...rest];
            }
            return [
              {
                ...first,
                messages: [...older, ...first.messages],
                hasOlder: json.thread.hasOlder,
              },
              ...rest,
            ];
          });
        } else {
          setThread((current) => {
            if (!current) return current;
            const seen = messageKeys(current.messages);
            const older = json.thread.messages.filter(
              (m) => !seen.has(messageKey(m))
            );
            if (!older.length) {
              return { ...current, hasOlder: false };
            }
            return {
              ...current,
              messages: [...older, ...current.messages],
              hasOlder: json.thread.hasOlder,
            };
          });
        }
      } else if (canCrossPart && thread.chat) {
        let partsList = chatParts;
        if (!partsList.length) {
          const listed = await apiJson<{ parts: MailChatPartSummary[] }>(
            `/api/mail/chat/parts?${new URLSearchParams({
              account,
              chatId: thread.chat.chatId,
            }).toString()}`
          );
          partsList = listed.parts;
          setChatParts(partsList);
        }
        const prev = partsList.find((p) => p.partIndex === headPartIndex - 1);
        if (!prev) return;
        const params = new URLSearchParams({
          account,
          id: prev.providerThreadId,
        });
        const json = await apiJson<{ thread: MailThreadDetail }>(
          `/api/mail/thread?${params.toString()}`
        );
        setOlderParts((parts) => [
          {
            partIndex: prev.partIndex,
            threadId: prev.providerThreadId,
            subject: prev.subject,
            openedAt: prev.openedAt,
            messages: json.thread.messages,
            hasOlder: json.thread.hasOlder,
          },
          ...parts,
        ]);
      }
      // Keep the same messages under the viewport after prepending.
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (!el) return;
        el.scrollTop = prevTop + (el.scrollHeight - prevHeight);
      });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't load earlier messages"
      );
    } finally {
      setLoadingOlder(false);
    }
  }, [
    account,
    loadingOlder,
    thread,
    threadId,
    olderParts,
    chatParts,
    scrollRef,
    setChatParts,
    setLoadingOlder,
    setOlderParts,
    setThread,
  ]);

  const loadNewerMessages = React.useCallback(async () => {
    if (!thread?.hasNewer || loadingNewer || !thread.messages.length) return;
    const newestId = thread.messages[thread.messages.length - 1].id;
    setLoadingNewer(true);
    try {
      const params = new URLSearchParams({
        account,
        id: threadId,
        after: newestId,
      });
      const json = await apiJson<{ thread: MailThreadDetail }>(
        `/api/mail/thread?${params.toString()}`
      );
      setThread((current) => {
        if (!current) return current;
        const seen = messageKeys(current.messages);
        const newer = json.thread.messages.filter(
          (m) => !seen.has(messageKey(m))
        );
        if (!newer.length) {
          return { ...current, hasNewer: false };
        }
        return {
          ...current,
          messages: [...current.messages, ...newer],
          hasNewer: json.thread.hasNewer,
        };
      });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't load newer messages"
      );
    } finally {
      setLoadingNewer(false);
    }
  }, [account, loadingNewer, thread, threadId, setLoadingNewer, setThread]);

  // Avoid fetching older/newer pages while the open-thread pin is still settling.
  const canAutoloadPagesRef = React.useRef(false);
  React.useEffect(() => {
    canAutoloadPagesRef.current = false;
    const t = window.setTimeout(() => {
      canAutoloadPagesRef.current = true;
    }, 700);
    return () => window.clearTimeout(t);
  }, [threadId]);

  const headOlder = olderParts[0];
  const headHasOlderInPart = headOlder
    ? headOlder.hasOlder
    : Boolean(thread?.hasOlder);
  const headPartIndexForScroll =
    headOlder?.partIndex ?? thread?.chat?.partIndex ?? 1;
  const canLoadOlderAcrossParts =
    Boolean(thread?.chat) &&
    !headHasOlderInPart &&
    headPartIndexForScroll > 1;
  React.useEffect(() => {
    const el = scrollRef.current;
    if (
      !el ||
      (!headHasOlderInPart &&
        !canLoadOlderAcrossParts &&
        !thread?.hasNewer)
    ) {
      return;
    }
    const onScroll = () => {
      if (!canAutoloadPagesRef.current) return;
      if (
        (headHasOlderInPart || canLoadOlderAcrossParts) &&
        el.scrollTop < 80
      ) {
        void loadOlderMessages();
      }
      if (
        thread?.hasNewer &&
        el.scrollHeight - el.scrollTop - el.clientHeight < 120
      ) {
        void loadNewerMessages();
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [
    loadOlderMessages,
    loadNewerMessages,
    headHasOlderInPart,
    canLoadOlderAcrossParts,
    thread?.hasNewer,
    scrollRef,
  ]);

  /**
   * Scrolled up, with the newest message somewhere below.
   *
   * A long thread is read from the bottom, and reading back through it
   * leaves no way down but the same scrolling again. This is the button
   * every chat window has in that corner.
   *
   * "Near enough" rather than exactly at the end: a thread pinned to its
   * last message still sits a pixel or two off it after a resize, and a
   * button that appears for that is a button that flickers.
   */
  const zoomAnchorRef = React.useRef<ZoomAnchor | null>(null);

  /** The scroller's own padding, which does not scale with the stream. */
  const scrollerPadding = (el: HTMLElement) => {
    const style = window.getComputedStyle(el);
    return {
      top: Number.parseFloat(style.paddingTop) || 0,
      bottom: Number.parseFloat(style.paddingBottom) || 0,
    };
  };

  /**
   * Can a message's rectangle be compared with the scroller's numbers?
   *
   * The messages sit inside the zoomed element and the scroller sits
   * outside it, and whether a rectangle measured in there comes back in
   * the same pixels as `scrollTop` is up to the engine. Twice now this
   * has been assumed and twice it has been wrong, so it is measured:
   * while the reader scrolls, a message's rectangle has to move by
   * exactly what `scrollTop` moved by. Anything else and the two are in
   * different units and must not be mixed.
   *
   * Null until a scroll has been long enough to tell. Until then, and
   * whenever the answer is no, the fraction below is used instead: it
   * reads nothing but the scroller, so it cannot be caught out this way.
   */
  const rectsMoveWithScroll = React.useRef<boolean | null>(null);
  const rectProbeRef = React.useRef<{
    id: string;
    top: number;
    scrollTop: number;
  } | null>(null);
  const probeRectSpace = (el: HTMLElement) => {
    const node = el.querySelector<HTMLElement>("[data-message-id]");
    const id = node?.dataset.messageId;
    if (!node || !id) return;
    const top = node.getBoundingClientRect().top;
    const previous = rectProbeRef.current;
    // The reading to compare against is kept until it has been used, not
    // replaced on every scroll event. A trackpad delivers a dozen events
    // for one flick of a finger, so replacing it each time left every
    // comparison a few pixels wide — never enough to answer anything,
    // and the exact anchoring below therefore never once ran.
    if (!previous || previous.id !== id) {
      rectProbeRef.current = { id, top, scrollTop: el.scrollTop };
      return;
    }
    const scrolled = el.scrollTop - previous.scrollTop;
    // Far enough that rounding cannot account for the answer.
    if (Math.abs(scrolled) < 40) return;
    const moved = -(top - previous.top) / scrolled;
    rectsMoveWithScroll.current = Math.abs(moved - 1) < 0.05;
    rectProbeRef.current = { id, top, scrollTop: el.scrollTop };
  };

  /**
   * Take a reading, for zoom to put back.
   *
   * `atY` is a line across the window — the pointer, when a pinch says
   * where it is. Zooming then holds whatever sits on that line, so the
   * words under the fingers stay under the fingers. Without one the line
   * is the top edge of the pane, which is where the eye is when the
   * reader uses the buttons or the keys instead.
   */
  const captureZoomAnchor = React.useCallback((atY?: number | null) => {
    const el = scrollRef.current;
    if (!el) return;
    const paneTop = el.getBoundingClientRect().top;
    // A pinch that starts outside the pane still zooms it, and a line
    // above or below the pane has nothing on it to hold.
    const line =
      typeof atY === "number" && Number.isFinite(atY)
        ? Math.min(Math.max(atY, paneTop), paneTop + el.clientHeight)
        : paneTop;
    if (rectsMoveWithScroll.current) {
      // The message the line cuts, and how far down it the line falls.
      // This is the least forgiving place to be wrong, which makes it
      // the right one to be exact about.
      const nodes = el.querySelectorAll<HTMLElement>("[data-message-id]");
      for (const node of Array.from(nodes)) {
        const box = node.getBoundingClientRect();
        // The first message still on screen: the one the line cuts, or
        // the next one down when the line falls in the gap above it.
        if (box.bottom < line) continue;
        const id = node.dataset.messageId;
        if (!id) break;
        zoomAnchorRef.current = {
          kind: "message",
          id,
          into: box.height ? (line - box.top) / box.height : 0,
          line,
        };
        return;
      }
    }
    // Every number off the scroller, which is outside the zoom. Close
    // rather than exact — text rewraps, so the same fraction of the
    // stream is a slightly different place — but it cannot be wrong
    // about which units it is in.
    const pad = scrollerPadding(el);
    const content = el.scrollHeight - pad.top - pad.bottom;
    if (content <= 0) return;
    const hold = line - paneTop;
    zoomAnchorRef.current = {
      kind: "fraction",
      top: el.scrollTop - pad.top + hold,
      content,
      hold,
    };
  }, [scrollRef]);

  /**
   * Put that place back under the middle at the new size.
   *
   * A layout effect, so the correction lands in the same frame the new
   * size does and there is nothing to see.
   */
  const lastZoomRef = React.useRef(zoom);
  React.useLayoutEffect(() => {
    const previous = lastZoomRef.current;
    lastZoomRef.current = zoom;
    if (previous === zoom) return;
    const el = scrollRef.current;
    const anchor = zoomAnchorRef.current;
    if (!el || !anchor) return;
    // The probe compares one reading with the one before it and reads
    // the difference as scrolling. A size change between the two moves
    // the rectangle for a second reason, so the reading before this one
    // is no longer something to compare against.
    rectProbeRef.current = null;

    if (anchor.kind === "message") {
      const selector = `[data-message-id="${anchor.id
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')}"]`;
      const node = el.querySelector<HTMLElement>(selector);
      if (node) {
        const box = node.getBoundingClientRect();
        el.scrollTop += box.top + box.height * anchor.into - anchor.line;
        // The same line, for the next step of a pinch: a gesture holds
        // one place from beginning to end, not a place per step.
        captureZoomAnchor(anchor.line);
        return;
      }
      // The message went while the size changed. Nothing to hold on to.
      return;
    }

    if (anchor.content <= 0) return;
    const pad = scrollerPadding(el);
    const content = el.scrollHeight - pad.top - pad.bottom;
    if (content <= 0) return;
    // The scale is measured rather than worked out from the zoom values:
    // text rewraps, so the stream does not grow by exactly the ratio
    // between them, and what it actually grew by is there to be read.
    el.scrollTop =
      (anchor.top * content) / anchor.content + pad.top - anchor.hold;
    captureZoomAnchor(el.getBoundingClientRect().top + anchor.hold);
  }, [zoom, captureZoomAnchor, scrollRef]);

  const [awayFromLatest, setAwayFromLatest] = React.useState(false);
  React.useEffect(() => {
    const el = streamNode;
    if (!el) return;
    const check = () => {
      setAwayFromLatest(
        el.scrollHeight - el.scrollTop - el.clientHeight > NEAR_LATEST_PX
      );
      // Scrolling is the only chance to find out what a rectangle
      // measured inside the zoom is worth, so it is taken every time.
      probeRectSpace(el);
      // The same moments tell zoom what to hold on to: wherever the
      // reader has come to rest is what zooming should keep in front of
      // them. Reading it now costs nothing and saves reading it later,
      // when the new size has already been applied and the old view is
      // gone.
      captureZoomAnchor();
    };
    check();
    /*
      Not while a pane is sliding, from either direction.

      The stream re-wraps on every frame of a slide, which both resizes it
      and moves the scroll under it — so this ran twice a frame, each time
      changing state and rendering this pane, over a movement whose whole
      job is to move one edge. One reading at the end says the same thing,
      and the reader is not scrolling during it anyway.
    */
    const guarded = () => {
      if (afterMailPaneSlide(check)) return;
      check();
    };
    el.addEventListener("scroll", guarded, { passive: true });
    // Messages arriving make the stream taller under a reader who has not
    // moved, which is the other way this becomes true.
    const observer = new ResizeObserver(guarded);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => {
      el.removeEventListener("scroll", guarded);
      observer.disconnect();
    };
    // streamNode: the element itself, so this runs the moment there is
    // one to listen to rather than once before there is.
  }, [streamNode, captureZoomAnchor]);

  /*
    The reply box pushes the thread up rather than covering its tail.

    The composer stands in the flow below the stream, so opening it makes
    the stream shorter — but the scroll held its number, and what the
    number now showed ended higher, so the end of the last message went
    under the box just as the reader turned to answer it. When the
    stream's own height changes, the scroll moves by the same amount: the
    bottom edge of what was being read stays put above whatever took the
    room, and gets the room back when it goes. Clamped at both ends by
    the scroller itself.
  */
  const streamHeightRef = React.useRef(-1);
  const keepStreamBottom = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const previous = streamHeightRef.current;
    const now = el.clientHeight;
    if (now === previous) return;
    streamHeightRef.current = now;
    if (previous < 0) return;
    el.scrollTop = Math.max(0, el.scrollTop + (previous - now));
  }, [scrollRef]);
  /*
    Two listeners, one ledger. The layout effect answers the app's own
    changes — the composer mounting, leaving, being dragged taller — in
    the same commit, before anything paints. The observer answers what
    commits never see, a window edge being dragged. Both settle against
    the same remembered height, so whichever heard first, the other
    finds nothing left to move.
  */
  React.useLayoutEffect(keepStreamBottom);
  React.useEffect(() => {
    const el = streamNode;
    if (!el) return;
    const observer = new ResizeObserver(keepStreamBottom);
    observer.observe(el);
    return () => observer.disconnect();
  }, [streamNode, keepStreamBottom]);

  /**
   * The newest window as it was, so coming back to it costs nothing.
   *
   * A thread is opened at its newest page, so by the time anybody can ask
   * to go back there, that page has been fetched already. Going to the
   * start replaces the window with the oldest page, and this is what was
   * put down. Kept per thread; the next thread opens its own.
   */
  const latestWindowRef = React.useRef<MailThreadDetail | null>(null);
  React.useEffect(() => {
    latestWindowRef.current = null;
  }, [threadId]);
  React.useEffect(() => {
    // A window with nothing newer beyond it is the newest window.
    if (thread && !thread.hasNewer) latestWindowRef.current = thread;
  }, [thread]);

  /**
   * Back to the newest message in the thread, not the newest one loaded.
   *
   * Scrolling to the bottom of the window is only the end of the thread
   * when the window reaches it. Read back to the start of a long thread
   * and the bottom of what is on screen is the middle of the conversation
   * — which is where this used to stop.
   *
   * A jump, not a walk, and the mirror of `goToFirstMessage`: the window
   * is replaced with the newest page outright. Paging forward through
   * everything in between would fetch the whole thread to reach a message
   * that has already been fetched once.
   */
  const goToLatestMessage = React.useCallback(async () => {
    const toEnd = (smooth: boolean) => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTo({
        top: el.scrollHeight,
        behavior: smooth ? "smooth" : "auto",
      });
    };
    // The window already reaches the end. Only the scroll is between the
    // reader and the newest message.
    if (!thread?.hasNewer) {
      toEnd(true);
      return;
    }

    // The pin that opens a thread at its bottom wakes when the newest
    // message changes, which replacing the window does. Claimed before
    // the change, as the jump to the start claims it.
    skipOpenPinRef.current = true;
    const cached = latestWindowRef.current;
    if (cached) {
      setOlderParts([]);
      setThread(cached);
    } else {
      // Nothing put down to go back to — the pane was opened on a search
      // hit in the middle of the thread and has never been at the end.
      // One request for the newest page, the same one opening it makes.
      setLoadingNewer(true);
      try {
        const params = new URLSearchParams({ account, id: threadId });
        if (messageCount) params.set("count", String(messageCount));
        const json = await apiJson<{ thread: MailThreadDetail }>(
          `/api/mail/thread?${params.toString()}`
        );
        setOlderParts([]);
        setThread(json.thread);
      } catch (err) {
        skipOpenPinRef.current = false;
        toast.error(
          err instanceof Error ? err.message : "Couldn't open the latest"
        );
        return;
      } finally {
        setLoadingNewer(false);
      }
    }

    // The new page has to be laid out before there is a bottom to go to.
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
      const el = scrollRef.current;
      if (!el) continue;
      const wasAtEnd =
        el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_LATEST_PX;
      toEnd(false);
      // Settled: the last two goes landed in the same place, so the page
      // has stopped growing under it.
      if (wasAtEnd) return;
    }
  }, [account, messageCount, thread, threadId, scrollRef, setLoadingNewer, setOlderParts, setThread]);

  // A list refresh showing this thread gained mail refetches the newest page
  // and merges it — older prepended history is kept. Skip while mid-thread
  // (search deep-link) so we don't create a gap to the tip.
  React.useEffect(() => {
    if (!refreshToken || seenRefreshToken.current === refreshToken) return;
    seenRefreshToken.current = refreshToken;
    let cancelled = false;
    void (async () => {
      try {
        const params = new URLSearchParams({ account, id: threadId });
        if (messageCount) params.set("count", String(messageCount));
        const json = await apiJson<{ thread: MailThreadDetail }>(
          `/api/mail/thread?${params.toString()}`
        );
        if (cancelled) return;
        setThread((current) => {
          if (!current) return json.thread;
          if (current.hasNewer) return current;
          const currentLast = current.messages[current.messages.length - 1];
          const nextLast = json.thread.messages[json.thread.messages.length - 1];
          if (currentLast?.id === nextLast?.id) return current;
          return mergeNewestThreadPage(current, json.thread);
        });
      } catch {
        // Background refresh is best-effort; the pane keeps what it has.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshToken, account, threadId, messageCount, setThread]);

  const newestMessageId =
    thread?.messages[thread.messages.length - 1]?.id ?? null;
  /**
   * Set when the reader asked to go somewhere specific in this thread.
   *
   * Replacing the window changes the newest message, which is what wakes
   * the open-at-the-bottom pin below. Without this it would drag the view
   * back down — twice, because its observer re-pins as the new page lays
   * out. Cleared when the thread changes, which is the next time opening
   * at the bottom is the right thing to do.
   */
  const skipOpenPinRef = React.useRef(false);
  const scrolledToFocusRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    scrolledToFocusRef.current = null;
  }, [threadId, focusMessageId]);

  /**
   * A search hit that is not the newest message: land on it.
   *
   * Only then. The newest message is where a thread opens anyway (below),
   * and a hit the loaded window does not hold has nowhere to land, so both
   * fall through to that rule rather than leaving the pane where it started
   * — which was the top, and read as the thread opening on its oldest
   * message.
   */
  const deepLinkTarget =
    focusMessageId &&
    focusMessageId !== newestMessageId &&
    thread?.messages.some((m) => m.id === focusMessageId)
      ? focusMessageId
      : null;

  React.useEffect(() => {
    // Search deep-link: pin the hit in view (once), then stop.
    const el = scrollRef.current;
    if (!thread || !el || !deepLinkTarget) return;
    if (scrolledToFocusRef.current === deepLinkTarget) return;

    const pin = () => {
      const target = el.querySelector<HTMLElement>(
        `[data-message-id="${deepLinkTarget.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`
      );
      if (!target) return false;
      const paneTop = el.getBoundingClientRect().top;
      const targetTop = target.getBoundingClientRect().top;
      el.scrollTop = Math.max(
        0,
        el.scrollTop + (targetTop - paneTop) - el.clientHeight * 0.25
      );
      scrolledToFocusRef.current = deepLinkTarget;
      return true;
    };
    if (pin()) return;

    const observer = new ResizeObserver(() => {
      if (pin()) observer.disconnect();
    });
    observer.observe(el.firstElementChild ?? el);
    const timer = setTimeout(() => observer.disconnect(), 2000);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [thread, deepLinkTarget, scrollRef]);

  React.useEffect(() => {
    if (!highlightMessageId) return;
    const t = window.setTimeout(() => setHighlightMessageId(null), 2200);
    return () => window.clearTimeout(t);
  }, [highlightMessageId, setHighlightMessageId]);

  /**
   * Where a thread opens.
   *
   * One message: the very top. There is nothing above it to hint at.
   *
   * More than one: twenty pixels above the head of the newest message. Not
   * the bottom — the bottom of a long message is its tail, and a reader put
   * there has to scroll up to find out what the message says and then come
   * back down. The top of the newest message is where reading it starts,
   * and the twenty pixels show the tail of the one before, which is the
   * sign, without scrolling, that the conversation goes on above the fold.
   * A short newest message near the end works out the same — the scroll
   * clamps and the pane sits at the bottom.
   *
   * Skipped only when a search hit older than the newest message is being
   * landed on, which has its own place to be. A hit that is the newest
   * message, or one the loaded window does not hold, opens by this rule.
   */
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!thread || !el || !newestMessageId || deepLinkTarget) return;
    if (skipOpenPinRef.current) return;

    /*
      The pin follows the stream while it settles: pictures and email
      frames arrive over the first second or two and make it taller under
      a reader who has not moved yet, and the newest message has to stay
      where it was put.

      Two things end it, and both used to be missed.

      A resize the reader asked for is not the thread settling. Changing
      the text size resizes the whole stream, and this read that as more
      mail arriving and put them back at the newest message — which on a
      one-message thread is `scrollTop = 0`, the very top. Zoom holds its
      own place; this must not take it back.

      And the reader moving ends it however they move. `wheel` alone
      missed the keyboard, the scrollbar, and a trackpad that reports
      scrolling any other way.
    */
    const zoomAtOpen = zoomRef.current;
    let placed = -1;

    const pin = () => {
      if (zoomRef.current !== zoomAtOpen) {
        stop();
        return;
      }
      const bubbles = el.querySelectorAll<HTMLElement>(
        '[data-mail-bubble="1"]'
      );
      const newest = bubbles[bubbles.length - 1];
      if (!newest) {
        /*
          No bubbles yet — the stream is still putting them up. Guessing
          meant jumping to the bottom of everything: the guess was made
          against a stream tens of thousands of pixels tall that had not
          measured itself, the clamp as it shrank read as the reader
          moving, and the follower stopped before it ever saw a bubble —
          which is how a long thread opened at the very end of its last
          message. The observer calls again when there is something to
          stand on.
        */
        return;
      }
      if (bubbles.length === 1) {
        el.scrollTop = 0;
      } else {
        const paneTop = el.getBoundingClientRect().top;
        const bubbleTop = newest.getBoundingClientRect().top;
        const air = 20;
        el.scrollTop = Math.max(0, el.scrollTop + (bubbleTop - paneTop) - air);
      }
      placed = Math.round(el.scrollTop);
    };

    const onScroll = () => {
      // Before anything was placed, any movement is the reader's.
      if (placed < 0) {
        stop();
        return;
      }
      // Where the pin last put them is not the reader moving — and nor is
      // the browser clamping that place down because the settling stream
      // got shorter under it.
      const clampedPlace = Math.min(
        placed,
        Math.max(0, el.scrollHeight - el.clientHeight)
      );
      if (Math.round(el.scrollTop) !== clampedPlace) stop();
    };
    const stop = () => {
      window.clearInterval(interval);
      el.removeEventListener("scroll", onScroll);
    };
    /*
      A short heartbeat, not a ResizeObserver. The observer watched the
      stream's first child, and React replaces that element while the
      messages measure themselves in — a detached node reports nothing,
      so the pin ran once against the unmeasured stream and never again.
      The heartbeat asks the live document each time, and two seconds of
      it at this pace costs a handful of rect reads.
    */
    const interval = window.setInterval(pin, 150);

    pin();
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("touchstart", stop, { passive: true, once: true });
    const timer = setTimeout(stop, 2000);

    return () => {
      clearTimeout(timer);
      stop();
      el.removeEventListener("touchstart", stop);
    };
    // `thread` is read only to see that it is there, and `newestMessageId`
    // changes when it arrives. A run for each new thread object moves the
    // scroll under the reader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, newestMessageId, deepLinkTarget]);

  return {
    loadOlderMessages,
    loadNewerMessages,
    headHasOlderInPart,
    canLoadOlderAcrossParts,
    captureZoomAnchor,
    awayFromLatest,
    goToLatestMessage,
    skipOpenPinRef,
  };
}
