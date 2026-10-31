"use client";

/**
 * A scheduled message, open in the reader.
 *
 * A reply sent later stands in its thread, as a dashed bubble with its
 * time. A new message has no thread to stand in until it goes. Without this
 * page, its row in the Scheduled group opens nothing. The reader sees that
 * the message is there, but not what it says, and cannot change it. This is its
 * page — the words, who it goes to, when — with the four things to do with
 * it: Send now, Change time, Edit, Cancel (docs/mail-send-later.md, 4.7).
 */

import { usePageActions, usePageCompose, usePageList } from "@/components/mail/mail-page-slices";
import { ScheduledActions } from "@/components/mail/scheduled-actions";
import { editHeldInComposer, nextHeldAfterDelete } from "@/lib/mail/scheduled-held";
import { unscheduleHeldWithUndo } from "@/components/mail/scheduled-undo";
import * as React from "react";
import { CalendarClock, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { EmailHtmlView } from "@/components/mail/EmailHtmlView";
import { SendLaterMenu } from "@/components/mail/SendLaterMenu";
import { formatSnoozeWakeLabel } from "@/components/mail/SnoozeMenu";
import { sanitizeEmailHtml } from "@/lib/mail/email-html";
import { useMailT } from "@/lib/mail/i18n";
import { useMailColorMode } from "@/lib/mail/theme";
import { isScheduledDraftId } from "@/lib/mail/scheduled-drafts";
import { isPendingScheduledId } from "@/lib/mail/scheduled-events";
import { actionForEvent, TYPING_TARGET } from "@/lib/mail/shortcuts";
import { useMailShortcuts } from "@/lib/mail/use-mail-shortcuts";
import type { MailScheduledMessage } from "@/lib/mail/types";

// ---------------------------------------------------------------------------
// Which scheduled message is open. A little store of its own: the list sets
// it, the reading pane shows it, and opening a thread clears it.
// ---------------------------------------------------------------------------

let openNow: MailScheduledMessage | null = null;
const listeners = new Set<() => void>();

export function openScheduledMessage(held: MailScheduledMessage | null): void {
  if (openNow === held) return;
  openNow = held;
  for (const listener of listeners) listener();
}

export function useOpenScheduledMessage(): MailScheduledMessage | null {
  return React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => openNow,
    () => null
  );
}

/**
 * The scheduled message open in the reader, as the list has it now. It goes
 * when a thread is opened, when another person is picked in Stacks, when
 * another folder, tab or search is opened (2026-10-31: it stood over the
 * Inbox), and when it has been sent or let go.
 */
export function useOpenHeldMessage(
  held: readonly MailScheduledMessage[],
  threadOpen: boolean,
  personKey?: string | null,
  viewKey?: string
): MailScheduledMessage | null {
  const open = useOpenScheduledMessage();
  // Not on the first run: a message opened from a row stays open.
  const viewSeen = React.useRef(viewKey);
  React.useEffect(() => {
    if (viewSeen.current === viewKey) return;
    viewSeen.current = viewKey;
    openScheduledMessage(null);
  }, [viewKey]);
  React.useEffect(() => {
    if (threadOpen) openScheduledMessage(null);
  }, [threadOpen]);
  // By key, not by row: the rows are made again on every refresh of the list.
  React.useEffect(() => {
    if (personKey) openScheduledMessage(null);
  }, [personKey]);
  if (!open || threadOpen) return null;
  return held.find((h) => h.id === open.id && h.account === open.account) ?? null;
}

/** "Change time": the same times as Send later, for a message already scheduled. */
export function ChangeTimeMenu({
  account,
  onPick,
  asButton = false,
  label,
  overDialog = false,
}: {
  account: string;
  onPick: (iso: string) => void;
  asButton?: boolean;
  /** In place of "Change time": "Reschedule…" for a message that missed its time. */
  label?: string;
  /** Opened from a dialog: the menu stands above it. */
  overDialog?: boolean;
}) {
  const t = useMailT();
  const word = label ?? t("changeTime");
  return (
    <SendLaterMenu
      account={account}
      schedule
      onPick={onPick}
      contentClassName={overDialog ? "z-[210]" : undefined}
      trigger={
        asButton ? (
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5">
            <Clock className="h-3.5 w-3.5" aria-hidden />
            {word}
          </Button>
        ) : (
          <button type="button" className="inline-flex items-center gap-1 font-semibold text-teal-700 hover:text-teal-800">
            <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden strokeWidth={2} />
            {word}
          </button>
        )
      }
    />
  );
}


/**
 * The page: the subject as a thread's heading, who it goes to, and the
 * message in the dashed bubble a scheduled reply has in its thread, with
 * its time and what can be done with it under it.
 */
