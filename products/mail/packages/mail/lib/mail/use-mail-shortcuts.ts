"use client";

/** The React view of the thread shortcuts. The model is in `shortcuts`. */

import * as React from "react";

import {
  DEFAULT_MAIL_SHORTCUTS,
  readMailShortcuts,
  subscribeMailShortcuts,
  type MailShortcut,
  type MailShortcutAction,
} from "@/lib/mail/shortcuts";

export function useMailShortcuts(): Record<MailShortcutAction, MailShortcut> {
  return React.useSyncExternalStore(
    subscribeMailShortcuts,
    readMailShortcuts,
    () => DEFAULT_MAIL_SHORTCUTS
  );
}
