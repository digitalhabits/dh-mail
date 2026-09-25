/**
 * The words, and the language they are chosen by.
 *
 * No React here, on purpose: the date formatters read the language too, and
 * they are pure functions a test harness runs without a renderer. The hooks
 * that subscribe to it are in `@/lib/mail/i18n`, which is what a component
 * imports.
 *
 * The reader picks a language in Settings, the pick goes to localStorage, and
 * every surface reads it with `useMailT`. The keys are flat and named for the
 * place the words appear.
 *
 * The Danish words follow the vocabulary of the mail clients Danish readers
 * already use — eM Client, Outlook, and Apple Mail agree on most of it:
 * Indbakke, Kladder, Sendt post, Papirkurv, Svar alle, Videresend, Arkiv,
 * Udsæt, Emne, Vedhæftede filer.
 *
 * The words themselves are one file per language: i18n-en.ts, whose keys
 * every language has, and i18n-da.ts, which must have all of them or the
 * type check fails. At run time a missing key still falls back to English,
 * so a string never shows as its key.
 */

import { en } from "@/lib/mail/i18n-en";
import { da } from "@/lib/mail/i18n-da";

export type MailLang = "en" | "da";

export const MAIL_LANG_KEY = "redd-plan-mail-lang";
export const MAIL_LANG_EVENT = "redd-plan-mail-lang-changed";

export const MAIL_LANGS: MailLang[] = ["en", "da"];

export const LANGUAGE_NATIVE_LABELS: Record<MailLang, string> = {
  en: "English",
  da: "Dansk",
};

/** The same two flags To-Do and Blocker draw, so one app looks like the next. */
export const LANGUAGE_FLAG_SVG: Record<MailLang, string> = {
  en: '<svg viewBox="0 0 60 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="#012169" d="M0 0h60v40H0z"/><path stroke="#FFF" stroke-width="8" d="M0 0l60 40M60 0L0 40"/><path stroke="#C8102E" stroke-width="5" d="M0 0l60 40M60 0L0 40"/><path stroke="#FFF" stroke-width="12" d="M30 0v40M0 20h60"/><path stroke="#C8102E" stroke-width="7" d="M30 0v40M0 20h60"/></svg>',
  da: '<svg viewBox="0 0 60 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="60" height="40" fill="#C8102E"/><rect x="21" y="0" width="6.5" height="40" fill="#fff"/><rect x="0" y="17" width="60" height="6" fill="#fff"/></svg>',
};

export type MailStringKey = keyof typeof en;

const translations: Record<MailLang, Partial<Record<MailStringKey, string>>> = {
  en,
  da,
};

/** `{name}` in a string is replaced by `vars.name`. */
function fill(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match
  );
}

export type MailT = (
  key: MailStringKey,
  vars?: Record<string, string | number>
) => string;

export function makeMailT(lang: MailLang): MailT {
  return (key, vars) =>
    fill(translations[lang]?.[key] ?? en[key] ?? String(key), vars);
}

/**
 * The words, at the moment of the call.
 *
 * For imperative code — a toast raised inside a callback, an error thrown in
 * a handler. A `t` captured by a callback goes stale when the reader changes
 * language, and every such callback would have to name it as a dependency.
 * This one reads the language when the message is written.
 */
export function mailSay(
  key: MailStringKey,
  vars?: Record<string, string | number>
): string {
  return makeMailT(readMailLang())(key, vars);
}

export function isMailLang(value: unknown): value is MailLang {
  return value === "en" || value === "da";
}

export function readMailLang(): MailLang {
  if (typeof window === "undefined") return "en";
  try {
    const stored = localStorage.getItem(MAIL_LANG_KEY);
    if (isMailLang(stored)) return stored;
  } catch {
    /* private mode */
  }
  return "en";
}

/**
 * The locale dates and numbers are drawn in.
 *
 * `undefined` means the reader's own locale, which is what English should
 * follow. Danish names its own, because a Dane reading Danish wants Danish
 * months whatever the operating system is set to.
 */
export function mailLocale(lang: MailLang): string | undefined {
  return lang === "da" ? "da-DK" : undefined;
}

/** For the formatters, which are pure functions and hold no hook. */
export function currentMailLocale(): string | undefined {
  return mailLocale(readMailLang());
}

export function setMailLang(next: MailLang): void {
  try {
    localStorage.setItem(MAIL_LANG_KEY, next);
  } catch {
    /* private mode */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(MAIL_LANG_EVENT));
    // The app language also sets the document language, for spell check and
    // for screen readers.
    document.documentElement.lang = next;
  }
}
