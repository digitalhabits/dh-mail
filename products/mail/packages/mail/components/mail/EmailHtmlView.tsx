"use client";

import * as React from "react";

import { MAIL_PINCH_SCALE_EVENT, MAIL_PINCH_WHEEL_EVENT } from "@/lib/mail/pinch";
import { Loader2 } from "lucide-react";
import { afterMailPaneSlide } from "@/lib/mail/pane-slide";
import { useMailT } from "@/lib/mail/i18n";
import { type MailLinkMenuModel } from "@/lib/mail/link-menu";
import { sanitizeEmailHtml } from "@/lib/mail/email-html";
import {
  MAIL_FRAME_PRESS_EVENT,
  frameString,
  isOpenableMailUrl,
  postToFrame,
  readFrameMessage,
  type FrameMessage,
} from "@/lib/mail/frame-messages";
import { LinkContextMenu, buildSrcDoc, followMailLink } from "@/components/mail/email-frame";
import {
  forwardFrameKey,
  forwardFramePinch,
  frameLinkMenu,
  frameMessageMenu,
  readFrameMetrics,
  type FrameMetrics,
} from "@/components/mail/email-frame-events";

/**
 * Renders untrusted email HTML safely.
 *
 * - The HTML is sanitized against an allowlist of elements, attributes and
 *   URL schemes (see lib/mail/email-allowlist.ts).
 * - It is shown in an iframe, which keeps the sender's CSS and layout away
 *   from the app.
 * - The iframe is sandboxed without `allow-same-origin`. Its document has an
 *   opaque origin. A script that runs in it cannot read this page, and it
 *   cannot reach `parent.__TAURI__` or any app command.
 * - A CSP <meta> inside that frame stops code from running. `default-src
 *   'none'` refuses everything, and `script-src` names the sha256 of one
 *   script: the frame script (see lib/mail/link-bridge.ts).
 * - The same CSP refuses every network fetch — tracking pixels, remote CSS
 *   backgrounds — until the reader asks for images.
 *
 * So three separate barriers stop a script in a mail: the sanitizer, the
 * CSP, and the sandbox. Before 2026-10, the frame had `allow-same-origin`
 * and only the CSP stopped a script from reaching the app.
 *
 * The page cannot read the frame, so it does not measure it or listen in it.
 * The frame script does that work and sends the results as postMessage:
 * its size, link clicks, the right-click menus, a double click, keys, the
 * pinch, and find-in-thread. The page sends it the zoom, the dark-mode flag
 * and the search words. Each message is accepted only from the frame's own
 * window (`event.source`). See lib/mail/frame-messages.ts.
 *
 * The parts:
 *
 *   lib/mail/email-html.ts         the sanitizer, and the quote cut from a reply
 *   lib/mail/email-allowlist.ts    what the sanitizer keeps
 *   lib/mail/link-bridge.ts        the frame script and its CSP hash
 *   lib/mail/frame-script/         the parts of the frame script
 *   lib/mail/frame-messages.ts     the page side of the messages
 *   email-frame.tsx                the frame's document and the link menu
 *   email-frame-events.ts          what the page does with each message
 */

/** The gutter `.mail-bubble-column` keeps beside itself — see mail.css. */
const BUBBLE_GUTTER_PX = 14;

/**
 * How much room the bubble would have at 100%, in the bubble's own pixels.
 *
 * At rest, deliberately, because this decides the size a mail is *started*
 * at and not the size it is held to. Measured at the size currently shown,
 * the room shrinks exactly as fast as the reader zooms — every pixel asked
 * for came back off the room — so the mail stayed pinned to the pane and
 * the zoom control did nothing at all for it.
 *
 * The column's parent gives it: full-width, so it measures the pane, and
 * the same in screen pixels whatever the stream is zoomed to.
 *
 * Not `getComputedStyle().maxWidth` on the column, which hands back the
 * `min()` expression as written rather than a length — it parsed as
 * nothing, every mail read as having room enough, and the scaling this
 * feeds never ran at all.
 */
function roomAtRest(column: HTMLElement, chrome: number): number {
  const parent = column.parentElement;
  const width = parent?.getBoundingClientRect().width ?? 0;
  if (!(width > 0)) return Number.POSITIVE_INFINITY;
  return width - BUBBLE_GUTTER_PX - chrome;
}

/**
 * What the bubble puts around the frame: borders and padding, added up.
 *
 * Not the difference between the column's width and the frame's. That is
 * the border only when the mail happens to fill the column. For anything
 * narrower it is the empty space beside the message, which is hundreds of
 * pixels, and which moves when the mail is resized. Used as the chrome, it
 * makes the room look far too small. Then a mail with a whole pane to spread
 * into is scaled down anyway. It also moves with the answer that it feeds,
 * so it never settles.
 *
 * Borders and padding do not move. They are also already in the column's
 * own pixels, zoom or no zoom: a 1px border computes as 1px whatever it is
 * painted at.
 */
