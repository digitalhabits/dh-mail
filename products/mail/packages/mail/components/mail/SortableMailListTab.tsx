"use client";

import { type MailListTab } from "@/components/mail/mail-list-state";

import * as React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMailT } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";
import { TabIcon } from "@/lib/mail/tab-icons";

/**
 * A list tab, as in To-Do: All, a flavor's own tabs, Other, a list of one's own, and a
 * view the list is standing in (Sent, Snoozed, Trash). Underlined when it
 * is the one on screen. The five pixels above the words match the
 * underline and the padding under them, so the words sit in the middle.
 */
export function viewTabClass(active: boolean): string {
  return cn(
    "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 pb-1 pt-1 text-[14px]",
    // The one on screen in its weight, on a teal line; the rest lighter,
    // as in To-Do.
    active
      ? "border-teal-600 font-medium text-[var(--mail-chrome-fg)]"
      : "border-transparent font-normal text-[var(--mail-chrome-muted)] hover:text-[var(--mail-chrome-fg)]"
  );
}

export function SortableMailListTab({
  id,
  label,
  icon,
  active,
  onSelect,
  onEdit,
  suppressClick,
  hits,
}: {
  id: MailListTab;
  label: string;
  /** A Lucide name, from lib/mail/tab-icons. */
  icon?: string;
  active: boolean;
  onSelect: () => void;
  /** Right-click (custom lists) opens the editor. */
  onEdit?: () => void;
  suppressClick: React.MutableRefObject<boolean>;
  /** While a search runs: how many of its hits are on this tab. */
  hits?: number | null;
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
        // An underlined tab, as in To-Do. Not chips: chips that can be
        // switched on together read as confusing.
        viewTabClass(active),
        "touch-none",
        isDragging && "z-10 cursor-grabbing opacity-80"
      )}
    >
      {icon ? <TabIcon id={icon} size={14} className="shrink-0 opacity-80" /> : null}
      {label}
      <TabHits hits={hits} />
    </button>
  );
}

/**
 * A search's hits on a tab, small and quiet after its name: the reader sees
 * which tab their result is on before clicking through.
 */
export function TabHits({ hits }: { hits?: number | null }) {
  if (hits == null) return null;
  return <span className="text-[12px] tabular-nums text-[var(--mail-chrome-muted)] opacity-80">{hits}</span>;
}

/** Sync client read for the list key matching the persisted tab (SSR → null). */
