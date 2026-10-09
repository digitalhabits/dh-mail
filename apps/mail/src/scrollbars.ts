/**
 * Scrollbars that show while you scroll, and then go — the Windows window
 * only.
 *
 * WKWebView draws the system's overlay scrollbars: they lie over the content
 * and fade away when nothing is moving. WebView2 is Chromium, and draws the
 * classic kind, which stands there for as long as there is anything to
 * scroll. `standalone.css` paints those transparent; this says when to bring
 * one back.
 *
 * It marks the element that scrolled, and unmarks it a moment after the
 * scrolling stops. Hovering was tried first and is not the same thing: the
 * pointer rests inside the thread list for as long as the reader is reading
 * it, so a bar shown under the pointer is a bar shown always, which is the
 * complaint this started from.
 *
 * `scroll` does not bubble, so the listener is a capturing one on the
 * document and catches every scroller in the page, including any drawn into
 * a portal outside the mail shell.
 */

/** How long a bar stays after the last movement. */
const REST_MS = 900;

const ATTR = "data-dh-scrolling";

export function showScrollbarsWhileScrolling(): void {
  if (document.documentElement.dataset.dhOs !== "windows") return;

  const timers = new WeakMap<Element, number>();

  document.addEventListener(
    "scroll",
    (event) => {
      const el = event.target;
      // The document itself scrolls too, and is not an Element.
      if (!(el instanceof Element)) return;

      // Only on the way in. Setting an attribute it already carries is a
      // style invalidation per scroll event, and a scroll is many events.
      if (!el.hasAttribute(ATTR)) el.setAttribute(ATTR, "");

      const running = timers.get(el);
      if (running !== undefined) window.clearTimeout(running);
      timers.set(
        el,
        window.setTimeout(() => {
          el.removeAttribute(ATTR);
          timers.delete(el);
        }, REST_MS)
      );
    },
    { capture: true, passive: true }
  );
}
