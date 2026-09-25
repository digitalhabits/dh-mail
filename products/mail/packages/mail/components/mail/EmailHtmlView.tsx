"use client";

import * as React from "react";

import {
  MAIL_PINCH_SCALE_EVENT,
  MAIL_PINCH_WHEEL_EVENT,
} from "@/lib/mail/pinch";
import { Loader2 } from "lucide-react";
import { afterMailPaneSlide, mailPaneSliding } from "@/lib/mail/pane-slide";
import { useMailT } from "@/lib/mail/i18n";
import {
  mailLinkMenuModel,
  type MailLinkMenuModel,
} from "@/lib/mail/link-menu";

/** Carries a mail link URL on a <span> so HTML5 parse cannot strip it. */
import { sanitizeEmailHtml } from "@/lib/mail/email-html";
import { recolorEmailForDark } from "@/lib/mail/email-html-dark";
import {
  LinkContextMenu,
  MAIL_OPEN_MSG_SOURCE,
  MAIL_OPEN_MSG_TYPE,
  attachDoubleClickForwarding,
  attachExternalLinkHandling,
  attachKeyForwarding,
  attachLinkContextMenu,
  attachPinchForwarding,
  buildSrcDoc,
  followMailLink,
  measureEmailFrameHeight,
  scrollParentOf,
} from "@/components/mail/email-frame";

