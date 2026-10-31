"use client";

/**
 * What can be done with a scheduled message, the same in every place it
 * shows: the dialog for one that missed its time, its own page, and its
 * bubble in a conversation (2026-10-31).
 *
 * Delete · Unschedule · Edit · Send now, and Change time where the
 * provider can change it.
 *
 * - Delete: it is never sent, and nothing is kept.
 * - Unschedule: it is never sent at its time. It stays as an ordinary
 *   draft, with its files (lib/mail/inbox-send, `unscheduleScheduledMailMessage`).
 * - Edit: its words in a composer. The original stays scheduled until the
 *   edited one is sent (lib/mail/scheduled-replace).
 */

import * as React from "react";
import { Ban, Pencil, Send, Trash2, type LucideIcon } from "lucide-react";

import { useMailT } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";

/** Between the status ("Sends at 11:17") and the actions. */
const Divider = () => <span aria-hidden className="mx-1.5 h-4 w-px self-center bg-stone-300" />;

const ICON = "h-3.5 w-3.5 shrink-0";

function LinkAction({
  onClick,
  icon: Icon,
  tone = "teal",
  children,
}: {
  onClick: () => void;
  icon: LucideIcon;
  tone?: "teal" | "red" | "ink";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center gap-1 font-semibold",
        tone === "red" && "text-red-700 hover:text-red-800",
        tone === "ink" && "text-stone-800 hover:text-stone-950",
        tone === "teal" && "text-teal-700 hover:text-teal-800"
      )}
      onClick={onClick}
    >
      <Icon className={ICON} aria-hidden strokeWidth={2} />
      {children}
    </button>
  );
}

export type ScheduledActionHandlers = {
  onDelete: () => void;
  onUnschedule: () => void;
  /** Absent when there are no words to edit. */
  onEdit?: () => void;
  onSendNow: () => void;
  /** Change time, drawn by the caller. Absent where the provider cannot change it. */
  changeTime?: React.ReactNode;
};

/**
 * The actions in a row. "links": under a bubble, after its time, with dots
 * between. "dialog": Delete on its own at the left, Send now as the button.
 */
export function ScheduledActions({
  look,
  onDelete,
  onUnschedule,
  onEdit,
  onSendNow,
  changeTime,
}: ScheduledActionHandlers & { look: "links" | "dialog" }) {
  const t = useMailT();
  if (look === "links") {
    // A divider after the status, then each action with its icon
    // (2026-10-31): Delete, Unschedule, Edit, Change time, Send now.
    return (
      <>
        <Divider />
        <span className="inline-flex flex-wrap items-center justify-end gap-x-3.5 gap-y-1">
          <LinkAction tone="red" icon={Trash2} onClick={onDelete}>
            {t("delete")}
          </LinkAction>
          <LinkAction tone="ink" icon={Ban} onClick={onUnschedule}>
            {t("unschedule")}
          </LinkAction>
          {onEdit ? (
            <LinkAction icon={Pencil} onClick={onEdit}>
              {t("edit")}
            </LinkAction>
          ) : null}
          {changeTime}
          <LinkAction icon={Send} onClick={onSendNow}>
            {t("sendNow")}
          </LinkAction>
        </span>
      </>
    );
  }
  const quiet = "rounded-full px-3 py-1.5 text-sm font-semibold text-stone-700 hover:bg-stone-100";
  return (
    <div className="mt-5 flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="mr-auto rounded-full px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50"
        onClick={onDelete}
      >
        {t("delete")}
      </button>
      <button type="button" className={quiet} onClick={onUnschedule}>
        {t("unschedule")}
      </button>
      {onEdit ? (
        <button type="button" className={quiet} onClick={onEdit}>
          {t("edit")}
        </button>
      ) : null}
      {changeTime}
      <button
        type="button"
        className="rounded-full bg-teal-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-teal-800"
        onClick={onSendNow}
      >
        {t("sendNow")}
      </button>
    </div>
  );
}
