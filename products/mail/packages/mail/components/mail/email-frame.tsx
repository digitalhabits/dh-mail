"use client";

/*
 * The frame a message is drawn in: the document it is given, the link it
 * asks the page to follow, and the right-click menu on a link.
 *
 * The frame has an opaque origin, so the page cannot read it. What the page
 * needs from it comes through the frame's own script (`lib/mail/link-bridge`)
 * as postMessage. EmailHtmlView.tsx makes the frame and reads the messages.
 */

import * as React from "react";
import { createPortal } from "react-dom";
import { Copy, Download, ExternalLink, Image as ImageIcon, Mail } from "lucide-react";
import { copyImage, downloadImage } from "@/lib/mail/image-menu";
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
import { frameImageOrigin } from "@/lib/mail/frame-messages";
import { repairSafeLink } from "@/lib/safe-links";
import { MAIL_HREF_ATTR, MAIL_PLAIN_LINK_ATTR } from "@/lib/mail/soften-anchors";

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
  /*
    Here, where every click ends: the frame's own script (link-bridge.ts)
    sends the link as the sender wrote it. If a safe link is unwrapped
    anywhere else, a click still opens it as it is. Copy link then gives
    the real address while a click gets Microsoft's "Bad Request".
  */
  const ok = await openExternalUrl(repairSafeLink(target));
  if (!ok) toast.error(mailSay("couldNotOpenLink"));
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
  //
  // The frame has an opaque origin, and in some engines 'self' then matches
  // nothing. So the page's origin is also named, for the image proxy.
  const imgSrc = allowImages
    ? `img-src ${MAIL_IMAGE_CSP_SOURCE} ${frameImageOrigin(origin)} data:;`
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
      thread does the scrolling. A bar inside a message is a bar drawn
      across the foot and up the right of every card. These are two pale
      rules that no colour of ours can reach, because the platform paints
      a scrollbar.

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
      tracking link three hundred characters long measures as three
      hundred characters wide. The bubble gets that width and the pane
      cannot, so the whole message is scaled down to fit the link. The
      result is a body of tiny text that no zoom can enlarge, because the
      zoom is cancelled to fit the same link. `anywhere` counts the break,
      so the link does not set the message's width. Only on links: the
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
    // `recolorForDark` in the frame script (frame-script/dark.ts). A
    // blanket "everything inherits" throws away a heading's navy and a
    // call-out's pink along with the black.
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
  image,
  x,
  y,
  onDismiss,
}: {
  /** The link, or null for a picture that is not a link. */
  model: MailLinkMenuModel | null;
  /** The picture right-clicked, when there is one: its `src`. */
  image?: string;
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

  const OpenIcon = model?.kind === "mailto" ? Mail : ExternalLink;
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
      className="mail-light-surface fixed z-50 w-max max-w-[min(28rem,calc(100vw-1rem))] rounded-surface border border-stone-200 bg-white py-1 shadow-lg"
    >
      {model ? (
        <>
      <div
        className="truncate px-3 pb-1.5 pt-1 text-xs text-stone-500"
        title={model.realAddress ?? model.target}
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
      {model.realAddress ? (
        <button
          type="button"
          role="menuitem"
          className={item}
          onClick={() => {
            onDismiss();
            void copyText(model.realAddress ?? "").then((ok) => {
              if (ok) toast("Address copied");
              else toast.error(mailSay("couldNotCopy"));
            });
          }}
        >
          <Copy className="h-3.5 w-3.5 shrink-0 text-stone-500" aria-hidden />
          Copy real address
        </button>
      ) : null}
        </>
      ) : null}
      {image ? (
        <>
          {model ? <div className="my-1 border-t border-stone-200" /> : null}
          <button
            type="button"
            role="menuitem"
            autoFocus={!model}
            className={item}
            onClick={() => {
              onDismiss();
              void copyImage(image).then((ok) => {
                if (ok) toast(t("imageCopied"));
                else toast.error(mailSay("couldNotCopy"));
              });
            }}
          >
            <ImageIcon className="h-3.5 w-3.5 shrink-0 text-stone-500" aria-hidden />
            {t("copyImage")}
          </button>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              onDismiss();
              void downloadImage(image).catch((err: unknown) =>
                toast.error(err instanceof Error ? err.message : String(err))
              );
            }}
          >
            <Download className="h-3.5 w-3.5 shrink-0 text-stone-500" aria-hidden />
            {t("downloadImage")}
          </button>
        </>
      ) : null}
    </div>,
    document.body
  );
}
