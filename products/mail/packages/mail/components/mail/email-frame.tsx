"use client";

/*
 * The frame a message is drawn in: the document it is given, its height,
 * and what it passes back to the page: pinch and keys, a double click, a
 * link followed, and the right-click menu on a link.
 *
 * EmailHtmlView.tsx makes the frame and calls these on it.
 */

import * as React from "react";
import {
  MAIL_PINCH_SCALE_EVENT,
  MAIL_PINCH_WHEEL_EVENT,
} from "@/lib/mail/pinch";
import { createPortal } from "react-dom";
import { Copy, ExternalLink, Mail } from "lucide-react";
import { toast } from "@/lib/mail/toast";
import {
  MAIL_IMAGE_CSP_SOURCE,
  rewriteRemoteImagesThroughProxy,
} from "@/lib/mail/image-proxy";
import { openExternalUrl } from "@/lib/native-shell";
import { requestMailComposeTo } from "@/lib/mail/compose-to";
import { mailSay, useMailT } from "@/lib/mail/i18n";
import { type MailLinkMenuModel } from "@/lib/mail/link-menu";
import {
  MAIL_LINK_BRIDGE_CSP_HASH,
  MAIL_LINK_BRIDGE_JS,
} from "@/lib/mail/link-bridge";
import { MAIL_HREF_ATTR, MAIL_PLAIN_LINK_ATTR } from "@/lib/mail/soften-anchors";
import { asElement } from "@/lib/mail/email-html";

/** postMessage payload from the srcdoc click bridge. */
export const MAIL_OPEN_MSG_SOURCE = "dh-mail";
export const MAIL_OPEN_MSG_TYPE = "open-url";

/**
 * Follow a link from a message.
 *
 * An address opens our own composer, not whatever mail client the machine
 * would otherwise start. This app is the mail client.
 */
export async function followMailLink(target: string): Promise<void> {
  if (/^mailto:/i.test(target)) {
    // A mailto can carry ?subject=… and more. Only the address is taken.
    const address = target.slice("mailto:".length).split("?")[0];
    requestMailComposeTo(decodeURIComponent(address));
    return;
  }
  const ok = await openExternalUrl(target);
  if (!ok) toast.error(mailSay("couldNotOpenLink"));
}

/**
 * Resolve what a link points at: an http(s) URL, or a `mailto:` address.
 *
 * Works on an <a href> and on a softened mail link span alike.
 */
function linkTargetFromEl(el: Element): string | null {
  const raw = (
    el.getAttribute("href") ||
    el.getAttribute(MAIL_HREF_ATTR) ||
    ""
  ).trim();
  if (!raw || raw.startsWith("#")) return null;
  if (/^mailto:/i.test(raw)) return raw;
  // about:srcdoc is a useless base for relative URLs — use the parent origin.
  const base =
    !el.baseURI || el.baseURI === "about:srcdoc"
      ? window.location.href
      : el.baseURI;
  try {
    const abs = new URL(raw, base).href;
    if (/^https?:/i.test(abs)) return abs;
  } catch {
    /* ignore invalid */
  }
  if (el.tagName === "A") {
    const href = (el as HTMLAnchorElement).href;
    return href && /^https?:/i.test(href) ? href : null;
  }
  return null;
}

