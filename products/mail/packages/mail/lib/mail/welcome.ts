"use client";

/**
 * "Show the welcome screen again", from Settings → Advanced.
 *
 * The welcome screen belongs to the app's shell (apps/mail/src/WelcomeScreen.tsx),
 * and Settings belongs to the shared interface. A window event carries the
 * request across. A build with no welcome screen hears nothing.
 */

export const MAIL_SHOW_WELCOME_EVENT = "dh-mail-show-welcome";

export function showWelcomeScreen(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(MAIL_SHOW_WELCOME_EVENT));
}
