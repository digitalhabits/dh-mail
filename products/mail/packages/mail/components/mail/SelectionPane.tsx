"use client";

/**
 * The reading pane while more than one row is selected.
 *
 * There is nothing to read: a selection is not a conversation, and painting
 * the anchor thread under it would say the wrong thing about what the keys
 * are about to act on. So this stands where the thread would, says how many
 * are held, and takes the same archive and delete keys a single thread
 * takes — one press, all of them.
 */

import * as React from "react";
import { Archive, Mails, Trash2 } from "lucide-react";

import { actionForEvent } from "@/lib/mail/shortcuts";
import { useMailShortcuts } from "@/lib/mail/use-mail-shortcuts";
import { formatShortcut } from "@/lib/mail/shortcuts";
import { useMailT } from "@/lib/mail/i18n";
import { THREAD_ACTION_CLASS } from "@/components/mail/thread-actions";
import { cn } from "@/lib/utils";

export function SelectionPane({
  count,
  people,
  onArchive,
  onDelete,
  onClear,
}: {
  count: number;
  /** Rows are people, not threads: the words change, the keys do not. */
  people: boolean;
  onArchive: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const t = useMailT();
  const shortcuts = useMailShortcuts();

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onClear();
        return;
      }
      const action = actionForEvent(event, shortcuts);
      if (action !== "archive" && action !== "delete") return;
      event.preventDefault();
      // A held key repeats, and the second archive is not a second wish —
      // the same rule the thread reader keeps.
      if (event.repeat) return;
      if (action === "archive") onArchive();
      else onDelete();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shortcuts, onArchive, onDelete, onClear]);

  const what = people
    ? t(count === 1 ? "personOne" : "peopleMany", { count })
    : t(count === 1 ? "conversationOne" : "conversationsMany", { count });

  return (
    <div className="mail-thread-surface flex min-h-0 flex-1 flex-col items-center justify-center gap-5 bg-[var(--mail-thread)] px-6 text-center">
      <Mails
        className="h-14 w-14 stroke-[1.25] text-[var(--mail-thread-muted)]"
        aria-hidden
      />
      <div>
        <p className="font-serif text-2xl font-bold text-[var(--mail-thread-fg)]">
          {t("selectedCount", { what })}
        </p>
        <p className="mt-1.5 max-w-sm text-sm text-[var(--mail-thread-muted)]">
          {t("selectionHint")}
        </p>
      </div>
      {/* The reader's own buttons, wearing words: above a thread an icon has
          one thing it can mean, and here it asks about every row at once. */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          className={cn(
            THREAD_ACTION_CLASS,
            "inline-flex w-auto items-center gap-2 px-3 text-sm [&_svg]:size-4"
          )}
          title={`${t("archiveSelected")} (${formatShortcut(shortcuts.archive)})`}
          onClick={onArchive}
        >
          <Archive aria-hidden />
          {t("archiveSelected")}
        </button>
        <button
          type="button"
          className={cn(
            THREAD_ACTION_CLASS,
            "inline-flex w-auto items-center gap-2 px-3 text-sm [&_svg]:size-4",
            "hover:bg-red-50 hover:text-red-600"
          )}
          title={`${t("deleteSelected")} (${formatShortcut(shortcuts.delete)})`}
          onClick={onDelete}
        >
          <Trash2 aria-hidden />
          {t("deleteSelected")}
        </button>
      </div>
    </div>
  );
}
