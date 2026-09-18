"use client";

import * as React from "react";
import { Loader2, FolderInput, MoreHorizontal, MessagesSquare, Pin, Printer, RotateCwFadingClock, Sparkles } from "lucide-react";
import { MailDotIcon } from "@/components/mail/MailDotIcon";
import { type ThreadToolbarSlot } from "@/components/mail/use-thread-toolbar-fold";
import { type MoveMenuHere, MoveToFolderMenu } from "@/components/mail/MailFolders";
import { SnoozeMenu } from "@/components/mail/SnoozeMenu";
import { THREAD_ACTION_CLASS } from "@/components/mail/thread-actions";
import { ZoomControls } from "@/components/mail/ZoomControls";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { MailPopoverContent } from "@/components/mail/MailPopoverContent";
import type { MailFolder } from "@/lib/mail/folder-types";
import { useMailT } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";

/**
 * What will not fit on the action strip, behind one button.
 *
 * The menu lists only the controls that this fold hid. Zoom goes first.
 * Print, pop out, pin, move and the CRM follow, one at a time. Read and
 * snooze follow those. Reply, archive, delete, the file chip and focus
 * stay on the row at every width.
 */
export function ThreadToolbarOverflow({
  hidden,
  zoom,
  onZoomAdjust,
  onPrint,
  onPopOut,
  pinned,
  onTogglePin,
  unread,
  onToggleUnread,
  onSnooze,
  onCancelSnooze,
  snoozedUntil,
  folders,
  onMoveToFolder,
  onMoveToJunk,
  onMoveToInbox,
  onArchive,
  onTrash,
  here,
  onProposeCrm,
  crmBusy,
  printLabel,
  popOutLabel,
}: {
  hidden: Set<ThreadToolbarSlot>;
  zoom: number;
  onZoomAdjust: (delta: number) => void;
  onPrint?: () => void;
  onPopOut?: () => void;
  pinned: boolean;
  onTogglePin?: () => void;
  unread: boolean;
  onToggleUnread?: () => void;
  onSnooze?: (untilIso: string) => void;
  onCancelSnooze?: () => void;
  snoozedUntil?: string;
  folders: MailFolder[];
  onMoveToFolder?: (folderName: string, create: boolean) => Promise<void>;
  /** Junk is a move, so it is pinned above the folders — not its own row. */
  onMoveToJunk?: () => void;
  /** The rail's other three places, which are moves as much as junk is. */
  onMoveToInbox?: () => void;
  onArchive?: () => void;
  onTrash?: () => void;
  /** Which of them this conversation is in. */
  here?: MoveMenuHere;
  onProposeCrm?: (hint?: string) => void;
  crmBusy?: boolean;
  printLabel: string;
  popOutLabel: string;
}) {
  const t = useMailT();
  const [open, setOpen] = React.useState(false);
  const row =
    "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-stone-800 hover:bg-[var(--mail-chrome-hover)]";
  const pick = (run: () => void) => () => {
    setOpen(false);
    run();
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("more")}
          title={t("more")}
          className={THREAD_ACTION_CLASS}
        >
          <MoreHorizontal />
        </Button>
      </PopoverTrigger>
      <MailPopoverContent
        align="end"
        className="w-56 p-1"
        /* The folder and snooze menus open out of rows in here, and their
           cards are portalled out of this one — so this card is told that a
           press in one of them is not a press outside itself. Without it the
           folder list appeared and this closed underneath it, taking the
           list with it. The same arrangement the settings panel makes for
           the mark menu. */
        onInteractOutside={(e) => {
          const el = e.target;
          if (
            el instanceof Element &&
            el.closest("[data-mail-move-menu], [data-mail-snooze-menu]")
          ) {
            e.preventDefault();
          }
        }}
      >
        {onToggleUnread ? (
          <button type="button" className={row} onClick={pick(onToggleUnread)}>
            <MailDotIcon
              className="h-4 w-4 shrink-0 text-stone-400"
              aria-hidden
            />
            {t(unread ? "markAsRead" : "markAsUnread")}
          </button>
        ) : null}
        {onSnooze ? (
          <SnoozeMenu
            onSnooze={(untilIso) => {
              setOpen(false);
              onSnooze(untilIso);
            }}
            onCancelSnooze={
              onCancelSnooze
                ? () => {
                    setOpen(false);
                    onCancelSnooze();
                  }
                : undefined
            }
            currentUntil={snoozedUntil}
            title={t("actionSnooze")}
            trigger={
              <button type="button" className={row}>
                <RotateCwFadingClock
                  className="h-4 w-4 shrink-0 text-stone-400"
                  aria-hidden
                />
                {t(snoozedUntil ? "changeSnoozeEllipsis" : "snoozeEllipsis")}
              </button>
            }
          />
        ) : null}
        {onTogglePin ? (
          <button type="button" className={row} onClick={pick(onTogglePin)}>
            <Pin
              className={cn(
                "h-4 w-4 shrink-0",
                pinned
                  ? "fill-current text-[var(--mail-accent)]"
                  : "text-stone-400"
              )}
              aria-hidden
            />
            {t(pinned ? "unpin" : "pinToTop")}
          </button>
        ) : null}
        {onMoveToFolder ? (
          <MoveToFolderMenu
            folders={folders}
            onMoved={onMoveToFolder}
            destinations={{
              inbox: onMoveToInbox
                ? () => {
                    setOpen(false);
                    onMoveToInbox();
                  }
                : undefined,
              archived: onArchive
                ? () => {
                    setOpen(false);
                    onArchive();
                  }
                : undefined,
              junk: onMoveToJunk
                ? () => {
                    setOpen(false);
                    onMoveToJunk();
                  }
                : undefined,
              trash: onTrash
                ? () => {
                    setOpen(false);
                    onTrash();
                  }
                : undefined,
            }}
            here={here}
            title={t("moveToFolder")}
            trigger={
              <button type="button" className={row}>
                <FolderInput
                  className="h-4 w-4 shrink-0 text-stone-400"
                  aria-hidden
                />
                {t("moveToFolder")}
              </button>
            }
          />
        ) : null}
        {onPrint ? (
          <button type="button" className={row} onClick={pick(onPrint)}>
            <Printer className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />
            {printLabel}
          </button>
        ) : null}
        {onPopOut ? (
          <button type="button" className={row} onClick={pick(onPopOut)}>
            <MessagesSquare
              className="h-4 w-4 shrink-0 text-stone-400"
              aria-hidden
            />
            {popOutLabel}
          </button>
        ) : null}
        {onProposeCrm ? (
          <button
            type="button"
            className={row}
            disabled={crmBusy}
            onClick={pick(() => onProposeCrm())}
          >
            {crmBusy ? (
              <Loader2
                className="h-4 w-4 shrink-0 animate-spin text-stone-400"
                aria-hidden
              />
            ) : (
              <Sparkles className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />
            )}
            {t("updateCrm")}
          </button>
        ) : null}
        {/* The size stays a pair of buttons rather than becoming two more
            rows: it is set by trying it, and a menu that shut on every
            press would be the wrong shape for that. */}
        {hidden.has("zoom") ? (
          <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm text-stone-800">
            {t("textSize")}
            <ZoomControls zoom={zoom} onAdjust={onZoomAdjust} />
          </div>
        ) : null}
      </MailPopoverContent>
    </Popover>
  );
}
