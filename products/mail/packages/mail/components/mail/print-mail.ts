"use client";

/**
 * Printing a thread, or one message in it.
 *
 * The page cannot print itself: `window.print()` on the app would paginate the
 * list, the chrome, and the composer. So a document of its own is built — see
 * `print-document.ts` — and then printed one of two ways.
 *
 * In a browser it goes in an off-screen iframe, and that frame prints. The
 * frame is not sandboxed, because a sandbox without `allow-modals` refuses
 * `print()`. What replaces it is a stricter CSP than the reading frame uses:
 * that one names a script hash for its link bridge, and this one names no
 * `script-src` at all, so nothing runs even if the sanitizer missed something.
 *
 * In the Mac desktop app the same document goes to the shell instead.
 * WKWebView answers `window.print()` by doing nothing at all — it loads the
 * frame, it returns from the call, and `beforeprint` never fires. Printing on
 * macOS belongs to the app, not to the web view. See
 * `products/mail/crates/mail-native/src/printing.rs`.
 *
 * The Windows app is a third case that needs no third path. WebView2 prints an
 * iframe the way a browser does, so that shell carries no print command, and
 * the browser path above is what runs.
 */

import { toast } from "@/lib/mail/toast";
import { mailSay } from "@/lib/mail/i18n-strings";

import { sanitizeEmailHtml } from "@/lib/mail/email-html";
import {
  buildPrintDocument,
  type PrintMailInput,
} from "@/components/mail/print-document";
import { isNativeShell, printNativeDocument } from "@/lib/native-shell";

export type { PrintableMessage, PrintMailInput } from "@/components/mail/print-document";

const PRINT_FRAME_ID = "mail-print-frame";

/** Give a slow remote image this long, then print what has arrived. */
const IMAGE_SETTLE_MS = 3000;

/** Drop the frame if `afterprint` never arrives (some engines do not fire it). */
const FRAME_CLEANUP_MS = 60_000;

/** Resolve once every image has loaded or failed, or once the wait is up. */
function settleImages(doc: Document): Promise<void> {
  const pending = [...doc.images].filter((image) => !image.complete);
  if (!pending.length) return Promise.resolve();
  return new Promise((resolve) => {
    let left = pending.length;
    const step = () => {
      left -= 1;
      if (left <= 0) resolve();
    };
    for (const image of pending) {
      image.addEventListener("load", step, { once: true });
      image.addEventListener("error", step, { once: true });
    }
    window.setTimeout(resolve, IMAGE_SETTLE_MS);
  });
}

/**
 * Print the given messages. One message prints one message; a whole thread
 * passes them all, oldest first.
 */
export function printMailMessages(input: PrintMailInput): void {
  if (typeof document === "undefined") return;
  if (!input.messages.length) return;

  const html = buildPrintDocument(
    input,
    window.location.origin,
    sanitizeEmailHtml
  );

  if (isNativeShell()) {
    void printNativeDocument(html)
      .then((printed) => {
        // False means this shell has no print panel of its own — Windows.
        if (!printed) printInFrame(html);
      })
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : mailSay("couldNotPrint"));
      });
    return;
  }

  printInFrame(html);
}

/**
 * Print a built document through an off-screen frame, the way a browser does.
 *
 * This is the whole print path in a browser, and the fallback in a shell whose
 * web view prints for itself.
 */
function printInFrame(html: string): void {
  // A second print before the first frame is gone would print the old one.
  document.getElementById(PRINT_FRAME_ID)?.remove();

  const frame = document.createElement("iframe");
  frame.id = PRINT_FRAME_ID;
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("tabindex", "-1");
  // Off-screen with a real box, not `display:none`. A frame with no box does
  // not lay out, and prints blank.
  frame.style.cssText =
    "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none;";

  frame.addEventListener("load", () => {
    const win = frame.contentWindow;
    if (!win) {
      frame.remove();
      return;
    }
    void settleImages(win.document).then(() => {
      let removed = false;
      const drop = () => {
        if (removed) return;
        removed = true;
        frame.remove();
      };
      win.addEventListener("afterprint", drop, { once: true });
      window.setTimeout(drop, FRAME_CLEANUP_MS);
      win.focus();
      win.print();
    });
  });

  frame.srcdoc = html;
  document.body.appendChild(frame);
}
