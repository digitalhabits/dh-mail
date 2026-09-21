"use client";

/**
 * The app-wide size, as a React value, and the one place it is applied.
 *
 * Separate from `ui-scale.ts` because that one is read by a test, and a
 * test cannot import React.
 */

import * as React from "react";

import { tauriInvoke } from "@/lib/mail/store/tauri";
import {
  MAIL_UI_SCALE_EVENT,
  readUiScale,
  writeUiScale,
} from "@/lib/mail/ui-scale";

let cached: number | null = null;

export function useUiScale(): [number, (value: number) => void] {
  const scale = React.useSyncExternalStore(
    (onChange) => {
      const listener = () => {
        cached = null;
        onChange();
      };
      window.addEventListener(MAIL_UI_SCALE_EVENT, listener);
      window.addEventListener("storage", listener);
      return () => {
        window.removeEventListener(MAIL_UI_SCALE_EVENT, listener);
        window.removeEventListener("storage", listener);
      };
    },
    () => (cached ??= readUiScale()),
    // The server draws at 100%: localStorage is the reader's machine, and
    // a first paint at the wrong size then jumping is worse than a beat.
    () => 1
  );
  return [scale, writeUiScale];
}

/**
 * Draw the whole app at the reader's size.
 *
 * Two ways, and which one is not a matter of taste.
 *
 * In the desktop app the webview has a page zoom of its own — the same
 * thing Cmd-+ does in Safari — and that is what is used. The browser
 * rescales the CSS pixel itself, so `100vh` is still the window, a menu's
 * position is still where its button is, and nothing in the app has to know
 * the number. The first version of this used CSS `zoom` on the document
 * instead, and it looked right at a glance and was wrong in two ways at
 * once: the shell was told to be `100vh` tall, which zoom does not scale,
 * so at 120% it hung a fifth below the sill; and every popover was placed
 * by a library that measured in one pixel space and painted in another, so
 * the settings panel opened to the right of its button and its foot was
 * off the screen. What each engine returns under CSS zoom differs, and
 * there is no version of the arithmetic that is right in all of them.
 *
 * In a browser — the demo, the planner's mail page — there is no page zoom
 * to ask for, so CSS zoom is what there is, with the height corrected by
 * hand. Menus there may sit a little off at sizes other than 100%. A reader
 * in a browser has Cmd-+, which is the real thing.
 */
export function useApplyUiScale(scale: number): void {
  React.useEffect(() => {
    const invoke = tauriInvoke();
    const root = document.documentElement;

    if (invoke) {
      // The window's own zoom. It survives until the app is quit, so 100%
      // is set explicitly rather than left, and it is put back on the way
      // out for whatever page follows this one.
      void invoke("plugin:webview|set_webview_zoom", { value: scale }).catch(
        () => {
          // An older shell without the permission: fall through to CSS.
          applyCssZoom(root, scale);
        }
      );
      return () => {
        void invoke("plugin:webview|set_webview_zoom", { value: 1 }).catch(
          () => {}
        );
        clearCssZoom(root);
      };
    }

    applyCssZoom(root, scale);
    return () => clearCssZoom(root);
  }, [scale]);

  /*
    The window's height, in the pixels the app lays out in.

    Only the CSS path needs it — page zoom keeps `100vh` honest — but it is
    harmless there, so it is written either way and the shell reads it in
    place of vh. `zoom` scales lengths in px and does not scale vh: at 120%
    a shell told to be 100vh came out a fifth taller than the window.
  */
  React.useEffect(() => {
    const root = document.documentElement;
    const cssZoomed = !tauriInvoke();
    const apply = () => {
      const divisor = cssZoomed ? scale : 1;
      root.style.setProperty(
        "--mail-viewport-h",
        `${window.innerHeight / divisor}px`
      );
    };
    apply();
    window.addEventListener("resize", apply);
    /*
      And again whenever the page is actually laid out at another size.

      The shell's zoom is set over an async call, so this effect runs
      before the zoom it was woken for has reached the webview: the
      measurement is then the window at the old zoom, which is too big.
      Nothing else told us — a zoom is not always a `resize` — so a card
      that reads the variable stood taller than the screen, and its
      heading, which is what carries it, hung off the top.
    */
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(apply);
    observer?.observe(root);
    return () => {
      window.removeEventListener("resize", apply);
      observer?.disconnect();
      root.style.removeProperty("--mail-viewport-h");
    };
  }, [scale]);
}

function applyCssZoom(root: HTMLElement, scale: number): void {
  root.style.zoom = scale === 1 ? "" : String(scale);
  // The same number for stylesheets, so a length a library measured in
  // window pixels can be brought into the app's — see MailPage's settings.
  root.style.setProperty("--mail-css-zoom", String(scale));
}

function clearCssZoom(root: HTMLElement): void {
  root.style.zoom = "";
  root.style.removeProperty("--mail-css-zoom");
}