export function buildSrcDoc(
  sanitized: string,
  allowImages: boolean,
  origin: string,
  imageMaxHeight?: number,
  bodyColor?: string,
  frameCss?: string
): string {
  // Remote images are rewritten to the same-origin proxy when allowed, so the
  // iframe never hits CORP/hotlink blocks on the sender's CDN. data: (cid)
  // images stay inlined and always allowed.
  const body = allowImages
    ? rewriteRemoteImagesThroughProxy(sanitized, origin)
    : sanitized;
  // allow-scripts is only for MAIL_LINK_BRIDGE_JS (hash-pinned). Email HTML is
  // sanitized and still cannot load remote scripts (default-src 'none').
  const imgSrc = allowImages
    ? `img-src ${MAIL_IMAGE_CSP_SOURCE} data:;`
    : "img-src data:;";
  const csp = `default-src 'none'; ${imgSrc} style-src 'unsafe-inline'; script-src '${MAIL_LINK_BRIDGE_CSP_HASH}'`;
  return [
    // data-dh-mail marks our document, so the reader can tell the new frame
    // from the one it replaces while srcDoc swaps.
    '<!doctype html><html data-dh-mail="1"><head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    '<meta name="referrer" content="no-referrer">',
    '<base target="_blank">',
    "<style>",
    // Prefer auto height (thread pane scrolls). Keep overflow-y auto as a
    // fallback if measurement still undershoots a marketing footer.
    /*
      No scrollbars in here. The frame is sized to its content and the
      thread does the scrolling; a bar inside a message is a bar drawn
      across the foot and up the right of every card, which is what it was
      — two pale rules that no colour of ours could reach, because a
      scrollbar is painted by the platform.

      `overflow-x:auto` stays for a table wider than the pane, but its bar
      is hidden too: it can be dragged sideways with a trackpad, and a
      permanent gutter costs every message to serve the few that are wide.
    */
    "html,body{margin:0;overflow-x:auto;overflow-y:hidden;scrollbar-width:none}",
    "html::-webkit-scrollbar,body::-webkit-scrollbar{width:0;height:0;display:none}",
    ...(bodyColor ? ["html{color-scheme:dark}"] : []),
    /*
      `overflow-wrap`, not `word-break:break-word`.

      They read as the same wish — do not let one long unbreakable string
      run off the side — and they are not. `word-break:break-word` is the
      deprecated spelling of `overflow-wrap:anywhere`, and `anywhere` counts
      towards how narrow a box may be squeezed: a table column may then be
      one letter wide. A mail from GitHub laid out as a table came through
      with its Status heading spelled down the page, one letter per line,
      because the column had been allowed to shrink that far.

      `overflow-wrap:break-word` breaks the same long string, and leaves a
      column's natural minimum alone. Measured on a table three columns
      wide in a 150px box: the heading kept 53px and one line under this
      rule, and was cut to 37px and two lines under the other.
    */
    `body{padding:12px 14px 20px;font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${bodyColor ?? "#292524"};overflow-wrap:break-word;background:transparent}`,
    /*
      Links may break anywhere, and only links.

      `break-word` above breaks a long string when it is drawn but does not
      count the break when the box is measured, so a message with a
      tracking link three hundred characters long measured as three
      hundred characters wide. The bubble was given that width, the pane
      could not, and the whole message was scaled down to fit the link —
      a body of tiny text that no zoom could enlarge, because the zoom was
      being cancelled to fit the same link. `anywhere` counts the break,
      so the link no longer sets the message's width. Only on links: the
      table-column reason above still holds for everything else, and a
      string that long in ordinary text is rare.

      A link in a message is not an <a> by the time it is drawn: every one
      is softened to a span before the parser sees it (see soften-anchors),
      so the rule has to name the span. Written for <a> alone it matched
      nothing, and a message from a Windows Live Mail sender with one long
      Google link measured 1383px at its narrowest — and was scaled down to
      fit it, at every zoom. With the span named it measures 428px.
    */
    `a,[${MAIL_HREF_ATTR}]{overflow-wrap:anywhere}`,
    "img{max-width:100%;height:auto}",
    // A view with a ceiling of its own — the peek at the first message —
    // asks for a ceiling on the pictures too. A screenshot pasted into an
    // issue is a few hundred pixels wide and a thousand tall, and at full
    // height it is the whole of a short view with none of the words.
    ...(imageMaxHeight
      ? [`img{max-height:${imageMaxHeight}px;width:auto;object-fit:contain}`]
      : []),
    // Softened mail CTAs (see softenAnchorsForParse) — keep button styling.
    `[${MAIL_HREF_ATTR}]{cursor:pointer;color:inherit;text-decoration:inherit}`,
    /*
      A link should look like one.

      Two kinds reach this point unstyled. The bare addresses we found in
      the text ourselves, which are still real anchors — every link the
      sender wrote became a span above, so `a` can only be ours. And the
      ones the sender wrote but never dressed, marked while softening.

      Both get the teal the rest of the app underlines a link in, and
      neither can reach a sender's button: that keeps whatever it was
      given. After the rule above, so it wins on equal specificity.
    */
    `a,[${MAIL_PLAIN_LINK_ATTR}]{color:${
      bodyColor ? "#5ecfbe" : "#0d7a6f"
    };text-decoration:underline;text-underline-offset:2px}`,
    // Reading in the dark: the body's own colour is the light one the
    // caller passes, and every colour the sender declared is re-lit by
    // `recolorEmailForDark` once the frame has laid out — see there. That
    // used to be a blanket "everything inherits", which threw away a
    // heading's navy and a call-out's pink along with the black.
    /*
      And last, whatever the caller draws this frame into.

      The thread pane passes nothing: a message there is read on a card
      built around it. The send preview passes a page, because its frame
      stands inside a card that already has a size, a face and a colour,
      and the mail in it must go on looking the way it looked when the
      same markup sat in the page itself. Last in the list, so a rule here
      wins against the one above it on equal specificity.
    */
    ...(frameCss ? [frameCss] : []),
    "</style>",
    "</head><body>",
    body,
    `<script>${MAIL_LINK_BRIDGE_JS}</script>`,
    "</body></html>",
  ].join("");
}

