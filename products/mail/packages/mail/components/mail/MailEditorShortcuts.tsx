"use client";

/**
 * The reader's own keys for paste without formatting and for Link, given to
 * every editor in the window. The editor is shared with another app, which
 * keeps the editor's defaults; Mail lets the reader change these two in the
 * shortcut settings (`pastePlain` and `insertLink` in lib/mail/shortcuts).
 */

import * as React from "react";

import {
  RichTextShortcutsContext,
  type RichTextShortcuts,
} from "@/components/ui/rich-text-shortcuts";
import { shortcutMatchesEvent } from "@/lib/mail/shortcuts";
import { useMailShortcuts } from "@/lib/mail/use-mail-shortcuts";

export function MailEditorShortcuts({ children }: { children: React.ReactNode }) {
  const shortcuts = useMailShortcuts();
  const value = React.useMemo<RichTextShortcuts>(
    () => ({
      pastePlain: (event) => shortcutMatchesEvent(event, shortcuts.pastePlain),
      link: (event) => shortcutMatchesEvent(event, shortcuts.insertLink),
    }),
    [shortcuts.pastePlain, shortcuts.insertLink]
  );
  return (
    <RichTextShortcutsContext.Provider value={value}>{children}</RichTextShortcutsContext.Provider>
  );
}