function chromeAroundFrame(frame: HTMLElement, column: HTMLElement): number {
  let total = 0;
  let node: HTMLElement | null = frame.parentElement;
  while (node) {
    const styles = window.getComputedStyle(node);
    total +=
      (parseFloat(styles.borderLeftWidth) || 0) +
      (parseFloat(styles.borderRightWidth) || 0) +
      (parseFloat(styles.paddingLeft) || 0) +
      (parseFloat(styles.paddingRight) || 0);
    if (node === column) break;
    node = node.parentElement;
  }
  return total;
}

/**
 * The zoom the message is shown at: the reader's zoom, made smaller when a
 * message that cannot reflow does not fit.
 *
 * `narrowest` is the narrowest width the frame measured, with no zoom in
 * it. The room is the one the bubble has at 100% (see `roomAtRest`), so the
 * answer does not move when the zoom it sets is applied. It settles in one
 * pass.
 *
 * Also never wider than the pane. The zoom control grows a fixed mail until
 * it fills the pane and stops there. That room is read at the size shown,
 * in screen pixels.
 *
 * It also tells the bubble's column how wide the mail cannot go under, so
 * the cap gives that room rather than clip it (`--mail-bubble-fixed`, see
 * `.mail-bubble-column` in mail.css).
 */
function fittedZoom(frame: HTMLIFrameElement, narrowest: number, base: number): number {
  const column = frame.closest<HTMLElement>(".mail-bubble-column");
  const chrome = column ? chromeAroundFrame(frame, column) : 0;
  if (column && narrowest > 0) {
    column.style.setProperty("--mail-bubble-fixed", `${Math.ceil(narrowest + chrome)}px`);
  }
  const room = column ? roomAtRest(column, chrome) : Number.POSITIVE_INFINITY;
  const fit = room > 0 && narrowest > room ? room / narrowest : 1;
  const parentReal = column?.parentElement?.getBoundingClientRect().width ?? 0;
  const ceiling =
    parentReal > 0 && narrowest > 0
      ? (parentReal - (BUBBLE_GUTTER_PX + chrome) * base) / narrowest
      : Number.POSITIVE_INFINITY;
  return Math.min(base * fit, Math.max(ceiling, 0.25));
}

type LinkMenuState = {
  model: MailLinkMenuModel | null;
  image?: string;
  x: number;
  y: number;
};