/**
 * Frame height for auto-sized email iframes.
 * `body.getBoundingClientRect().height` alone drops trailing margins on
 * marketing footers (Outlook tables), which clips the last few pixels.
 */
/**
 * The scrolling box a frame sits in — the thread stream, usually.
 *
 * Measuring collapses the frame for a moment (see `measure`), and a
 * collapsed frame is a shorter thread. The browser clamps the scroll to a
 * shorter thread at once and does not put it back when the height returns,
 * so the measurement has to hold the place itself.
 */
export function scrollParentOf(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node) {
    const overflow = window.getComputedStyle(node).overflowY;
    if (
      (overflow === "auto" || overflow === "scroll") &&
      node.scrollHeight > node.clientHeight
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

export function measureEmailFrameHeight(doc: Document): number {
  const body = doc.body;
  if (!body) return 0;
  const win = doc.defaultView;
  const bodyTop = body.getBoundingClientRect().top;
  let bottom = body.getBoundingClientRect().bottom;

  const include = (el: Element) => {
    const rect = el.getBoundingClientRect();
    const marginBottom = win
      ? parseFloat(win.getComputedStyle(el).marginBottom) || 0
      : 0;
    bottom = Math.max(bottom, rect.bottom + marginBottom);
  };

  for (const child of body.children) include(child);

  // Nested trailing margins (table > tbody > tr > td > …).
  let el: Element | null = body.lastElementChild;
  while (el) {
    include(el);
    el = el.lastElementChild;
  }

  /*
    And whatever the frame says it can scroll.

    The rect walk above measures boxes; `scrollHeight` measures the whole
    of what is laid out, and it is the exact quantity that decides whether
    a scrollbar appears. Taking the larger of the two is what keeps one
    from appearing: the rect walk catches trailing margins that
    scrollHeight rounds off, and scrollHeight catches everything the rect
    walk cannot see.

    The two are not read in the same units. The reader's size is a `zoom`
    on the body, and `scrollHeight` on a zoomed element answers in that
    element's own scale, while everything else here — the rects, the root,
    the frame being sized — is in the frame's. Below 100% the body's
    unscaled number is the larger of the two while being the shorter
    distance, so it won every comparison and the frame came out as much
    too tall as the reader had zoomed out: at 80%, a quarter of the
    message again in empty space under the footer. At 100% the two agree,
    which is why it only ever showed on one side of it.
  */
  const bodyZoom = parseFloat(body.style.zoom) || 1;
  const scrolled = Math.max(
    doc.documentElement?.scrollHeight ?? 0,
    (body.scrollHeight ?? 0) * bodyZoom
  );

  const content = Math.max(bottom - bodyTop, scrolled);
  /*
    Nothing measured is not a short message.

    A frame asked for its height before it has laid out answers zero, and
    zero plus the slack below is six — small enough to look like a bug and
    large enough to pass the `> 0` test that was meant to catch exactly
    this. So the caller keeps the height it had and waits for the observer.
  */
  if (content <= 0) return 0;

  // Slack for sub-pixels and collapsed margins so the footer never clips.
  return Math.ceil(content + 6);
}

/**
 * Pinches over the sandboxed iframe never reach the thread pane's listeners,
 * so forward them to the parent window (as raw wheel deltas / scale ratios)
 * for the mail zoom to consume. Listeners run in the parent context — the
 * iframe itself stays script-free.
 */
export function attachPinchForwarding(doc: Document, frame: HTMLIFrameElement) {
  /*
    Where the fingers are, in the parent's pixels.

    The zoom holds the point under the pointer still, and the pointer is in
    here, so the point has to travel with the gesture. The frame is sized to
    its own content, so a y down the frame's viewport is the same fraction
    of the frame element in the parent, whatever either one is zoomed by.
  */
  const parentY = (frameY: number): number | null => {
    const box = frame.getBoundingClientRect();
    const viewport = doc.defaultView?.innerHeight || 0;
    if (!viewport || !box.height) return null;
    return box.top + (frameY / viewport) * box.height;
  };

  const wheelOpts: AddEventListenerOptions = { passive: false, capture: true };
  doc.addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey) return; // plain scrolling, not a pinch
      e.preventDefault();
      window.dispatchEvent(
        new CustomEvent(MAIL_PINCH_WHEEL_EVENT, {
          detail: { value: e.deltaY, y: parentY(e.clientY) },
        })
      );
    },
    wheelOpts
  );

  // WebKit (Safari, the Mac app's webview) reports pinches as gesture events.
  let lastScale = 1;
  const gestureOpts: AddEventListenerOptions = { capture: true, passive: false };
  doc.addEventListener(
    "gesturestart",
    ((e: Event) => {
      e.preventDefault();
      lastScale = (e as Event & { scale?: number }).scale ?? 1;
    }) as EventListener,
    gestureOpts
  );
  doc.addEventListener(
    "gesturechange",
    ((e: Event) => {
      e.preventDefault();
      const scale = (e as Event & { scale?: number }).scale ?? 1;
      if (lastScale > 0) {
        const at = (e as Event & { clientY?: number }).clientY;
        window.dispatchEvent(
          new CustomEvent(MAIL_PINCH_SCALE_EVENT, {
            detail: {
              value: scale / lastScale,
              y: typeof at === "number" ? parentY(at) : null,
            },
          })
        );
      }
      lastScale = scale;
    }) as EventListener,
    gestureOpts
  );
}

