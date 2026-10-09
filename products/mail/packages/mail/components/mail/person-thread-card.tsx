"use client";

/*
 * One conversation in a person's pane: the card, its quick actions on
 * hover, and the right-click menu the list rows have.
 *
 * The card had only the hover actions, and a right-click gave the browser's
 * text menu (Look Up, Copy, Share). A conversation is a conversation
 * wherever it is shown, so the card now answers with the list row's own
 * menu (ThreadRowMenu): reply, snooze, pin, move, archive and the rest.
 */

import * as React from "react";
import { Archive, RotateCwFadingClock, Trash2 } from "lucide-react";

import { DraftBadge, ThreadRowMenu } from "@/components/mail/ThreadListRow";
import { MailDotIcon } from "@/components/mail/MailDotIcon";
import type { MoveMenuHere } from "@/components/mail/MoveToFolderMenu";
import { SnoozeMenu } from "@/components/mail/SnoozeMenu";
import { TrashForeverIcon } from "@/components/mail/TrashForeverIcon";
import { shortDate } from "@/lib/mail/date-format";
import type { MailFolder } from "@/lib/mail/folder-types";
import { useMailT } from "@/lib/mail/i18n";
import type { MailThreadAction, MailThreadSummary } from "@/lib/mail/types";
import { cn } from "@/lib/utils";

/** What the row menu needs that a card cannot answer: the page's `rowMenuActions`. */
export type PersonCardMenu = {
  onAction: (action: MailThreadAction) => void;
  folders: MailFolder[];
  onMoveToFolder?: (folderName: string, create: boolean) => Promise<void>;
  onJunk?: () => void;
  onNotJunk?: () => void;
  onRestore?: () => void;
  onDeleteForever?: () => void;
  onMoveToInbox?: () => void;
  here?: MoveMenuHere;
};

/** The look of a quick action on a thread card, matching the list rows. */
const CARD_ACTION_CLASS =
  "rounded p-1 text-[var(--mail-thread-muted)] hover:bg-[var(--mail-chrome-hover)] hover:text-[var(--mail-thread-fg)]";