export function ScheduledMessageView({ held }: { held: MailScheduledMessage }) {
  const pageActions = usePageActions();
  const pageList = usePageList();
  const shortcuts = useMailShortcuts();
  const { startCompose } = usePageCompose();
  const t = useMailT();
  const late = held.status === "failed";
  const hasWords = Boolean(held.bodyHtml || held.bodyText);
  const html = React.useMemo(() => (held.bodyHtml ? sanitizeEmailHtml(held.bodyHtml) : ""), [held.bodyHtml]);
  const dark = useMailColorMode() === "dark";
  /**
   * Delete, with Undo, and open the next scheduled message in the list, or
   * the one before it. When none is left, the reader is empty (2026-10-31).
   * The next one opens on this page, a reply too: here the Delete key
   * deletes a scheduled message, never a conversation.
   */
  const deleteAndMoveOn = React.useCallback(() => {
    const next = nextHeldAfterDelete(pageList.heldMessages, held, isPendingScheduledId);
    void pageActions.actOnHeld(held, "delete");
    openScheduledMessage(next);
  }, [held, pageActions, pageList.heldMessages]);
  React.useEffect(() => {
    if (held.cancellable === false) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(TYPING_TARGET)) return;
      if (target?.closest('[role="dialog"][aria-modal="true"]')) return;
      if (actionForEvent(event, shortcuts) !== "delete") return;
      event.preventDefault();
      // One press, one delete: a held key must not take the next ones.
      if (event.repeat) return;
      deleteAndMoveOn();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [held.cancellable, shortcuts, deleteAndMoveOn]);
  const act = (action: "sendNow" | "delete") => {
    openScheduledMessage(null);
    void pageActions.actOnHeld(held, action);
  };
  // As Delete: it leaves, with Undo, and the next one opens.
  const unschedule = () => {
    const next = nextHeldAfterDelete(pageList.heldMessages, held, isPendingScheduledId);
    void unscheduleHeldWithUndo(held);
    openScheduledMessage(next);
  };
  const edit = async () => {
    openScheduledMessage(null);
    await editHeldInComposer(startCompose, held);
  };
  const people = [
    `${t("fieldTo")} ${held.to.join(", ")}`,
    held.cc.length ? `Cc ${held.cc.join(", ")}` : "",
    held.bcc?.length ? `Bcc ${held.bcc.join(", ")}` : "",
  ].filter(Boolean);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="border-b border-stone-200 px-8 pb-4 pt-6">
        <h1 className="font-serif text-2xl font-semibold leading-tight text-stone-900">
          {held.subject || t("noSubject")}
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          {t("fieldFrom")} {held.account}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1.5 px-8 py-6">
        <p className="max-w-[85%] self-end truncate text-xs text-stone-500">{people.join(" · ")}</p>
        {/* Waiting to go, said plainly (2026-10-31): your bubble's blue in
            full, inside a strong dashed blue edge, as Messages draws one. */}
        <div className="w-full max-w-[85%] self-end rounded-surface rounded-br-md border-2 border-dashed border-[var(--mail-compose-edge-focus)] bg-[var(--mail-bubble-own)] px-4 py-3">
          {html ? (
            /*
              In the frame the messages are read in, re-lit in the dark as
              they are. If it is put in unchanged, the message keeps the
              colours that it was written with. That is dark grey on the dark page.
            */
            <EmailHtmlView
              html={html}
              allowImages
              bodyColor={dark ? "#e2e9f0" : undefined}
              darkRecolor={dark}
            />
          ) : (
            <p className="whitespace-pre-wrap break-words text-[15px] text-stone-800">{held.bodyText}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5 pr-1 text-[13px] text-stone-500">
          <Clock className={cn("h-3.5 w-3.5", late ? "text-amber-700" : "text-[var(--mail-own-ink)]")} aria-hidden />
          <span className={late ? "font-semibold text-amber-700" : "font-semibold text-[var(--mail-own-ink)]"}>
            {late ? held.error || t("notSent") : t("sendsWhen", { when: formatSnoozeWakeLabel(held.sendAt) })}
          </span>
          {held.cancellable === false ? null : (
            <ScheduledActions
              look="links"
              onDelete={deleteAndMoveOn}
              onUnschedule={unschedule}
              onEdit={hasWords ? () => void edit() : undefined}
              onSendNow={() => act("sendNow")}
              changeTime={
                held.reschedulable ? (
                  <ChangeTimeMenu account={held.account} onPick={(iso) => void pageActions.actOnHeld(held, "reschedule", iso)} />
                ) : undefined
              }
            />
          )}
        </div>
        {isScheduledDraftId(held.id) && !late ? (
          <p className="max-w-[85%] self-end text-right text-[11px] text-stone-400">{t("draftSendLaterHint")}</p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Under a composer opened with Edit on a scheduled message: what happens to
 * the original, said where the reader is deciding. Nothing when the
 * composer is not an edit.
 */
export function EditingScheduledNote({
  original,
  width,
}: {
  original: { sendAt: string } | null;
  width?: number;
}) {
  const t = useMailT();
  if (!original) return null;
  return (
    <p
      className="mx-auto mt-2 flex items-start gap-1.5 rounded-control bg-teal-50/70 px-3 py-2 text-xs leading-snug text-stone-700"
      style={width ? { width, maxWidth: "100%" } : undefined}
    >
      <Clock className="mt-px h-3.5 w-3.5 shrink-0 text-teal-700/75" aria-hidden />
      {t("editingScheduledNote", { when: formatSnoozeWakeLabel(original.sendAt) })}
    </p>
  );
}
