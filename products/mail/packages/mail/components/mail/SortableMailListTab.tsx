"use client";

import { type MailListTab } from "@/components/mail/mail-list-state";

import * as React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMailT } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";

export function chipClass(active: boolean): string {
  return cn(
    "shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-[13px] font-medium transition-colors",
    active
      ? "border-teal-600 bg-teal-600/10 text-[var(--mail-chrome-fg)]"
      : "border-[var(--mail-chrome-border)] text-[var(--mail-chrome-muted)] hover:text-[var(--mail-chrome-fg)]"
  );
}

/**
 * A view the list is standing in — Sent, Snoozed, Trash — beside the chips.
 *
 * Still an underline rather than a chip, because it says a different thing:
 * a filter is switched on, and this is a place you are standing. But it has
 * to sit on the same line as the chips do, and it did not. The underline and
 * the padding under it are five pixels the chips have no answer to, and with
 * all five below the words, `items-center` centred the box and left the
 * words riding above every chip in the row. The same five go above, so the
 * words are in the middle of their own box and level with the rest.
 *
 * The chips' size too, which these had never taken.
 */
export function viewTabClass(active: boolean): string {
  return cn(
    "shrink-0 whitespace-nowrap border-b-[3px] pb-0.5 pt-[5px] text-[13px] font-medium",
    active
      ? "border-[var(--mail-tab-active)] text-[var(--mail-chrome-fg)]"
      : "border-transparent text-[var(--mail-chrome-muted)] hover:text-[var(--mail-chrome-fg)]"
  );
}

export function SortableMailListTab({
  id,
  label,
  active,
  onSelect,
  onEdit,
  suppressClick,
}: {
  id: MailListTab;
  label: string;
  active: boolean;
  onSelect: () => void;
  /** Right-click (custom lists) opens the editor. */
  onEdit?: () => void;
  suppressClick: React.MutableRefObject<boolean>;
}) {
  const t = useMailT();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return (
    <button
      ref={setNodeRef}
      type="button"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      {...attributes}
      {...listeners}
      onClick={() => {
        if (suppressClick.current || isDragging) return;
        onSelect();
      }}
      onContextMenu={
        onEdit
          ? (e) => {
              e.preventDefault();
              onEdit();
            }
          : undefined
      }
      title={
        onEdit
          ? t("listTabHintOwn", { name: label })
          : t("listTabHint", { name: label })
      }
      aria-label={
        onEdit
          ? t("listTabHintOwnAria", { name: label })
          : t("listTabHint", { name: label })
      }
      className={cn(
        // A chip, not an underlined tab: these are filters now, and a filter
        // is something you switch on rather than a place you are standing.
        chipClass(active),
        "touch-none",
        isDragging && "z-10 cursor-grabbing opacity-80"
      )}
    >
      {label}
    </button>
  );
}

/** Sync client read for the list key matching the persisted tab (SSR → null). */
