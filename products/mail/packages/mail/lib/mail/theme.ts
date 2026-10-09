"use client";

/**
 * The mail theme: System, Light, or Dark.
 *
 * It works like the theme setting in To-Do. The reader picks a theme under
 * Display, the pick is kept in localStorage, and `system` follows the OS
 * appearance. The resolved value goes on `.mail-shell` as `data-theme`, and
 * `mail.css` holds the tokens for each theme.
 *
 * The key is the one the older Light/Dark toggle used, so an old pick still
 * reads back. Only the new `system` value is added.
 */

import * as React from "react";

export const MAIL_COLOR_MODE_KEY = "redd-plan-mail-color-mode";
export const MAIL_COLOR_MODE_EVENT = "redd-plan-mail-color-mode-changed";
const MAIL_DARK_QUERY = "(prefers-color-scheme: dark)";

/** What the reader picked under Display. */
export type MailTheme = "system" | "light" | "dark";

/** What the shell paints, after `system` is resolved. */
export type MailColorMode = "light" | "dark";

export function readMailTheme(): MailTheme {
  if (typeof window === "undefined") return "system";
  try {
    const stored = localStorage.getItem(MAIL_COLOR_MODE_KEY);
    if (stored === "system" || stored === "dark" || stored === "light") {
      return stored;
    }
  } catch {
    /* private mode */
  }
  return "system";
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(MAIL_DARK_QUERY).matches;
}

export function readMailColorMode(): MailColorMode {
  const theme = readMailTheme();
  if (theme === "system") return systemPrefersDark() ? "dark" : "light";
  return theme;
}

function subscribeMailTheme(onChange: () => void): () => void {
  window.addEventListener(MAIL_COLOR_MODE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  // On `system`, the OS appearance can change while the app is open.
  const query = window.matchMedia?.(MAIL_DARK_QUERY);
  query?.addEventListener("change", onChange);
  return () => {
    window.removeEventListener(MAIL_COLOR_MODE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
    query?.removeEventListener("change", onChange);
  };
}

export function setMailTheme(next: MailTheme): void {
  try {
    localStorage.setItem(MAIL_COLOR_MODE_KEY, next);
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event(MAIL_COLOR_MODE_EVENT));
}

/** The reader's pick under Display: System, Light, or Dark. */
export function useMailTheme(): [MailTheme, (next: MailTheme) => void] {
  const value = React.useSyncExternalStore(
    subscribeMailTheme,
    readMailTheme,
    () => "system" as const
  );
  return [value, setMailTheme];
}

/** Light cream chrome vs full navy dark mode, with `system` resolved. */
export function useMailColorMode(): MailColorMode {
  return React.useSyncExternalStore(
    subscribeMailTheme,
    readMailColorMode,
    () => "light" as const
  );
}