/**
 * Keystrokes inside the iframe reach the app's shortcuts.
 *
 * The shortcut listeners live on the top window, and a click on the email
 * body gives the iframe's document the keyboard — after which every key
 * fires in here and the app hears nothing. WebKit is also reluctant to
 * hand focus back when the next click lands on something in the parent
 * that is not focusable, so the dead zone was bigger than the message.
 *
 * The keys are re-dispatched on the parent window as synthetic keyboard
 * events, the same bridge the pinch uses. A synthetic event cannot cancel
 * what the key does inside the iframe, and should not: copy, arrows and
 * text selection keep their meanings — the app's own guard ignores keys
 * typed into fields, and a field inside a message is left alone here too.
 */
export function attachKeyForwarding(doc: Document) {
  doc.addEventListener(
    "keydown",
    (e) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) {
        return;
      }
      const consumed = !window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: e.key,
          code: e.code,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          altKey: e.altKey,
          shiftKey: e.shiftKey,
          repeat: e.repeat,
          cancelable: true,
        })
      );
      // The app took the key, so its default in here must not also run —
      // some shortcuts ride keys the webview has plans for (Cmd+R would
      // reload the whole app on top of opening the reply). dispatchEvent
      // runs the parent's listeners synchronously and reports whether one
      // of them called preventDefault, so the answer is already in hand.
      if (consumed) e.preventDefault();
    },
    { capture: true }
  );
}

/**
 * Meet / RSVP / etc. in invite HTML are normal <a> tags. Tauri's WebView
 * silently drops target=_blank navigations that originate inside an iframe,
 * and the shell's document-level click hook never sees iframe clicks — so
 * open http(s) links from the parent via the opener plugin (or window.open).
 */
