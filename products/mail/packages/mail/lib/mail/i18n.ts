"use client";

/**
 * The language, as a component reads it.
 *
 * The words themselves and the store behind them live in
 * `@/lib/mail/i18n-strings`, which holds no React so that the pure formatters
 * can read the language as well. This file is the door components use: it
 * re-exports all of it and adds the two hooks.
 */

import * as React from "react";

import {
  makeMailT,
  readMailLang,
  setMailLang,
  MAIL_LANG_EVENT,
  type MailLang,
  type MailT,
} from "@/lib/mail/i18n-strings";

export * from "@/lib/mail/i18n-strings";

function subscribeMailLang(onChange: () => void): () => void {
  window.addEventListener(MAIL_LANG_EVENT, onChange);
  // A second window of the same app changes it too.
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(MAIL_LANG_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The reader's pick in Settings. */
export function useMailLang(): [MailLang, (next: MailLang) => void] {
  const value = React.useSyncExternalStore(
    subscribeMailLang,
    readMailLang,
    () => "en" as const
  );
  return [value, setMailLang];
}

/** The words for the current language. */
export function useMailT(): MailT {
  const [lang] = useMailLang();
  return React.useMemo(() => makeMailT(lang), [lang]);
}