export function PersonThreadCard({
  t,
  hasDraft,
  inTrash,
  onOpen,
  onToggleRead,
  onArchive,
  onTrash,
  onDeleteForever,
  menu,
  onSnooze,
  onCancelSnooze,
  pinned = false,
  onTogglePin,
}: {
  t: MailThreadSummary;
  hasDraft: boolean;
  inTrash: boolean;
  onOpen: () => void;
  onToggleRead: () => void;
  onArchive: () => void;
  onTrash: () => void;
  onDeleteForever?: () => void;
  /** The list row's menu. Without it (a person's own window) there is none. */
  menu?: PersonCardMenu;
  onSnooze?: (untilIso: string) => void;
  onCancelSnooze?: () => void;
  pinned?: boolean;
  onTogglePin?: () => void;
}) {
  const say = useMailT();
  const [menuAt, setMenuAt] = React.useState<{ x: number; y: number } | null>(null);
  /** Snooze… on the menu opens the card's own snooze list. */
  const [snoozeSignal, setSnoozeSignal] = React.useState(0);
  /** The hover actions stay while the snooze list is open, or it loses its trigger. */
  const [snoozeOpen, setSnoozeOpen] = React.useState(false);

  return (
    /*
      A div that behaves as a button, not a button.

      The actions below are buttons, and a button inside a button is not
      something a browser will build — the inner ones get lifted out and the
      card stops being one thing to click. So the card takes the role and
      the key handling by hand.
    */
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onOpen();
      }}
      onContextMenu={
        menu
          ? (e) => {
              e.preventDefault();
              setMenuAt({ x: e.clientX, y: e.clientY });
            }
          : undefined
      }
      className="group/card mail-bubble-card cursor-pointer rounded-xl border border-[var(--mail-bubble-other-border)] bg-[var(--mail-bubble-other)] px-4 py-3 text-left outline-none transition-colors hover:bg-[var(--mail-row-hover)] focus-visible:ring-2 focus-visible:ring-teal-600/50"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-[var(--mail-thread-fg)]">
          {t.unread ? (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--mail-accent)]" />
          ) : null}
          <span className="truncate">{t.subject}</span>
          {hasDraft ? <DraftBadge /> : null}
        </p>
        {/* The date stands down for the actions rather than shuffling along
            beside them, the way a list row does it — the card keeps one
            width either way. */}
        <p
          className={cn(
            "shrink-0 text-xs text-[var(--mail-thread-muted)] group-hover/card:hidden",
            snoozeOpen && "hidden"
          )}
        >
          {shortDate(t.lastAt)}
        </p>
        <div
          className={cn(
            "hidden shrink-0 items-center gap-0.5 group-hover/card:flex",
            snoozeOpen && "flex"
          )}
          /* The card underneath opens the thread; these do not. */
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            title={say(t.unread ? "markAsRead" : "markAsUnread")}
            aria-label={say(t.unread ? "markAsRead" : "markAsUnread")}
            className={CARD_ACTION_CLASS}
            onClick={onToggleRead}
          >
            <MailDotIcon className="h-4 w-4" aria-hidden />
          </button>
          {onSnooze ? (
            <SnoozeMenu
              onSnooze={onSnooze}
              onCancelSnooze={onCancelSnooze}
              currentUntil={t.snoozedUntil}
              onOpenChange={setSnoozeOpen}
              openSignal={snoozeSignal}
              trigger={
                <button
                  type="button"
                  title={t.snoozedUntil ? say("changeSnooze") : say("snooze")}
                  aria-label={t.snoozedUntil ? say("changeSnooze") : say("snooze")}
                  className={CARD_ACTION_CLASS}
                >
                  <RotateCwFadingClock className="h-4 w-4" aria-hidden />
                </button>
              }
            />
          ) : null}
          {inTrash ? null : (
            <>
              <button
                type="button"
                title={say("actionArchive")}
                aria-label={say("actionArchive")}
                className={CARD_ACTION_CLASS}
                onClick={onArchive}
              >
                <Archive className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                title={say("actionDelete")}
                aria-label={say("actionDelete")}
                className={cn(CARD_ACTION_CLASS, "hover:bg-red-50 hover:text-red-600")}
                onClick={onTrash}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </>
          )}
          {onDeleteForever ? (
            <button
              type="button"
              title={say("deleteForever")}
              aria-label={say("deleteForever")}
              className={cn(CARD_ACTION_CLASS, "hover:bg-red-50 hover:text-red-600")}
              onClick={onDeleteForever}
            >
              <TrashForeverIcon className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>
      {/* Two lines, not one. A card here has the width of the reading pane
          to fill and is the only thing saying what a thread is about; one
          clipped line was spending that room on an ellipsis. */}
      <p className="mt-1 line-clamp-2 text-xs text-[var(--mail-thread-muted)]">
        {t.messageCount === 1
          ? say("threadMessageOne")
          : say("threadMessageMany", { count: t.messageCount })}{" "}
        · {t.snippet}
      </p>
      {menu && menuAt ? (
        // Its clicks are its own, not the card's: the card would open the thread.
        <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <ThreadRowMenu
            account={t.account}
            x={menuAt.x}
            y={menuAt.y}
            unread={Boolean(t.unread)}
            pinned={pinned}
            snoozed={Boolean(t.snoozedUntil)}
            canReplyAll={(t.externalParticipants?.length ?? 0) > 1}
            folders={menu.folders}
            onAction={menu.onAction}
            onSnooze={onSnooze ? () => setSnoozeSignal((n) => n + 1) : undefined}
            onCancelSnooze={onCancelSnooze}
            onToggleRead={onToggleRead}
            onTogglePin={onTogglePin ?? (() => {})}
            onMoveToFolder={menu.onMoveToFolder}
            onJunk={menu.onJunk}
            onNotJunk={menu.onNotJunk}
            onRestore={menu.onRestore}
            onDeleteForever={menu.onDeleteForever}
            onArchive={inTrash ? undefined : onArchive}
            onTrash={inTrash ? undefined : onTrash}
            onMoveToInbox={menu.onMoveToInbox}
            here={menu.here}
            onDismiss={() => setMenuAt(null)}
          />
        </div>
      ) : null}
    </div>
  );
}
