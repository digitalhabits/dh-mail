"use client";

/**
 * The reading pane while more than one draft is selected.
 *
 * The inbox's own pane (SelectionPane) speaks of conversations and offers
 * Archive, and neither is true of drafts. This one says how many drafts are
 * held and offers the one thing to do with them all: discard them. The
 * delete key does the same, and Escape lets go of the selection.
 */

import * as React from "react";
import { FileText, Trash2 } from "lucide-react";

import { THREAD_ACTION_CLASS } from "@/components/mail/thread-actions";
import { useMailT } from "@/lib/mail/i18n";
import { actionForEvent, formatShortcut } from "@/lib/mail/shortcuts";
import { useMailShortcuts } from "@/lib/mail/use-mail-shortcuts";
import { cn } from "@/lib/utils";

export function DraftsSelectionPane({
  count,
  onDiscard,
  onClear,
}: {
  count: number;
  onDiscard: () => void;
  onClear: () => void;
}) {
  const t = useMailT();
  const shortcuts = useMailShortcuts();

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      if (target?.closest('[role="dialog"][aria-modal="true"]')) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onClear();
        return;
      }
      if (actionForEvent(event, shortcuts) !== "delete") return;
      event.preventDefault();
      // One press, one discard — a held key must not take the next ones.
      if (event.repeat) return;
      onDiscard();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shortcuts, onDiscard, onClear]);

  const what = t(count === 1 ? "draftOne" : "draftsMany", { count });

  return (
    <div className="mail-thread-surface flex min-h-0 flex-1 flex-col items-center justify-center gap-5 bg-[var(--mail-thread)] px-6 text-center">
      <FileText
        className="h-14 w-14 stroke-[1.25] text-[var(--mail-thread-muted)]"
        aria-hidden
      />
      <p className="font-serif text-2xl font-bold text-[var(--mail-thread-fg)]">
        {t("selectedCount", { what })}
      </p>
      <button
        type="button"
        className={cn(
          THREAD_ACTION_CLASS,
          "inline-flex w-auto items-center gap-2 px-3 text-sm [&_svg]:size-4",
          "hover:bg-red-50 hover:text-red-600"
        )}
        title={`${t("discardSelectedDrafts")} (${formatShortcut(shortcuts.delete)})`}
        onClick={onDiscard}
      >
        <Trash2 aria-hidden />
        {t("discardSelectedDrafts")}
      </button>
    </div>
  );
}