export function EmailHtmlView({
  html,
  allowImages,
  inlineImages,
  zoom = 1,
  imageMaxHeight,
  bodyColor,
  frameCss,
  onContentDoubleClick,
  onContentContextMenu,
  darkRecolor = false,
  highlight,
}: {
  /** Search words to paint in the message, as the list paints them. */
  highlight?: string[];
  html: string;
  allowImages: boolean;
  inlineImages?: Record<string, string>;
  /**
   * Tallest a picture may be, in frame pixels.
   *
   * For a view with a ceiling of its own, where a full-height screenshot
   * would fill it and leave no room for the message it came with. Unset in
   * the thread, where a picture is shown at the size it was sent.
   */
  imageMaxHeight?: number;
  /**
   * The color the words take when the HTML names none of its own.
   *
   * Unset means #292524, which is what a sender's mail assumes it is being
   * read on white. A message of your own on the dark theme passes a light
   * one instead: the composer names no colors, so there is nothing to argue
   * with, and the bubble under it can be dark. See `ownWordsInTheDark`.
   */
  bodyColor?: string;
  /**
   * Extra CSS for the frame, last in its stylesheet.
   *
   * For a caller that shows a message inside a card of its own and needs
   * the words to keep that card's face — the send preview. See
   * `composer-preview`.
   */
  frameCss?: string;
  /**
   * Thread-pane zoom. CSS zoom on an ancestor never reaches an iframe's
   * document properly — WebKit scales the frame's rendered pixels (blurry,
   * and stale after zoom changes), Chromium leaves the content unscaled — so
   * the ancestor zoom is cancelled on the iframe element (zoom: 1/z) and
   * re-applied inside the document, where text re-lays-out crisply.
   */
  zoom?: number;
  /** A double-click on the sender's page, beside the words. */
  onContentDoubleClick?: () => void;
  /**
   * A right-click on the sender's page, not on a link: where in the page it
   * was, and what text the reader had selected.
   */
  onContentContextMenu?: (x: number, y: number, selectedText: string) => void;
  /** Re-light the sender's colours for a dark card. See frame-script/dark.ts. */
  darkRecolor?: boolean;
}) {
  const t = useMailT();
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const onDblClickRef = React.useRef(onContentDoubleClick);
  const onContextMenuRef = React.useRef(onContentContextMenu);
  const darkRecolorRef = React.useRef(darkRecolor);
  const zoomRef = React.useRef(zoom);
  const highlightRef = React.useRef(highlight);
  React.useLayoutEffect(() => {
    onDblClickRef.current = onContentDoubleClick;
    onContextMenuRef.current = onContentContextMenu;
    darkRecolorRef.current = darkRecolor;
    zoomRef.current = zoom;
    highlightRef.current = highlight;
  });
  const [height, setHeight] = React.useState(140);
  /**
   * The width the content would take if nothing constrained it.
   *
   * Null until measured, and the frame fills the bubble as it always did.
   * Measured, it goes on the frame as its width, so a message of two words
   * takes two words' worth of bubble instead of the whole pane — the same
   * as a plain-text message. `max-width: 100%` still caps it.
   */
  const [naturalWidth, setNaturalWidth] = React.useState<number | null>(null);
  /*
    The size the mail is shown at inside the frame — the reader's zoom,
    less whatever it was scaled by to fit. Kept beside the width so the
    frame is sized from the two without waiting for a measurement.
  */
  const [bodyZoom, setBodyZoom] = React.useState(1);
  const [linkMenu, setLinkMenu] = React.useState<LinkMenuState | null>(null);
  const dismissLinkMenu = React.useCallback(() => setLinkMenu(null), []);
  /** False until the frame sends its first size — avoids an empty cut-off bubble. */
  const [ready, setReady] = React.useState(false);
  /** Only show the spinner if paint is slow — cache reopen should not flash it. */
  const [showPlaceholder, setShowPlaceholder] = React.useState(false);
  /** The last size the frame sent, with the zoom its body has now. */
  const metricsRef = React.useRef<FrameMetrics | null>(null);

  const srcDoc = React.useMemo(() => {
    if (typeof window === "undefined") return "";
    return buildSrcDoc(
      sanitizeEmailHtml(html, inlineImages),
      allowImages,
      window.location.origin,
      imageMaxHeight,
      bodyColor,
      frameCss
    );
  }, [html, allowImages, inlineImages, imageMaxHeight, bodyColor, frameCss]);

  React.useEffect(() => {
    if (ready) {
      setShowPlaceholder(false);
      return;
    }
    const timer = window.setTimeout(() => setShowPlaceholder(true), 120);
    return () => window.clearTimeout(timer);
  }, [ready]);

  /** What the frame needs to draw: the zoom, dark mode, the search words. */
  const sendConfig = React.useCallback(() => {
    postToFrame(iframeRef.current, {
      type: "config",
      zoom: metricsRef.current?.zoom ?? zoomRef.current,
      dark: darkRecolorRef.current,
      terms: highlightRef.current ?? [],
    });
  }, []);

  /** A stable way to call `applyFit` later, for afterMailPaneSlide. */
  const applyFitRef = React.useRef<() => void>(() => {});
  const applyFitLater = React.useMemo(() => () => applyFitRef.current(), []);

  /**
   * Work out the zoom from the last size, and send it if it changed.
   *
   * Not while a pane slides: its width is wrong on every frame of the
   * slide. One reading at the end says the same thing.
   */
  const applyFit = React.useCallback(() => {
    const frame = iframeRef.current;
    const metrics = metricsRef.current;
    if (!frame || !metrics) return;
    if (afterMailPaneSlide(applyFitLater)) return;
    const applied = fittedZoom(frame, metrics.narrowest, zoomRef.current);
    setBodyZoom(applied);
    if (Math.abs(metrics.zoom - applied) > 0.002) {
      metrics.zoom = applied;
      postToFrame(frame, { type: "zoom", value: applied });
    }
  }, [applyFitLater]);
  React.useLayoutEffect(() => {
    applyFitRef.current = applyFit;
  }, [applyFit]);

  /** Ask the frame to measure again, after a slide. Stable, as above. */
  const measureLater = React.useMemo(
    () => () => postToFrame(iframeRef.current, { type: "measure" }),
    []
  );

  const onSize = React.useCallback(
    (data: FrameMessage) => {
      const next = readFrameMetrics(data);
      metricsRef.current = next;
      setReady(true);
      // A size read while the pane slides is read at the wrong width.
      if (afterMailPaneSlide(measureLater)) return;
      if (next.height > 0) setHeight(next.height);
      // A floor of 160px, so a one-word message still has room for the
      // time in its corner.
      if (next.natural > 0) setNaturalWidth(Math.max(next.natural, 160));
      applyFit();
    },
    [applyFit, measureLater]
  );

  /*
    Every message from the frame. Registered before the frame can load, so
    its first "hello" is not missed. Only from this frame's own window.
  */
  React.useLayoutEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = iframeRef.current;
      const data = readFrameMessage(event, frame);
      if (!frame || !data) return;
      switch (data.type) {
        case "hello":
          sendConfig();
          return;
        case "size":
          onSize(data);
          return;
        case "open-url": {
          const url = frameString(data.url);
          if (isOpenableMailUrl(url)) void followMailLink(url);
          return;
        }
        case "key":
          forwardFrameKey(frame, data);
          return;
        case "pinch-wheel":
        case "pinch-scale":
          forwardFramePinch(frame, data);
          return;
        case "dblclick":
          onDblClickRef.current?.();
          return;
        case "press":
          // A press in the frame closes the menus that the page opened.
          setLinkMenu(null);
          window.dispatchEvent(new CustomEvent(MAIL_FRAME_PRESS_EVENT));
          return;
        case "link-menu": {
          const menu = frameLinkMenu(frame, data);
          if (menu) setLinkMenu(menu);
          return;
        }
        case "message-menu": {
          if (!onContextMenuRef.current) return;
          const at = frameMessageMenu(frame, data);
          onContextMenuRef.current(at.x, at.y, at.selectedText);
          return;
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [sendConfig, onSize]);

  /*
    The room changes when the window or the pane does, and nothing in the
    frame moves then. So the column is watched here, and the zoom is worked
    out again from the last size. The column is full-width under a ceiling,
    so it measures the room and never the mail.
  */
  React.useEffect(() => {
    const column = iframeRef.current?.closest<HTMLElement>(".mail-bubble-column");
    if (!column || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (afterMailPaneSlide(applyFitLater)) return;
      applyFit();
    });
    observer.observe(column);
    return () => observer.disconnect();
  }, [applyFit, applyFitLater]);

  // The search words, painted inside the frame by its own script.
  React.useEffect(() => {
    postToFrame(iframeRef.current, { type: "terms", terms: highlight ?? [] });
  }, [highlight]);

  // A change to dark mode after the frame is drawn.
  React.useEffect(() => {
    if (darkRecolor && metricsRef.current) sendConfig();
  }, [darkRecolor, sendConfig]);

  // The reader's zoom. The frame follows at once; the fit refines it.
  React.useEffect(() => {
    setBodyZoom(zoom);
    if (metricsRef.current) applyFit();
    else postToFrame(iframeRef.current, { type: "zoom", value: zoom });
  }, [zoom, applyFit]);

  return (
    <div className="relative w-full" style={{ minHeight: ready ? undefined : 140 }}>
      {showPlaceholder && !ready ? (
        <div
          className="flex min-h-[140px] items-center justify-center gap-2 px-4 py-10 text-sm text-stone-500"
          aria-live="polite"
        >
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
          {t("loadingMessage")}
        </div>
      ) : null}
      <iframe
        ref={iframeRef}
        title={t("emailContent")}
        srcDoc={srcDoc}
        /*
          No `allow-same-origin`. See the comment at the head of this file.
          `allow-scripts` is for the hash-pinned frame script only.
        */
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        // A second way in for the config, if the frame's "hello" came first.
        onLoad={sendConfig}
        // MAIL_FRAME_ATTR: find-in-thread asks the frames that carry it.
        data-dh-mail-frame=""
        className={
          ready
            ? "block w-full border-0 bg-transparent"
            : "pointer-events-none absolute inset-x-0 top-0 block w-full border-0 opacity-0"
        }
        style={{
          height: ready ? height : 140,
          // Its own width once known — see `naturalWidth`. The class keeps
          // `w-full` for the frame still measuring, and the inline value
          // wins once there is one. Never past the bubble.
          width:
            ready && naturalWidth != null
              ? Math.ceil(naturalWidth * bodyZoom)
              : undefined,
          maxWidth: "100%",
          /*
            The frame's own scheme, which decides two things the mail does
            not: what colour the canvas behind it is, and what colour the
            scrollbars are. Pinned to light, a re-lit message got a pale
            gutter along the foot and the right edge of every card.
          */
          colorScheme: darkRecolor ? "dark" : "light",
          zoom: 1 / zoom,
        }}
      />
      {linkMenu ? (
        <LinkContextMenu
          model={linkMenu.model}
          image={linkMenu.image}
          x={linkMenu.x}
          y={linkMenu.y}
          onDismiss={dismissLinkMenu}
        />
      ) : null}
    </div>
  );
}

export {
  MAIL_PINCH_SCALE_EVENT,
  MAIL_PINCH_WHEEL_EVENT,
};