export function attachExternalLinkHandling(doc: Document) {
  // Backup when the in-frame bridge is blocked; WKWebView often skips this.
  doc.addEventListener(
    "click",
    (event) => {
      // composedPath survives nested SVG/table quirks better than closest alone.
      const path = event.composedPath();
      let el: Element | null = null;
      for (const node of path) {
        const candidate = asElement(node);
        if (!candidate) continue;
        if (candidate.tagName === "A" && candidate.hasAttribute("href")) {
          el = candidate;
          break;
        }
        if (candidate.hasAttribute(MAIL_HREF_ATTR)) {
          el = candidate;
          break;
        }
      }
      if (!el) {
        const target = asElement(event.target);
        el = target?.closest(`a[href], [${MAIL_HREF_ATTR}]`) ?? null;
      }
      if (!el) return;
      const target = linkTargetFromEl(el);
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      void followMailLink(target);
    },
    true
  );
}

/** A right-click on a link, in the frame's own coordinates. */
type LinkMenuRequest = {
  target: string;
  /** Pointer position in the frame's viewport, before the frame's zoom. */
  frameX: number;
  frameY: number;
};

/**
 * The right-click menu on a link.
 *
 * Every link in the frame is a span (see `softenAnchorsForParse`), so the
 * browser's own menu treats it as text: Look Up, Translate, Search — and no
 * Copy Link, which is the one thing a reader right-clicks a link for. So the
 * frame takes the event over on links, and only there. Right-click on plain
 * text keeps the browser's menu, which is good and which nothing here would
 * improve on.
 *
 * A link inside a selection the reader made is treated as text too: they
 * selected it, so the selection is what they mean. That is decided on
 * mousedown, because WebKit selects the word under a right-click before it
 * fires `contextmenu`, and by then every link looks selected. The same
 * snapshot puts the selection back the way it was once the menu is ours, so
 * the word does not stay highlighted under it.
 */
export function attachLinkContextMenu(
  doc: Document,
  onRequest: (request: LinkMenuRequest) => void,
  onDismiss: () => void
) {
  const linkFromEvent = (event: Event): Element | null => {
    for (const node of event.composedPath()) {
      const candidate = asElement(node);
      if (!candidate) continue;
      if (candidate.tagName === "A" && candidate.hasAttribute("href")) {
        return candidate;
      }
      if (candidate.hasAttribute(MAIL_HREF_ATTR)) return candidate;
    }
    const target = asElement(event.target);
    return target?.closest(`a[href], [${MAIL_HREF_ATTR}]`) ?? null;
  };

  let selectionBefore: Range[] = [];
  let linkWasSelected = false;

  doc.addEventListener(
    "mousedown",
    (event) => {
      // Any press closes a menu that is open; a right-click on a link opens
      // a new one a moment later, through `contextmenu`.
      onDismiss();
      const secondary =
        event.button === 2 || (event.button === 0 && event.ctrlKey);
      if (!secondary) return;
      const sel = doc.getSelection();
      selectionBefore = [];
      linkWasSelected = false;
      if (!sel || sel.isCollapsed) return;
      for (let i = 0; i < sel.rangeCount; i += 1) {
        selectionBefore.push(sel.getRangeAt(i).cloneRange());
      }
      const link = linkFromEvent(event);
      if (link) {
        linkWasSelected = selectionBefore.some((range) =>
          range.intersectsNode(link)
        );
      }
    },
    true
  );

  doc.addEventListener("scroll", onDismiss, true);
  doc.addEventListener("wheel", onDismiss, { capture: true, passive: true });

  doc.addEventListener(
    "contextmenu",
    (event) => {
      const link = linkFromEvent(event);
      if (!link || linkWasSelected) return;
      const target = linkTargetFromEl(link);
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      // The word WebKit selected under the pointer goes back to whatever was
      // selected before, which is usually nothing.
      const sel = doc.getSelection();
      if (sel) {
        sel.removeAllRanges();
        for (const range of selectionBefore) sel.addRange(range);
      }
      onRequest({ target, frameX: event.clientX, frameY: event.clientY });
    },
    true
  );
}

/** Put text on the clipboard, one way or another. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* fall through to the old way */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * The menu itself, in the page over the frame.
 *
 * Placed at the pointer and clamped to the window, like the folder menu in
 * the rail. The destination is the first row and is not a button: it is
 * there to be read. People right-click a link partly to see where it really
 * goes, and a mail client that softens every anchor owes them that.
 */
