"use client";

/**
 * The little picture on a mailbox tab.
 *
 * By default it is the provider's: Gmail's envelope, Outlook's square. That
 * is right for a personal address and wrong for a working one — a Google
 * Workspace mailbox at your own company is a Google account in the same way
 * a phone bill is a phone: true, and not what it is for. So a reader can put
 * their own picture on any mailbox, and the provider's is what shows until
 * they do.
 *
 * Kept here rather than with the account, and locally: it is how one reader
 * likes to see their own list, the same kind of thing as the theme or the
 * order the mailboxes sit in. The picture is a data URL, scaled down on the
 * way in — see `downscaleTarget`, which the resting picture uses too.
 */

import * as React from "react";

export const MAIL_ACCOUNT_MARK_KEY = "redd-plan-mail-account-marks";
export const MAIL_ACCOUNT_MARK_EVENT = "redd-plan-mail-account-marks-changed";

/** The longest edge a chosen picture is stored at. A tab draws it at 16px. */
export const ACCOUNT_MARK_MAX_EDGE = 96;

export type AccountMarks = Record<string, string>;

function key(email: string): string {
  return email.trim().toLowerCase();
}

export function readAccountMarks(): AccountMarks {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(MAIL_ACCOUNT_MARK_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: AccountMarks = {};
    for (const [email, value] of Object.entries(parsed)) {
      // Only a data URL. A remote address here would fetch on every render,
      // and tell whoever serves it when this reader opened their mail.
      if (typeof value === "string" && value.startsWith("data:image/")) {
        out[key(email)] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** A data URL to set the mailbox's own picture, or null to go back to the provider's. */
export function setAccountMark(email: string, mark: string | null): void {
  if (typeof window === "undefined") return;
  const marks = readAccountMarks();
  if (mark) marks[key(email)] = mark;
  else delete marks[key(email)];
  try {
    localStorage.setItem(MAIL_ACCOUNT_MARK_KEY, JSON.stringify(marks));
  } catch {
    /* private mode, or a picture too big for what is left of the store */
  }
  window.dispatchEvent(new Event(MAIL_ACCOUNT_MARK_EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(MAIL_ACCOUNT_MARK_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(MAIL_ACCOUNT_MARK_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

const EMPTY: AccountMarks = {};
let cached: AccountMarks | null = null;

/** Stable between changes, because useSyncExternalStore compares by identity. */
function snapshot(): AccountMarks {
  cached ??= readAccountMarks();
  return cached;
}

export function useAccountMarks(): AccountMarks {
  return React.useSyncExternalStore(
    (onChange) =>
      subscribe(() => {
        cached = null;
        onChange();
      }),
    snapshot,
    () => EMPTY
  );
}
