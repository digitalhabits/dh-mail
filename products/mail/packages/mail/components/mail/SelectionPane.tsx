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
import { TrashForeverIcon } from "@/components/mail/TrashForeverIcon";

import { actionForEvent } from "@/lib/mail/shortcuts";
import { useMailShortcuts } from "@/lib/mail/use-mail-shortcuts";
import { formatShortcut } from "@/lib/mail/shortcuts";
import { useMailT } from "@/lib/mail/i18n";
import { THREAD_ACTION_CLASS } from "@/components/mail/thread-actions";
import { cn } from "@/lib/utils";

export function SelectionPane({
  count,
  conversations,
  people,
  onArchive,
  onDelete,
  onDeleteForever,
  inTrash = false,
  onClear,
}: {
  /** How many rows are selected: threads, or people in the by-person view. */
  count: number;
  /** How many conversations those rows hold. The buttons act on these. */
  conversations: number;
  /** Rows are people, not threads: a second line says so, the keys do not change. */
  people: boolean;
  onArchive: () => void;
  onDelete: () => void;
  /**
   * In Trash and Junk only. It opens the page's question and deletes nothing
   * itself. In Trash the delete key calls it too.
   */
  onDeleteForever?: () => void;
  /** In Trash, Archive and Delete have nothing to do, so they are not shown. */
  inTrash?: boolean;
  onClear: () => void;
}) {
  const t = useMailT();
  const shortcuts = useMailShortcuts();

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      // A key pressed inside a modal dialog belongs to the dialog.
      if (target?.closest('[role="dialog"][aria-modal="true"]')) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onClear();
        return;
      }
      const action = actionForEvent(event, shortcuts);
      if (action !== "archive" && action !== "delete") return;
      event.preventDefault();
      // In Trash there is nothing to archive, and the delete key asks the
      // "Delete forever" question. It only opens the dialog: the focus there
      // starts on Cancel, so the key alone never deletes anything.
      if (inTrash) {
        if (action === "delete" && !event.repeat) onDeleteForever?.();
        return;
      }
      // A held key repeats, and the second archive is not a second wish —
      // the same rule the thread reader keeps.
      if (event.repeat) return;
      if (action === "archive") onArchive();
      else onDelete();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shortcuts, onArchive, onDelete, onDeleteForever, onClear, inTrash]);

  /*
    Always the conversations, in every view. The buttons archive and delete
    mail, and "3 people selected" above a Delete button read as if it would
    delete three contacts. In the by-person view a second line says whose
    conversations they are.
  */
  const what = t(conversations === 1 ? "conversationOne" : "conversationsMany", {
    count: conversations,
  });

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
        {people ? (
          <p className="mt-1 text-base text-[var(--mail-thread-muted)]">
            {t(count === 1 ? "withPersonOne" : "withPeopleMany", { count })}
          </p>
        ) : null}
      </div>
      {/* The reader's own buttons, wearing words: above a thread an icon has
          one thing it can mean, and here it asks about every row at once. */}
      <div className="flex items-center gap-1">
        {inTrash ? null : (
          <>
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
          </>
        )}
        {onDeleteForever ? (
          <button
            type="button"
            /*
              In Trash it stands alone under the count. At the size of
              Archive and Delete it read as a caption and not as the thing to
              press, so there it is larger and has an outline. In Junk it
              stands beside those two and keeps their size: the one action
              with no way back must not be the biggest button in the row.
            */
            className={cn(
              THREAD_ACTION_CLASS,
              inTrash
                ? "inline-flex h-11 w-auto items-center gap-2.5 border border-[var(--mail-chrome-border)] px-5 text-base font-medium [&_svg]:size-5"
                : "inline-flex w-auto items-center gap-2 px-3 text-sm [&_svg]:size-4",
              "hover:border-red-200 hover:bg-red-50 hover:text-red-600"
            )}
            title={
              inTrash
                ? `${t("deleteForever")} (${formatShortcut(shortcuts.delete)})`
                : t("deleteForever")
            }
            onClick={onDeleteForever}
          >
            <TrashForeverIcon />
            {t("deleteForever")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