export function LinkContextMenu({
  model,
  x,
  y,
  onDismiss,
}: {
  model: MailLinkMenuModel;
  x: number;
  y: number;
  onDismiss: () => void;
}) {
  const t = useMailT();
  const ref = React.useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = React.useState({ left: x, top: y });

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    setPlaced({
      left: Math.max(8, Math.min(x, window.innerWidth - box.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - box.height - 8)),
    });
  }, [x, y]);

  React.useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (ref.current?.contains(event.target as Node)) return;
      onDismiss();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onDismiss, true);
    window.addEventListener("blur", onDismiss);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onDismiss, true);
      window.removeEventListener("blur", onDismiss);
    };
  }, [onDismiss]);

  const OpenIcon = model.kind === "mailto" ? Mail : ExternalLink;
  const item =
    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-stone-800 hover:bg-stone-100";

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={t("link")}
      style={{ left: placed.left, top: placed.top }}
      /* Portalled, so its events travel up the React tree rather than the
         DOM: without this a click in here reaches the message view around
         it, whose double-click opens the thread in a window. */
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      className="mail-light-surface fixed z-50 w-max max-w-[min(28rem,calc(100vw-1rem))] rounded-lg border border-stone-200 bg-white py-1 shadow-lg"
    >
      <div
        className="truncate px-3 pb-1.5 pt-1 text-xs text-stone-500"
        title={model.target}
      >
        {model.shown}
      </div>
      <div className="mb-1 border-t border-stone-200" />
      <button
        type="button"
        role="menuitem"
        autoFocus
        className={item}
        onClick={() => {
          onDismiss();
          void followMailLink(model.target);
        }}
      >
        <OpenIcon className="h-3.5 w-3.5 shrink-0 text-stone-500" aria-hidden />
        {model.openLabel}
      </button>
      <button
        type="button"
        role="menuitem"
        className={item}
        onClick={() => {
          onDismiss();
          void copyText(model.copyText).then((ok) => {
            if (ok) toast(model.kind === "mailto" ? "Address copied" : "Link copied");
            else toast.error(mailSay("couldNotCopy"));
          });
        }}
      >
        <Copy className="h-3.5 w-3.5 shrink-0 text-stone-500" aria-hidden />
        {model.copyLabel}
      </button>
    </div>,
    document.body
  );
}

/**
 * A double-click on the sender's page, forwarded out of the frame.
 *
 * The bubble shows its details when it is double-clicked, and the body of
 * an HTML message is a frame, so a double-click on the words, which is
 * most of the bubble, never reaches the handler outside it. This carries
 * it out. Double-clicks inside the sandboxed iframe never bubble to React
 * parents, and WebKit/Tauri is also flaky with dblclick on srcdoc frames,
 * so a second click within a short window counts as well as the native
 * dblclick event.
 *
 * Not on something that does its own job: a link, a button, a field the
 * sender put there. `instanceof Element` is no use for that test, the
 * frame is a separate global, so `asElement` does the narrowing.
 */
export function attachDoubleClickForwarding(
  doc: Document,
  onDoubleClick: () => void
) {
  const INTERACTIVE =
    `a[href], [${MAIL_HREF_ATTR}], button, input, select, textarea, label,` +
    ` [role='button'], [role='link'], [contenteditable='true']`;
  let lastClickAt = 0;
  let lastFireAt = 0;
  const isControl = (event: Event) =>
    Boolean(asElement(event.target)?.closest(INTERACTIVE));
  const fire = (event: Event) => {
    if (isControl(event)) return;
    const now = Date.now();
    // Click-pair detector and native dblclick often both fire — only once.
    if (now - lastFireAt < 400) return;
    lastFireAt = now;
    lastClickAt = 0;
    event.preventDefault();
    onDoubleClick();
  };
  doc.addEventListener(
    "click",
    (event) => {
      if (isControl(event)) {
        lastClickAt = 0;
        return;
      }
      const now = Date.now();
      if (now - lastClickAt < 400) {
        fire(event);
        return;
      }
      lastClickAt = now;
    },
    true
  );
  doc.addEventListener("dblclick", fire, true);
}