/**
 * Renders untrusted email HTML safely.
 *
 * - The HTML is sanitized against an element and attribute blocklist. Scripts,
 *   embeds, forms, event handlers and javascript: URLs cannot survive it.
 * - It is shown in an iframe, which keeps the sender's CSS and layout away
 *   from the app.
 * - A CSP <meta> inside that frame stops code from running. `default-src
 *   'none'` refuses everything, and `script-src` names the sha256 of one
 *   script: the link bridge (see email-frame.tsx).
 * - The same CSP refuses every network fetch — tracking pixels, remote CSS
 *   backgrounds — until the reader asks for images.
 *
 * The sandbox attribute is not what stops code here, and this comment said
 * for a while that it was. The frame needs `allow-scripts` for the link
 * bridge, and `allow-same-origin` so the height can be measured from
 * `contentDocument`. Those two together leave the frame same-origin with this
 * page, which is also what lets find-in-thread read it. So the hash in
 * `script-src` is the control that keeps anything the sanitizer missed from
 * running. `MAIL_LINK_BRIDGE_JS` and its hash live in `lib/mail/link-bridge`,
 * where a suite checks that they still agree: a drift between them disables
 * the bridge, and it is the pin that would have moved.
 *
 * The parts:
 *
 *   lib/mail/email-html.ts       the sanitizer, and the quote cut from a reply
 *   lib/mail/email-html-dark.ts  the colours for dark mode
 *   email-frame.tsx              the frame's document, its height, and what
 *                                it passes back to the page
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
 * Not the difference between the column's width and the frame's, which is
 * what this was first. That is the border only when the mail happens to
 * fill the column; for anything narrower it is the empty space beside the
 * message, which is hundreds of pixels, and which moves when the mail is
 * resized. Used as the chrome it made the room look far too small, so a
 * mail with a whole pane to spread into was scaled down anyway — and since
 * it moved with the answer it fed, it never settled.
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

export function EmailHtmlView({
  html,
  allowImages,
  inlineImages,
  zoom = 1,
  imageMaxHeight,
  bodyColor,
  frameCss,
  onContentDoubleClick,
  darkRecolor = false,
}: {
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
  /** A double-click on the sender's page — see attachDoubleClickForwarding. */
  onContentDoubleClick?: () => void;
  /** Re-light the sender's colours for a dark card. See recolorEmailForDark. */
  darkRecolor?: boolean;
}) {
  const t = useMailT();
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const onDblClickRef = React.useRef(onContentDoubleClick);
  onDblClickRef.current = onContentDoubleClick;
  const darkRecolorRef = React.useRef(darkRecolor);
  darkRecolorRef.current = darkRecolor;
  const zoomRef = React.useRef(zoom);
  zoomRef.current = zoom;
  const [height, setHeight] = React.useState(140);
  /**
   * The width the content would take if nothing constrained it.
   *
   * Null until measured, and the frame fills the bubble as it always did.
   * Measured, it goes on the frame as its width, so a message of two words
   * takes two words' worth of bubble instead of the whole pane — the same
   * as a plain-text message. A newsletter's fixed 600px table answers
   * 600px and is none the narrower. `max-width: 100%` still caps it, so a
   * wide answer never pushes past the bubble; the document just reflows to
   * what it is given, as it did when the frame was always full width.
   */
  const [naturalWidth, setNaturalWidth] = React.useState<number | null>(null);
  /*
    The size the mail is shown at inside the frame — the reader's zoom,
    less whatever it was scaled by to fit. Kept beside the width so the
    frame is sized from the two without waiting for a measurement: a
    zoom that changed the body but not the frame left a newsletter cut
    off at the frame's edge with its right third out of reach.
  */
  const [bodyZoom, setBodyZoom] = React.useState(1);
  const [linkMenu, setLinkMenu] = React.useState<{
    model: MailLinkMenuModel;
    x: number;
    y: number;
  } | null>(null);
  const dismissLinkMenu = React.useCallback(() => setLinkMenu(null), []);
  /** False until the first iframe paint — avoids an empty cut-off bubble. */
  const [ready, setReady] = React.useState(false);
  /** Only show the spinner if paint is slow — cache reopen should not flash it. */
  const [showPlaceholder, setShowPlaceholder] = React.useState(false);

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

  // In-frame bridge (see MAIL_LINK_BRIDGE_JS) — reliable under Tauri WKWebView.
  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as {
        source?: unknown;
        type?: unknown;
        url?: unknown;
      } | null;
      if (!data || data.source !== MAIL_OPEN_MSG_SOURCE) return;
      if (data.type !== MAIL_OPEN_MSG_TYPE) return;
      if (typeof data.url !== "string") return;
      if (!/^(https?:|mailto:)/i.test(data.url)) return;
      void followMailLink(data.url);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  /** Asks for a measurement on the next frame; set up in `initDoc`. */
  const scheduleMeasureRef = React.useRef<(() => void) | null>(null);

  /** Documents already wired up — a frame is set up once, however we reach it. */
  const initedDocsRef = React.useRef<WeakSet<Document>>(new WeakSet());
  const observerRef = React.useRef<ResizeObserver | null>(null);
  /** Cancels a measurement queued for the frame — see `scheduleMeasure`. */
  const pendingMeasureRef = React.useRef<(() => void) | null>(null);

  /** Returns true when this call did the setup. */
  const initDoc = React.useCallback((doc: Document): boolean => {
    if (!doc.body) return false;
    if (initedDocsRef.current.has(doc)) return false;
    initedDocsRef.current.add(doc);

    doc.body.style.zoom = String(zoomRef.current);
    // Before anything is measured or shown: the recolour changes no
    // geometry, but the reader should never see the white version first.
    if (darkRecolorRef.current) recolorEmailForDark(doc);
    const measure = () => {
      // Not while the pane is sliding: its width is wrong on every frame
      // of the slide, and a ceiling read from it stuck the mail small
      // until something else moved. One reading at the end says the
      // same thing. The observer below already waits; the first
      // measure, the zoom's, and the timer's did not.
      if (mailPaneSliding()) {
        afterMailPaneSlide(() => scheduleMeasureRef.current?.());
        return;
      }
      /*
        Collapsed first, then measured.

        A mail with `height:100%` on its wrapper — a table, a body wrapper,
        an Outlook shell — is as tall as the frame it is given. Measure it
        in the frame we last sized, and the answer is that frame; set that
        as the height and the next measurement is bigger again. A message
        of two lines ended up hundreds of pixels tall, clamped, with a
        "show the whole message" button under an acre of nothing.

        At nought the percentage has nothing to be a percentage of, so what
        is left is the content's own height. The frame is put back before
        anything is painted.

        Two forced layouts, so it is not done sixty times a second: a pinch
        changes the zoom on every event, each change resizes the body, and
        the observer below answers each resize. That put four reflows per
        frame between the reader's fingers and the screen. Once per frame
        is enough — see `scheduleMeasure`.
      */
      const frame = iframeRef.current;
      const held = frame?.style.height ?? "";
      /*
        And the reader's place is held across it.

        A frame at nought is a thread that much shorter, and the browser
        clamps the scroll to the shorter one before this line returns.
        Putting the height back does not put the scroll back. On a thread
        of one message the frame is the whole thread, so the clamp was the
        whole way: every measurement — a size change, a picture arriving —
        put the reader back at the top of the message they were reading.
      */
      const scroller = frame ? scrollParentOf(frame) : null;
      const heldScroll = scroller?.scrollTop ?? 0;
      if (frame) frame.style.height = "0px";
      // Prefer content bounds (incl. trailing margins) over body.rect alone so
      // the frame keeps its height across content swaps (e.g. images toggle)
      // without clipping marketing footers.
      const next = measureEmailFrameHeight(doc);
      if (frame) frame.style.height = held;
      if (scroller && scroller.scrollTop !== heldScroll) {
        scroller.scrollTop = heldScroll;
      }
      if (next > 0) setHeight(next);
      /*
        And how wide it wants to be, the same way.

        `max-content` on the body sizes every block to its content, which
        is the width the mail would take with nothing to fill. That answer
        does not depend on the frame's width, so unlike the height there is
        no frame to collapse first and nothing to feed back. The margins
        are added by hand: the rect is the body's box, and the mail's own
        margin stands outside it, scaled by the reader's zoom like
        everything else in the frame.

        A floor of 160px, so a one-word message still has room for the
        time in its corner.
      */
      const body = doc.body;
      if (body) {
        const heldWidth = body.style.width;
        body.style.width = "max-content";
        const naturalBody = body.getBoundingClientRect().width;
        /*
          And the narrowest it can be, which is a different question and
          the more useful one.

          `max-content` says what it would like. `min-content` says what it
          cannot go under — for a mail of paragraphs that is about the
          longest word, and for a newsletter built on a fixed table it is
          that table's width. So the two together say whether a mail can
          reflow at all, without anybody having to guess from its markup.

          The bubble's cap reads it: a mail that cannot reflow is given the
          room it needs rather than clipped at three quarters of the pane.
          See `.mail-bubble-column` in mail.css.
        */
        body.style.width = "min-content";
        /*
          Read with every string breakable and every line allowed to wrap,
          so that what is measured is the width of things that have one —
          a table told to be 600px, a picture, a fixed column — and not the
          length of the longest word or the one paragraph a sender set to
          nowrap. Words wrap; that is what the bubble is for.

          A message was scaled down to fit a tracking link, then one from
          Outlook to fit something nobody could point to, and both were
          the same mistake: taking a string for a shape. Ruling strings out
          here, rather than one kind at a time, ends the series. The sheet
          is in the document only while the rect is read.
        */
        const probe = doc.createElement("style");
        probe.textContent =
          "*{overflow-wrap:anywhere!important;white-space:normal!important}";
        (doc.head ?? doc.documentElement).appendChild(probe);
        const narrowestBody = body.getBoundingClientRect().width;
        probe.remove();
        body.style.width = heldWidth;
        const styles = doc.defaultView?.getComputedStyle(body);
        const bodyZoom = parseFloat(body.style.zoom) || 1;
        const rawMargins = styles
          ? (parseFloat(styles.marginLeft) || 0) +
            (parseFloat(styles.marginRight) || 0)
          : 0;
        // Without the zoom in it: the frame multiplies its own size back
        // in, so a change of size needs no new measurement to size it.
        const wanted = Math.ceil(naturalBody / bodyZoom + rawMargins);
        if (wanted > 0) setNaturalWidth(Math.max(wanted, 160));
        /*
          Published without the reader's zoom in it.

          The bubble lays out inside the zoomed stream, so its own pixels
          are the unzoomed ones; the frame's are not, because the frame
          cancels the ancestor zoom and applies it again inside. Dividing
          it out here is what makes the two comparable, and it is the step
          that decides whether this works at any size but 100%.
        */
        const narrowestCss = Math.ceil(narrowestBody / bodyZoom + rawMargins);
        const column = frame?.closest<HTMLElement>(".mail-bubble-column");
        /*
          Whatever the bubble puts around the frame — see
          `chromeAroundFrame`. Asking the column for exactly the mail's
          width left it two pixels short, which is enough for a fixed table
          to overflow and be clipped, and clipping is the whole thing this
          is here to stop. Measured rather than named: it is one pixel
          today, it is not the frame's business, and a number written here
          would stay wrong quietly.
        */
        const chrome =
          frame && column ? chromeAroundFrame(frame, column) : 0;
        if (column && narrowestCss > 0) {
          column.style.setProperty(
            "--mail-bubble-fixed",
            `${Math.ceil(narrowestCss + chrome)}px`
          );
        }
        /*
          And when even the whole pane is not enough, it is scaled to fit
          rather than cut off.

          The cap can only give what the pane has. A narrow window, or a
          reader who has turned the size up, and a mail that cannot reflow
          still does not fit — and the choice then is between showing all
          of it smaller and showing part of it at the asked-for size. Every
          mail client that handles this well picks the first: a newsletter
          half off the right edge is not a smaller problem than a
          newsletter a fifth too small to read comfortably.

          Both sides of it are the bubble's own pixels, and neither is the
          frame's. The frame's width is the wrong thing to measure twice
          over: it is in screen pixels while the mail's width is in the
          bubble's, and it moves when the size below is set — so the first
          go at this compared the two directly, agreed with itself at 100%
          where they happen to be equal, and at 143% shrank, re-measured,
          grew, and flickered between the two for ever.

          What is asked instead is the room the bubble would have at 100%,
          which answers the same whatever size the mail is being shown at.
          `narrowestCss` carries no zoom in it either. Neither side moves
          when the size below is set, so it settles in one pass.

          And because the room is the one at rest, this sets where the mail
          starts rather than where it stops: at 100% it fills the bubble,
          and the reader's own size multiplies on top of that. Past the
          point where it fits, the mail is wider than its bubble and can be
          dragged sideways — the frame keeps `overflow-x:auto` with the bar
          hidden for exactly this, and being able to go on zooming into a
          newsletter matters more than never seeing an edge.
        */
        const room = column
          ? roomAtRest(column, chrome)
          : Number.POSITIVE_INFINITY;
        const base = zoomRef.current;
        const fit =
          room > 0 && narrowestCss > room ? room / narrowestCss : 1;
        /*
          And never wider than the pane, whatever the size asked for.

          The size below starts the mail where it fills the bubble and
          lets the reader's zoom multiply on top. Past the pane's edge
          that used to be a sideways drag with the bar hidden, which read
          as a cut-off newsletter and not as a zoomed one. The pane is
          the ceiling now: the zoom control grows a fixed mail until it
          fills the pane and stops there. The room is read at the size
          shown, in screen pixels, so it is the ceiling as painted.
        */
        const parentReal = column?.parentElement?.getBoundingClientRect().width ?? 0;
        const ceiling =
          parentReal > 0 && narrowestCss > 0
            ? (parentReal - (BUBBLE_GUTTER_PX + chrome) * base) / narrowestCss
            : Number.POSITIVE_INFINITY;
        const applied = Math.min(base * fit, Math.max(ceiling, 0.25));
        setBodyZoom(applied);
        if (Math.abs((parseFloat(body.style.zoom) || 1) - applied) > 0.002) {
          body.style.zoom = String(applied);
          // The height was read at the old size; the observer will answer
          // again now the frame has laid out at this one.
          scheduleMeasureRef.current?.();
        }
      }
    };
    let queued = 0;
    let fallback = 0;
    const scheduleMeasure = () => {
      if (queued) return;
      const run = () => {
        if (queued) cancelAnimationFrame(queued);
        window.clearTimeout(fallback);
        queued = 0;
        fallback = 0;
        // Not a document that has since been swapped out or unmounted.
        if (iframeRef.current?.contentDocument !== doc) return;
        measure();
      };
      queued = requestAnimationFrame(run);
      // A frame that never comes. A webview that is not on screen — the
      // planner's mail pane put away, a window minimised — stops its
      // animation frames, and a measurement queued behind one waited for
      // ever, with every later ask turned away at the door above. A
      // timer runs it instead, and the first of the two to arrive wins.
      fallback = window.setTimeout(run, 300);
      pendingMeasureRef.current = () => {
        if (queued) cancelAnimationFrame(queued);
        window.clearTimeout(fallback);
        queued = 0;
        fallback = 0;
      };
    };
    scheduleMeasureRef.current = scheduleMeasure;

    measure();
    setReady(true);
    scheduleMeasure();
    // Late layout shifts (e.g. images arriving after the reveal) resize the frame.
    observerRef.current?.disconnect();
    if (typeof ResizeObserver !== "undefined") {
      /*
        Not while a pane is sliding. This measurement collapses the frame
        to nothing and reads the content back, twice over, and the reader's
        width changes on every frame of a slide. One reading at the end
        says the same thing.
      */
      const observer = new ResizeObserver(() => {
        if (afterMailPaneSlide(scheduleMeasure)) return;
        scheduleMeasure();
      });
      observer.observe(doc.body);
      observer.observe(doc.documentElement);
      // Not the frame itself. Watching it from the outside was what fed
      // the width back into its own measure — see the latch in `measure`.
      // The pane not having laid out on the first pass is answered there
      // instead, by not recording an answer until there is a frame.
      /*
        The bubble's column is watched, though, and has to be.

        How much room there is decides whether a mail that cannot reflow is
        scaled down, and the room changes when the window or the pane does.
        Without this a mail scaled to fit a narrow pane stayed scaled after
        the pane was widened, because nothing inside the frame had moved
        and so nothing asked again.

        Safe to watch where the frame is not: the column is full-width
        under a ceiling, so it measures the room and never the mail. It is
        an input to the size below, not an answer to it.
      */
      const column = iframeRef.current?.closest<HTMLElement>(
        ".mail-bubble-column"
      );
      if (column) observer.observe(column);
      observerRef.current = observer;
    }
    for (const img of doc.images) {
      if (img.complete) continue;
      img.addEventListener("load", scheduleMeasure, { once: true });
      img.addEventListener("error", scheduleMeasure, { once: true });
    }
    const frameEl = iframeRef.current;
    if (frameEl) attachPinchForwarding(doc, frameEl);
    attachKeyForwarding(doc);
    // In-frame bridge owns link clicks when CSP allowed it to run.
    if (doc.documentElement.getAttribute("data-dh-bridge") !== "1") {
      attachExternalLinkHandling(doc);
    }
    attachDoubleClickForwarding(doc, () => onDblClickRef.current?.());
    attachLinkContextMenu(
      doc,
      ({ target, frameX, frameY }) => {
        const model = mailLinkMenuModel(target);
        const frame = iframeRef.current;
        if (!model || !frame) return;
        /**
         * A point in the frame, in the page's own pixels.
         *
         * Measured rather than worked out from the zoom. The frame is drawn
         * at 1/zoom, its body at zoom, and the whole stream sits in an
         * element at zoom again (see ThreadPane) — so the scale from frame
         * pixels to page pixels is some product of those, and reading the
         * zoom prop got it wrong by exactly that ancestor: at 80% the menu
         * opened a sixth of the frame below the pointer.
         *
         * The frame's rect is its size in page pixels and its own
         * `innerHeight` is that same box in frame pixels. The ratio is the
         * scale, whatever the zooms above it happen to be.
         */
        const box = frame.getBoundingClientRect();
        const view = frame.contentWindow;
        const scaleX =
          view && view.innerWidth > 0 ? box.width / view.innerWidth : 1;
        const scaleY =
          view && view.innerHeight > 0 ? box.height / view.innerHeight : 1;
        setLinkMenu({
          model,
          x: box.left + frameX * scaleX,
          y: box.top + frameY * scaleY,
        });
      },
      dismissLinkMenu
    );
    return true;
  }, [dismissLinkMenu]);

  const handleLoad = React.useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    if (doc) initDoc(doc);
  }, [initDoc]);

  React.useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      pendingMeasureRef.current?.();
      pendingMeasureRef.current = null;
    };
  }, []);

  /**
   * Show the message as soon as the document parses. The iframe `load` event
   * waits for every remote image, which adds seconds to a marketing email —
   * the observer and the per-image handlers above correct the height when the
   * images land.
   */
  React.useEffect(() => {
    if (!srcDoc) return;
    const deadline = Date.now() + 15_000;
    let raf = 0;
    const poll = () => {
      const doc = iframeRef.current?.contentDocument;
      const parsed =
        doc?.body &&
        doc.readyState !== "loading" &&
        doc.documentElement.getAttribute("data-dh-mail") === "1";
      // A false return means this is still the frame we are replacing.
      if (parsed && initDoc(doc)) return;
      if (Date.now() > deadline) return;
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [srcDoc, initDoc]);

  // Zoom changes restyle the already-loaded document; measured rects include
  // zoom, so height follows.
  React.useEffect(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc?.body) return;
    doc.body.style.zoom = String(zoom);
    // The frame follows at once; the measurement refines it to the size
    // that fits, which is this one unless the pane is narrower.
    setBodyZoom(zoom);
    /*
      Measured again once the frame has laid out at the new size — reading
      the rect in the same tick as the zoom hands back the geometry from
      before it, and the words would no longer fit the height.
    */
    // Through the queue: a pinch lands tens of these a second, and each one
    // measuring on the spot is what made the zoom lag the fingers.
    scheduleMeasureRef.current?.();
  }, [zoom]);

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
        sandbox="allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        onLoad={handleLoad}
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
            gutter along the foot and the right edge of every card — a
            light rule under the words, from the one part of the frame the
            recolour cannot reach.
          */
          colorScheme: darkRecolor ? "dark" : "light",
          zoom: 1 / zoom,
        }}
      />
      {linkMenu ? (
        <LinkContextMenu
          model={linkMenu.model}
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
