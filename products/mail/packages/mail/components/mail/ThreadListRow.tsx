"use client";

import { type MailListDensity } from "@/components/mail/MailListControls";

import * as React from "react";
import { MailDotIcon } from "@/components/mail/MailDotIcon";
import { Highlighted } from "@/components/mail/Highlighted";
import {
  MENU_ICON as ROW_MENU_ICON,
  MENU_ITEM as ROW_MENU_ITEM,
  MenuShell as RowMenuShell,
} from "@/components/mail/MenuShell";
import { formatSnoozeWakeLabel, SnoozeMenu } from "@/components/mail/SnoozeMenu";
import { isInteractiveDoubleClickTarget } from "@/components/mail/use-mail-layout";
import { MessageSquare, Archive, ArchiveRestore, Trash2, Calendar, Clock, FolderInput, Forward, Paperclip, MessagesSquare, Pin, Printer, Reply, ReplyAll, RotateCwFadingClock, ShieldCheck, SquarePen } from "lucide-react";
import { TrashForeverIcon } from "@/components/mail/TrashForeverIcon";
import { clearMailThreadDrag, MoveToFolderMenu, setMailThreadDragData } from "@/components/mail/MailFolders";
import type { MailFolder } from "@/lib/mail/folder-types";
import { getThreadDraftKeysSnapshot, subscribeMailDrafts, threadDraftKey } from "@/lib/mail/local-drafts";
import { threadKey } from "@/lib/mail/thread-copies";
import { useMailT } from "@/lib/mail/i18n";
import type { MoveMenuHere } from "@/components/mail/MailFolders";
import type { MailThreadAction, MailThreadSummary } from "@/lib/mail/types";
import { getPopoutKeysServerSnapshot, getPopoutKeysSnapshot, popoutThreadKey, subscribeMailPopouts } from "@/lib/mail/popout";
import { cn } from "@/lib/utils";
import { rowTime } from "@/lib/mail/date-format";
import { PeopleAvatar } from "@/components/mail/PersonAvatar";
import { threadPeople } from "@/lib/mail/person-participants";

/** A finger that has moved this far has said which way it is going. */
const SWIPE_DECIDE_PX = 8;
/** How far a swipe pulls the row at most. */
const SWIPE_MAX_PX = 120;
/** How far it has to go before the action is taken on the lift. */
const SWIPE_COMMIT_PX = 72;

/** Outlook-style cue that this thread has a local unsent reply/forward. */
export function DraftBadge({ className }: { className?: string }) {
  const t = useMailT();
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none",
        "bg-rose-100 text-rose-800",
        className
      )}
    >
      {t("draft")}
    </span>
  );
}

export function useThreadDraftKeys(): ReadonlySet<string> {
  return React.useSyncExternalStore(
    subscribeMailDrafts,
    getThreadDraftKeysSnapshot,
    getThreadDraftKeysSnapshot
  );
}

/** The threads with a chat window open. See `notePopoutOpened`. */
function usePoppedOutKeys(): ReadonlySet<string> {
  return React.useSyncExternalStore(
    subscribeMailPopouts,
    getPopoutKeysSnapshot,
    getPopoutKeysServerSnapshot
  );
}

/**
 * A thread that is being answered in its own window, said in one line.
 *
 * The row's preview is a line of a conversation the reader is already
 * looking at, in a window of its own — so the row stops repeating it and
 * says where the thread went instead.
 */
function PoppedOutBadge({ className }: { className?: string }) {
  const t = useMailT();
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none",
        "bg-teal-50 text-teal-800",
        className
      )}
      title={t("poppedOutHint")}
    >
      <MessageSquare className="h-3 w-3" aria-hidden />
      {t("poppedOut")}
    </span>
  );
}

/**
 * The right-click menu on a row in the list.
 *
 * Everything the reader's own action strip offers, in the same order and
 * the same three groups — answer it, settle it, file it — with archive and
 * delete held back to the end, because those two are the ones you cannot
 * take back with the next click and a menu should not open under the
 * pointer with them where "reply" used to be.
 *
 * Five of them need the messages, which a row does not hold: those open the
 * thread and are done there. See `MailThreadAction`.
 *
 * Placed at the pointer and clamped to the window, like the folder menu in
 * the rail — see MailFolderRail.
 */
/** The look of one line in a row menu, and of the mark beside it. */

export function ThreadRowMenu({
  x,
  y,
  unread,
  pinned,
  snoozed,
  canReplyAll,
  folders,
  onAction,
  onSnooze,
  onCancelSnooze,
  onToggleRead,
  onTogglePin,
  onMoveToFolder,
  onJunk,
  onNotJunk,
  onRestore,
  onDeleteForever,
  onArchive,
  onTrash,
  onMoveToInbox,
  here,
  onDismiss,
  touch = false,
}: {
  x: number;
  y: number;
  unread: boolean;
  pinned: boolean;
  snoozed: boolean;
  /** Reply all reaches somebody Reply does not — the reader's own rule. */
  canReplyAll: boolean;
  folders: MailFolder[];
  /** Open the thread and do this there. */
  onAction: (action: MailThreadAction) => void;
  onSnooze?: () => void;
  onCancelSnooze?: () => void;
  onToggleRead: () => void;
  onTogglePin: () => void;
  onMoveToFolder?: (folderName: string, create: boolean) => Promise<void>;
  onJunk?: () => void;
  onNotJunk?: () => void;
  onRestore?: () => void;
  /** In Trash or Junk only. Not undoable: the caller asks first. */
  onDeleteForever?: () => void;
  onArchive?: () => void;
  onTrash?: () => void;
  /** Back to the inbox, and where this conversation is now — for the move menu. */
  onMoveToInbox?: () => void;
  here?: MoveMenuHere;
  onDismiss: () => void;
  /** On a phone: no printing, no second window, no editing as new. */
  touch?: boolean;
}) {
  const t = useMailT();
  const item = ROW_MENU_ITEM;
  const icon = ROW_MENU_ICON;
  const run = (fn?: () => void) => () => {
    onDismiss();
    fn?.();
  };

  return (
    <RowMenuShell x={x} y={y} label={t("conversation")} onDismiss={onDismiss}>
      {/* Answering it. First, because it is what a conversation is for. */}
      <button
        type="button"
        role="menuitem"
        autoFocus
        className={item}
        onClick={run(() => onAction("reply"))}
      >
        <Reply className={icon} aria-hidden />
        {t("actionReply")}
      </button>
      {canReplyAll ? (
        <button
          type="button"
          role="menuitem"
          className={item}
          onClick={run(() => onAction("replyAll"))}
        >
          <ReplyAll className={icon} aria-hidden />
          {t("actionReplyAll")}
        </button>
      ) : null}
      {/* A message reused rather than answered: the words come out into a
          new message, addressed to nobody, to be sent to somebody else. It
          stands with the other three because it is the fourth thing to do
          with a message that is in front of you. */}
      {touch ? null : (
        <button
          type="button"
          role="menuitem"
          className={item}
          onClick={run(() => onAction("editAsNew"))}
        >
          <SquarePen className={icon} aria-hidden />
          {t("editAsNew")}
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        className={item}
        onClick={run(() => onAction("forward"))}
      >
        <Forward className={icon} aria-hidden />
        {t("actionForward")}
      </button>

      <MenuRule />

      {/* Settling it: what it is to you, and when. */}
      <button type="button" role="menuitem" className={item} onClick={run(onToggleRead)}>
        <MailDotIcon className={icon} aria-hidden />
        {unread ? t("markAsRead") : t("markAsUnread")}
      </button>
      {onSnooze ? (
        <button type="button" role="menuitem" className={item} onClick={run(onSnooze)}>
          <RotateCwFadingClock className={icon} aria-hidden />
          {snoozed ? t("changeSnoozeEllipsis") : t("snoozeEllipsis")}
        </button>
      ) : null}
      {snoozed && onCancelSnooze ? (
        <button type="button" role="menuitem" className={item} onClick={run(onCancelSnooze)}>
          <RotateCwFadingClock className={icon} aria-hidden />
          {t("cancelSnooze")}
        </button>
      ) : null}
      <button type="button" role="menuitem" className={item} onClick={run(onTogglePin)}>
        <Pin className={icon} aria-hidden />
        {pinned ? t("unpin") : t("pinToTop")}
      </button>

      <MenuRule />

      {/* Doing something with it. The folder menu is the reader's own, on a
          trigger shaped like the rows around it — it opens beside the menu
          rather than replacing it, so the pointer never loses its place. */}
      {onMoveToFolder ? (
        <MoveToFolderMenu
          folders={folders}
          onMoved={async (folderName, create) => {
            await onMoveToFolder(folderName, create);
            onDismiss();
          }}
          destinations={{
            inbox: onMoveToInbox ? run(onMoveToInbox) : undefined,
            archived: onArchive ? run(onArchive) : undefined,
            junk: onJunk ? run(onJunk) : undefined,
            trash: onTrash ? run(onTrash) : undefined,
          }}
          here={here}
          title={t("moveToFolder")}
          trigger={
            <button type="button" role="menuitem" className={item}>
              <FolderInput className={icon} aria-hidden />
              {t("moveToFolder")}
            </button>
          }
        />
      ) : null}
      {onNotJunk ? (
        <button type="button" role="menuitem" className={item} onClick={run(onNotJunk)}>
          <ShieldCheck className={icon} aria-hidden />
          {t("notJunk")}
        </button>
      ) : null}
      {onRestore ? (
        <button type="button" role="menuitem" className={item} onClick={run(onRestore)}>
          <ArchiveRestore className={icon} aria-hidden />
          {t("restore")}
        </button>
      ) : null}
      {onDeleteForever ? (
        <button type="button" role="menuitem" className={item} onClick={run(onDeleteForever)}>
          <TrashForeverIcon className={icon} />
          {t("deleteForever")}
        </button>
      ) : null}
      {/* Printing and a second window are the desktop's. A phone has
          neither, so the menu does not offer them there. */}
      {touch ? null : (
        <>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={run(() => onAction("print"))}
          >
            <Printer className={icon} aria-hidden />
            {t("actionPrint")}
          </button>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={run(() => onAction("popOut"))}
          >
            <MessagesSquare className={icon} aria-hidden />
            {t("popOutChat")}
          </button>
        </>
      )}

      {onArchive || onTrash ? <MenuRule /> : null}

      {/* Last, and on their own. Everything above leaves the conversation
          where it is; these two take it out of the list. */}
      {onArchive ? (
        <button type="button" role="menuitem" className={item} onClick={run(onArchive)}>
          <Archive className={icon} aria-hidden />
          {t("actionArchive")}
        </button>
      ) : null}
      {onTrash ? (
        <button
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm text-red-700 hover:bg-red-50"
          onClick={run(onTrash)}
        >
          <Trash2 className="h-3.5 w-3.5 shrink-0 text-red-500" aria-hidden />
          {t("actionDelete")}
        </button>
      ) : null}
    </RowMenuShell>
  );
}

/**
 * The right-click menu on a person, when they hold more than one thread.
 *
 * A person with one thread gets the conversation's own menu — there is
 * nothing there that the thread does not answer for. With several, the
 * lines that ask about one conversation are gone (there is no single one
 * to reply to), and what is left is what the pane above the list offers
 * for the whole pile, plus the three that act on the newest: it is the one
 * the row is showing, and the one the reader means by "this".
 */
export function PersonRowMenu({
  x,
  y,
  name,
  count,
  unread,
  pinned,
  snoozed,
  onToggleRead,
  onSnooze,
  onCancelSnooze,
  onTogglePin,
  onPopOut,
  onArchiveAll,
  onDeleteAll,
  onDeleteForever,
  onDismiss,
}: {
  x: number;
  y: number;
  name: string;
  count: number;
  /** Anything unread in the pile. */
  unread: boolean;
  pinned: boolean;
  /** The newest thread is asleep. */
  snoozed: boolean;
  onToggleRead: () => void;
  onSnooze: () => void;
  onCancelSnooze?: () => void;
  onTogglePin: () => void;
  onPopOut: () => void;
  /** Not given in Trash: the mail is deleted already. */
  onArchiveAll?: () => void;
  onDeleteAll?: () => void;
  /** In Trash and Junk only. It asks the page's question and deletes nothing itself. */
  onDeleteForever?: () => void;
  onDismiss: () => void;
}) {
  const t = useMailT();
  const item = ROW_MENU_ITEM;
  const icon = ROW_MENU_ICON;
  const run = (fn?: () => void) => () => {
    onDismiss();
    fn?.();
  };

  return (
    <RowMenuShell x={x} y={y} label={name} onDismiss={onDismiss}>
      <button type="button" role="menuitem" autoFocus className={item} onClick={run(onToggleRead)}>
        <MailDotIcon className={icon} aria-hidden />
        {unread ? t("markAsRead") : t("markAsUnread")}
      </button>
      <button type="button" role="menuitem" className={item} onClick={run(onSnooze)}>
        <RotateCwFadingClock className={icon} aria-hidden />
        {snoozed ? t("changeSnoozeEllipsis") : t("snoozeEllipsis")}
      </button>
      {snoozed && onCancelSnooze ? (
        <button type="button" role="menuitem" className={item} onClick={run(onCancelSnooze)}>
          <RotateCwFadingClock className={icon} aria-hidden />
          {t("cancelSnooze")}
        </button>
      ) : null}
      <button type="button" role="menuitem" className={item} onClick={run(onTogglePin)}>
        <Pin className={icon} aria-hidden />
        {pinned ? t("unpin") : t("pinToTop")}
      </button>
      <button type="button" role="menuitem" className={item} onClick={run(onPopOut)}>
        <MessagesSquare className={icon} aria-hidden />
        {t("popOutChat")}
      </button>

      <MenuRule />

      {/* Both say how many they take. A pile is not a row, and the number is
          the whole difference between this and archiving one thing. */}
      {onArchiveAll ? (
        <button type="button" role="menuitem" className={item} onClick={run(onArchiveAll)}>
          <Archive className={icon} aria-hidden />
          {t("archiveAllCount", { count })}
        </button>
      ) : null}
      {onDeleteAll ? (
        <button
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm text-red-700 hover:bg-red-50"
          onClick={run(onDeleteAll)}
        >
          <Trash2 className="h-3.5 w-3.5 shrink-0 text-red-500" aria-hidden />
          {t("deleteAllCount", { count })}
        </button>
      ) : null}
      {onDeleteForever ? (
        <button type="button" role="menuitem" className={item} onClick={run(onDeleteForever)}>
          <TrashForeverIcon className={icon} />
          {t("deleteForeverCount", { count })}
        </button>
      ) : null}
    </RowMenuShell>
  );
}

/** The line between two groups of a menu. */
function MenuRule() {
  return <div aria-hidden className="my-1 h-px bg-stone-200" />;
}

/** How many messages, when it is more than one. Hidden at one so a lone mail does not wear a "1". */
export function ThreadMessageCount({
  count,
  label,
}: {
  count: number;
  label: string;
}) {
  if (count <= 1) return null;
  return (
    <span
      className="shrink-0 rounded-full bg-[var(--mail-chrome-selected)] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-[var(--mail-chrome-muted)]"
      title={label}
    >
      {count}
    </span>
  );
}

/**
 * Inbox row. Hover shows read / snooze / archive; pinning is on the
 * right-click menu, and on the reader's strip once the thread is open.
 * `dragKind: "pin"` marks the payload so dropping on the date flow unpins.
 */
export function ThreadListRow({
  thread: t,
  selected,
  withYear,
  pinned,
  density = "comfortable",
  inCard = false,
  onNavy = false,
  narrow = false,
  wide = false,
  onOpen,
  onExpand,
  onTogglePin,
  onToggleRead,
  onSnooze,
  onCancelSnooze,
  onArchive,
  onTrash,
  onAction,
  folders,
  onMoveToFolder,
  onJunk,
  onNotJunk,
  onRestore,
  onDeleteForever,
  dragKind,
  highlight,
  touch = false,
}: {
  thread: MailThreadSummary;
  selected: boolean;
  withYear: boolean;
  pinned: boolean;
  /** The search words, folded, to mark in the row's text. */
  highlight?: string[];
  density?: MailListDensity;
  /** Tighter horizontal padding inside time-group cards. */
  inCard?: boolean;
  /** Row sits on the navy list chrome. */
  onNavy?: boolean;
  /** Avatar-only rail (Signal-style narrow sidebar). */
  narrow?: boolean;
  /**
   * Wide table: sender, subject, count and date on one line.
   *
   * Compact keeps the snippet on that line. Relaxed puts it underneath.
   * Below the width threshold the same marks sit on today's stacked row.
   */
  wide?: boolean;
  /** The click, when there was one, so held keys can extend a selection. */
  onOpen: (event?: React.MouseEvent) => void;
  /**
   * Two clicks: open this thread and read it on its own.
   *
   * The pair goes together — the row is opened by the first click already,
   * so the second is asking for the thing the expand button does.
   */
  onExpand?: () => void;
  onTogglePin: () => void;
  /** Read when anything is unread; otherwise the newest message back to unread. */
  onToggleRead: () => void;
  onSnooze?: (untilIso: string) => void;
  onCancelSnooze?: () => void;
  /** Right-click actions that only make sense where the row can take them. */
  onArchive?: () => void;
  onTrash?: () => void;
  /**
   * The right-click actions the reader has to carry out, because they need
   * the messages and a row holds a summary. See `MailThreadAction`.
   */
  onAction: (action: MailThreadAction) => void;
  folders?: MailFolder[];
  onMoveToFolder?: (folderName: string, create: boolean) => Promise<void>;
  onJunk?: () => void;
  onNotJunk?: () => void;
  onRestore?: () => void;
  /** In Trash or Junk only. Not undoable: the caller asks first. */
  onDeleteForever?: () => void;
  dragKind: "pin" | "folder";
  /**
   * On a phone. No drag — a finger has nowhere to carry a row to — and a
   * swipe instead: right puts the conversation away, left puts it off. The
   * long press that opens the menu is the list's to time; see
   * MailPhoneShell.
   */
  touch?: boolean;
}) {
  const say = useMailT();
  const rowRef = React.useRef<HTMLDivElement | null>(null);
  const compact = density === "compact";
  // The quick actions live on hover. While the snooze menu is open the pointer
  // is off the row, so the row holds them open until the menu closes.
  const [snoozeOpen, setSnoozeOpen] = React.useState(false);
  /** Where the right-click menu is, or null when it is not up. */
  const [menuAt, setMenuAt] = React.useState<{ x: number; y: number } | null>(
    null
  );
  /** Bumped to open the row's snooze menu from the right-click menu. */
  const [snoozeSignal, setSnoozeSignal] = React.useState(0);
  /*
    The swipe. How far the row has been pulled, and where the finger
    started. Only a finger moving more across than down is a swipe; one
    moving more down is the list scrolling, and the row stays put.
  */
  const [swipeX, setSwipeX] = React.useState(0);
  const swipe = React.useRef<{
    x: number;
    y: number;
    mode: "undecided" | "swipe" | "scroll";
  } | null>(null);
  const onSwipeStart = (event: React.TouchEvent) => {
    const touchPoint = event.touches[0];
    if (!touchPoint) return;
    swipe.current = { x: touchPoint.clientX, y: touchPoint.clientY, mode: "undecided" };
  };
  const onSwipeMove = (event: React.TouchEvent) => {
    const start = swipe.current;
    const touchPoint = event.touches[0];
    if (!start || !touchPoint) return;
    const dx = touchPoint.clientX - start.x;
    const dy = touchPoint.clientY - start.y;
    if (start.mode === "undecided") {
      if (Math.abs(dx) < SWIPE_DECIDE_PX && Math.abs(dy) < SWIPE_DECIDE_PX) return;
      start.mode = Math.abs(dx) > Math.abs(dy) ? "swipe" : "scroll";
    }
    if (start.mode !== "swipe") return;
    // No archive out of Trash, and no snooze without a hand to take it.
    const allowRight = Boolean(onArchive);
    const allowLeft = Boolean(onSnooze);
    const bounded = Math.max(
      allowLeft ? -SWIPE_MAX_PX : 0,
      Math.min(allowRight ? SWIPE_MAX_PX : 0, dx)
    );
    setSwipeX(bounded);
  };
  const onSwipeEnd = () => {
    const start = swipe.current;
    swipe.current = null;
    const travelled = swipeX;
    setSwipeX(0);
    if (!start || start.mode !== "swipe") return;
    // The lift that ends a swipe is not a tap on the row.
    const row = rowRef.current;
    if (row) {
      row.dataset.suppressClick = "1";
      window.setTimeout(() => {
        delete row.dataset.suppressClick;
      }, 0);
    }
    if (travelled >= SWIPE_COMMIT_PX) onArchive?.();
    else if (travelled <= -SWIPE_COMMIT_PX && onSnooze) setSnoozeSignal((n) => n + 1);
  };
  const padX = inCard ? "px-4" : "px-5";
  const draftKeys = useThreadDraftKeys();
  const hasDraft = draftKeys.has(threadDraftKey(t.account, t.threadId));
  // A one-to-one keeps the face it always had. Only a group is a pile.
  const group = threadPeople(t);
  const people = group.isGroup
    ? group.named
    : [{ name: t.fromName, email: t.fromEmail }];
  /*
    Answered in a window of its own.

    The row's preview is a line of a conversation the reader already has
    open in front of them, so it says nothing they cannot see. The row
    keeps the name, the subject and the badge, and drops the rest.
  */
  const poppedOut = usePoppedOutKeys().has(
    popoutThreadKey(t.account, t.threadId)
  );
  const actionBtn = onNavy
    ? "rounded p-1 text-white/55 hover:bg-white/10 hover:text-white"
    : "rounded p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-800";
  /** One size for every quick action icon, so the row reads as one control. */
  const actionIcon = "h-4 w-4";
  const snoozeBtn = onNavy
    ? "inline-flex items-center gap-1 text-xs font-medium text-teal-300 hover:text-teal-200"
    : "inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-800";
  /** Hover shows the actions. An open snooze menu keeps them shown. */
  const rowActionsClass = cn(
    "shrink-0 items-center gap-0.5 group-hover:flex",
    snoozeOpen ? "flex" : "hidden"
  );
  /** The time, and the wake badge: what hover replaces with the actions. */
  const atRestClass = cn("shrink-0 group-hover:hidden", snoozeOpen && "hidden");
  const narrowTitle = [
    t.fromName,
    t.subject,
    hasDraft ? say("draft") : null,
    t.unread ? say("unread") : null,
  ]
    .filter(Boolean)
    .join(" — ");

  const rowActions = (
    <span
      className={rowActionsClass}
      onClick={(e) => e.stopPropagation()}
      // Enter on a button is that button's, not the row's — the row opens the
      // thread on Enter and would otherwise do both.
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        title={say(t.unread ? "markAsRead" : "markAsUnread")}
        aria-label={say(t.unread ? "markAsRead" : "markAsUnread")}
        className={actionBtn}
        onClick={onToggleRead}
      >
        {/* The same icon whichever way the click will go, and the same one
            the reader uses. A control that changes shape reads as two
            controls; the label says which way it goes. */}
        <MailDotIcon className={actionIcon} />
      </button>
      {onSnooze ? (
        <SnoozeMenu
          onSnooze={onSnooze}
          onCancelSnooze={onCancelSnooze}
          currentUntil={t.snoozedUntil}
          onOpenChange={setSnoozeOpen}
          // Snooze… on the right-click menu opens this one, so both ways
          // through end at the same list of times.
          openSignal={snoozeSignal}
          trigger={
            <button
              type="button"
              title={t.snoozedUntil ? say("changeSnooze") : say("snooze")}
              aria-label={t.snoozedUntil ? say("changeSnooze") : say("snooze")}
              className={actionBtn}
            >
              <RotateCwFadingClock className={actionIcon} />
            </button>
          }
        />
      ) : null}
      {/* Archive rather than pin.

          The three that hover shows are the three a reader does over and
          over on the way down a list: read it, put it off, put it away.
          Pinning is not one of those — it is done to the few conversations
          that are going to stay, and it stays done. It is still on the
          right-click menu, and now on the reader's own strip beside
          snooze, which is where it is wanted: on the conversation being
          read, not the one being passed over. */}
      {onArchive ? (
        <button
          type="button"
          title={say("actionArchive")}
          aria-label={say("actionArchive")}
          className={actionBtn}
          onClick={onArchive}
        >
          <Archive className={actionIcon} />
        </button>
      ) : null}
    </span>
  );

  return (
    <div
      ref={rowRef}
      data-thread-key={threadKey(t)}
      draggable={!touch}
      onTouchStart={touch ? onSwipeStart : undefined}
      onTouchMove={touch ? onSwipeMove : undefined}
      onTouchEnd={touch ? onSwipeEnd : undefined}
      onTouchCancel={touch ? onSwipeEnd : undefined}
      style={
        swipeX
          ? { transform: `translateX(${swipeX}px)`, transition: "none" }
          : undefined
      }
      onDragStart={(e) => {
        setMailThreadDragData(
          e.dataTransfer,
          { account: t.account, threadId: t.threadId },
          // The subject, or whoever it is from when there is none — enough
          // to know which conversation is in the air without covering the
          // folder it is being aimed at.
          t.subject?.trim() || t.fromName || t.fromEmail
        );
        if (dragKind === "pin") {
          e.dataTransfer.setData(
            "application/x-redd-mail-pin",
            JSON.stringify({ account: t.account, threadId: t.threadId })
          );
        }
      }}
      onDragEnd={() => {
        clearMailThreadDrag();
        // Dragend is followed by a click — swallow that one.
        const row = rowRef.current;
        if (!row) return;
        row.dataset.suppressClick = "1";
        window.setTimeout(() => {
          delete row.dataset.suppressClick;
        }, 0);
      }}
      role="button"
      tabIndex={0}
      title={narrow ? narrowTitle : undefined}
      aria-label={narrow ? narrowTitle : undefined}
      onClick={(e) => {
        if (rowRef.current?.dataset.suppressClick) {
          delete rowRef.current.dataset.suppressClick;
          return;
        }
        onOpen(e);
      }}
      onDoubleClick={(e) => {
        if (!onExpand) return;
        // A double click on a control inside the row is two presses of it.
        // The row is passed as the container because it is `role="button"`
        // itself, and so is the nearest control to everything in it.
        if (isInteractiveDoubleClickTarget(e.target, e.currentTarget)) return;
        e.preventDefault();
        onExpand();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuAt({ x: e.clientX, y: e.clientY });
      }}
      className={cn(
        "group relative flex cursor-grab transition-colors active:cursor-grabbing",
        // No ring of the browser's own. A row is focusable so the arrow keys
        // can carry focus with the selection, and the selection is already
        // painted — the ring drew a second, louder marker over the top of it,
        // clipped by the list into a line above and below the row.
        "outline-none focus:outline-none focus-visible:outline-none",
        narrow
          ? "items-center justify-center px-1 py-1.5"
          : wide
            ? compact
              ? cn("items-center gap-3 py-1.5", padX)
              : cn("items-start gap-3 py-2", padX)
            : compact
              ? cn("items-center gap-2.5 py-1.5", padX)
              : cn("items-start gap-3 py-3", padX),
        /*
          The open thread, said twice: a fill, and a bar down the left.

          Light fills it white, because the list is cream and the plainest
          surface reads as the one being attended to. Dark cannot do that —
          white there is a hole — so it takes a tenth of the accent, which
          is the same colour as the bar. Either way the fill is a colour and
          the hover is a grey, so a row you are pointing at is never read as
          a row you have opened.
        */
        // The ring between the discs of a group's avatar is the row's own
        // fill, so the discs look cut out of it. The open row's fill in dark
        // is a tint you can see through, and a ring has to be solid — see
        // --mail-row-selected-solid.
        selected
          ? "bg-[var(--mail-row-selected)] [--mail-person-stack-ring:var(--mail-row-selected-solid)]"
          : "hover:bg-[var(--mail-row-hover)] hover:[--mail-person-stack-ring:var(--mail-row-hover)]",
        selected &&
          "before:absolute before:inset-y-0 before:left-0 before:w-[4px] before:rounded-r-[1px] before:bg-[var(--mail-accent)]"
      )}
    >
      {/* What the swipe uncovers: the action it is about to take, in the
          gap the row leaves behind. It travels the other way, so it
          stands still on the screen while the row moves off it. */}
      {swipeX > 0 ? (
        <span
          aria-hidden
          className="mail-row-swipe absolute inset-y-0 flex items-center justify-start bg-teal-600 pl-4 text-white"
          style={{ left: -swipeX, width: swipeX }}
        >
          <Archive className={cn("h-5 w-5", swipeX >= SWIPE_COMMIT_PX ? "opacity-100" : "opacity-50")} />
        </span>
      ) : swipeX < 0 ? (
        <span
          aria-hidden
          className="mail-row-swipe absolute inset-y-0 flex items-center justify-end bg-amber-500 pr-4 text-white"
          style={{ right: swipeX, width: -swipeX }}
        >
          <Clock className={cn("h-5 w-5", -swipeX >= SWIPE_COMMIT_PX ? "opacity-100" : "opacity-50")} />
        </span>
      ) : null}
      {/* Everybody on the thread, as the person view draws them: one face
          for a one-to-one, a pile for a group. */}
      <PeopleAvatar
        people={people}
        logoEmail={t.fromEmail}
        logoUrl={t.crmLogoUrl}
        unread={t.unread}
        onNavy={onNavy}
        size={!narrow && !wide && compact ? 28 : 36}
      />
      {narrow ? null : wide ? (
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-3">
            <p
              className={cn(
                "w-[10rem] shrink-0 truncate text-sm font-semibold",
                onNavy ? "text-white" : "text-stone-900"
              )}
            >
              <Highlighted text={t.fromName} terms={highlight} onNavy={onNavy} />
            </p>
            {hasDraft ? <DraftBadge /> : null}
            {compact && t.hasCalendarInvite ? (
              <span
                className="inline-flex shrink-0"
                title={t.calendarInviteWhen || "Calendar invite"}
              >
                <Calendar
                  className={cn(
                    "h-3.5 w-3.5 stroke-[1.5]",
                    "text-[var(--mail-chrome-muted)] opacity-80"
                  )}
                  aria-hidden
                />
              </span>
            ) : null}
            {compact && t.hasAttachments ? (
              <span
                className={cn(
                  "inline-flex shrink-0",
                  t.hasCalendarInvite ? "-ml-[5px]" : "-ml-0.5"
                )}
                title={say("hasAttachments")}
              >
                <Paperclip
                  className={cn(
                    "h-3.5 w-3.5 stroke-[1.5]",
                    "text-[var(--mail-chrome-muted)]"
                  )}
                  aria-hidden
                />
              </span>
            ) : null}
            <p className="min-w-0 flex-1 truncate text-sm">
              <span
                className={cn(
                  t.unread && "font-semibold",
                  onNavy ? "text-white/85" : "text-stone-700"
                )}
              >
                <Highlighted text={t.subject} terms={highlight} onNavy={onNavy} />
              </span>
              {compact && t.snippet && !poppedOut ? (
                <span className={onNavy ? "text-white/45" : "text-[#908985]"}>
                  {" — "}
                  <Highlighted text={t.snippet} terms={highlight} onNavy={onNavy} />
                </span>
              ) : null}
            </p>
            {poppedOut ? <PoppedOutBadge /> : null}
            <ThreadMessageCount
              count={t.messageCount}
              label={say("threadMessageMany", { count: t.messageCount })}
            />
            {t.snoozedUntil && onSnooze ? (
              <span
                className={atRestClass}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <SnoozeMenu
                  onSnooze={onSnooze}
                  onCancelSnooze={onCancelSnooze}
                  currentUntil={t.snoozedUntil}
                  trigger={
                    <button
                      type="button"
                      className={snoozeBtn}
                      title={say("changeSnooze")}
                    >
                      <Clock className="h-3 w-3" aria-hidden />
                      {formatSnoozeWakeLabel(t.snoozedUntil)}
                    </button>
                  }
                />
              </span>
            ) : (
              <p
                className={cn(
                  atRestClass,
                  "w-[4.5rem] text-right text-xs tabular-nums",
                  withYear && "w-[6rem]",
                  onNavy ? "text-white/40" : "text-stone-400"
                )}
              >
                {rowTime(t.lastAt, { withYear })}
              </p>
            )}
            {rowActions}
          </div>
          {compact ||
          poppedOut ||
          !(t.snippet || t.hasCalendarInvite || t.hasAttachments) ? null : (
            <div className="flex min-w-0 items-center gap-3">
              <span className="w-[10rem] shrink-0" aria-hidden />
              {t.hasCalendarInvite ? (
                <span
                  className="inline-flex shrink-0"
                  title={t.calendarInviteWhen || "Calendar invite"}
                >
                  <Calendar
                    className={cn(
                      "h-3.5 w-3.5 stroke-[1.5]",
                      "text-[var(--mail-chrome-muted)] opacity-80"
                    )}
                    aria-hidden
                  />
                </span>
              ) : null}
              {t.hasAttachments ? (
                <span
                  className={cn(
                    "inline-flex shrink-0",
                    t.hasCalendarInvite ? "-ml-[5px]" : "-ml-0.5"
                  )}
                  title={say("hasAttachments")}
                >
                  <Paperclip
                    className={cn(
                      "h-3.5 w-3.5 stroke-[1.5]",
                      "text-[var(--mail-chrome-muted)]"
                    )}
                    aria-hidden
                  />
                </span>
              ) : null}
              <p
                className={cn(
                  "min-w-0 flex-1 truncate text-xs",
                  onNavy ? "text-white/45" : "text-[#908985]"
                )}
              >
                <Highlighted text={t.snippet} terms={highlight} onNavy={onNavy} />
              </p>
              <span
                className={cn(
                  "w-[4.5rem] shrink-0",
                  withYear && "w-[6rem]"
                )}
                aria-hidden
              />
            </div>
          )}
        </div>
      ) : compact ? (
        <>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <p
              className={cn(
                "max-w-[34%] shrink-0 truncate text-sm font-semibold",
                onNavy ? "text-white" : "text-stone-900"
              )}
            >
              <Highlighted text={t.fromName} terms={highlight} onNavy={onNavy} />
            </p>
            {hasDraft ? <DraftBadge /> : null}
            {t.hasCalendarInvite ? (
              <span
                className="inline-flex shrink-0"
                title={t.calendarInviteWhen || "Calendar invite"}
              >
                <Calendar
                  className={cn(
                    "h-3.5 w-3.5 stroke-[1.5]",
                    // A shade lighter than the grey it is drawn in. These
                    // are asides on a row whose subject is the point.
                    "text-[var(--mail-chrome-muted)] opacity-80"
                  )}
                  aria-hidden
                />
              </span>
            ) : null}
            {t.hasAttachments ? (
              <span
                className={cn(
                  "inline-flex shrink-0",
                  // Closer to what is before it than the row's own gap: the
                  // clip is a mark on the row, not another item in the
                  // line. Closer again behind the calendar, because there
                  // the two are one aside about the same thread.
                  t.hasCalendarInvite ? "-ml-[5px]" : "-ml-0.5"
                )}
                title={say("hasAttachments")}
              >
                <Paperclip
                  className={cn(
                    "h-3.5 w-3.5 stroke-[1.5]",
                    // The same grey as the calendar mark, and as the
                    // headings in the folder rail. Both say the same kind
                    // of thing about a thread — it carries something — and
                    // neither is worth a colour of its own on a list where
                    // teal already means the thread is the open one.
                    "text-[var(--mail-chrome-muted)]"
                  )}
                  aria-hidden
                />
              </span>
            ) : null}
            <p
              className={cn(
                "min-w-0 flex-1 truncate text-sm",
                t.unread && "font-semibold",
                onNavy ? "text-white/70" : "text-stone-600"
              )}
            >
              <Highlighted text={t.subject} terms={highlight} onNavy={onNavy} />
            </p>
          </div>
          <ThreadMessageCount
            count={t.messageCount}
            label={say("threadMessageMany", { count: t.messageCount })}
          />
          {t.snoozedUntil && onSnooze ? (
            <span
              className={atRestClass}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <SnoozeMenu
                onSnooze={onSnooze}
                onCancelSnooze={onCancelSnooze}
                currentUntil={t.snoozedUntil}
                trigger={
                  <button
                    type="button"
                    className={snoozeBtn}
                    title={say("changeSnooze")}
                  >
                    <Clock className="h-3 w-3" aria-hidden />
                    {formatSnoozeWakeLabel(t.snoozedUntil)}
                  </button>
                }
              />
            </span>
          ) : (
            <p
              className={cn(
                atRestClass,
                "text-xs",
                onNavy ? "text-white/40" : "text-stone-400"
              )}
            >
              {rowTime(t.lastAt, { withYear })}
            </p>
          )}
          {rowActions}
        </>
      ) : (
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-1.5">
              <p
                className={cn(
                  "min-w-0 truncate text-sm font-semibold",
                  onNavy ? "text-white" : "text-stone-900"
                )}
              >
                <Highlighted text={t.fromName} terms={highlight} onNavy={onNavy} />
              </p>
              {hasDraft ? <DraftBadge /> : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
            <ThreadMessageCount
              count={t.messageCount}
              label={say("threadMessageMany", { count: t.messageCount })}
            />
            {/* At rest: time (or wake time). On hover: read / snooze / pin. */}
            {t.snoozedUntil && onSnooze ? (
              <span
                className={atRestClass}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <SnoozeMenu
                  onSnooze={onSnooze}
                  onCancelSnooze={onCancelSnooze}
                  currentUntil={t.snoozedUntil}
                  trigger={
                    <button
                      type="button"
                      className={snoozeBtn}
                      title={say("changeSnooze")}
                    >
                      <Clock className="h-3 w-3" aria-hidden />
                      {formatSnoozeWakeLabel(t.snoozedUntil)}
                    </button>
                  }
                />
              </span>
            ) : (
              <p
                className={cn(
                  atRestClass,
                  "text-xs",
                  onNavy ? "text-white/40" : "text-stone-400"
                )}
              >
                {rowTime(t.lastAt, { withYear })}
              </p>
            )}
            {rowActions}
            </div>
          </div>
          <p
            className={cn(
              "mt-0.5 truncate text-sm",
              t.unread && "font-semibold",
              onNavy ? "text-white/85" : "text-stone-700"
            )}
          >
            <Highlighted text={t.subject} terms={highlight} onNavy={onNavy} />
          </p>
          <p
            className={cn(
              "mt-0.5 flex min-w-0 items-center gap-1.5 text-xs",
              onNavy ? "text-white/45" : "text-[#908985]"
            )}
          >
            {t.hasCalendarInvite ? (
              <span
                className={cn(
                  "inline-flex max-w-[55%] shrink-0 items-center gap-1 truncate rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                  onNavy
                    ? "border-white/15 bg-white/10 text-white/70"
                    : "border-stone-200 bg-[#f4f1ec] text-stone-600"
                )}
                title={t.calendarInviteWhen || "Calendar invite"}
              >
                <Calendar
                  className={cn(
                    "h-3 w-3 shrink-0 stroke-[1.5]",
                    "text-[var(--mail-chrome-muted)] opacity-80"
                  )}
                  aria-hidden
                />
                <span className="truncate">
                  {t.calendarInviteWhen || "Invite"}
                </span>
              </span>
            ) : null}
            {t.hasAttachments ? (
              <span
                className={cn(
                  "inline-flex shrink-0",
                  // Closer to what is before it than the row's own gap: the
                  // clip is a mark on the row, not another item in the
                  // line. Closer again behind the calendar, because there
                  // the two are one aside about the same thread.
                  t.hasCalendarInvite ? "-ml-[5px]" : "-ml-0.5"
                )}
                title={say("hasAttachments")}
              >
                <Paperclip
                  className={cn(
                    "h-3 w-3 shrink-0 stroke-[1.5]",
                    "text-[var(--mail-chrome-muted)] opacity-80"
                  )}
                  aria-hidden
                />
              </span>
            ) : null}
            <span className="min-w-0 truncate"><Highlighted text={t.snippet} terms={highlight} onNavy={onNavy} /></span>
          </p>
        </div>
      )}
      {menuAt ? (
        <ThreadRowMenu
          x={menuAt.x}
          y={menuAt.y}
          unread={Boolean(t.unread)}
          pinned={pinned}
          snoozed={Boolean(t.snoozedUntil)}
          /* Everyone on it but us. One of them is who Reply writes to, so
             it takes two before Reply all reaches anybody more — the same
             answer the reader works out from the message itself. */
          canReplyAll={(t.externalParticipants?.length ?? 0) > 1}
          folders={folders ?? []}
          onAction={onAction}
          onSnooze={onSnooze ? () => setSnoozeSignal((n) => n + 1) : undefined}
          onCancelSnooze={onCancelSnooze}
          onToggleRead={onToggleRead}
          onTogglePin={onTogglePin}
          onMoveToFolder={onMoveToFolder}
          onJunk={onJunk}
          onNotJunk={onNotJunk}
          onRestore={onRestore}
          onDeleteForever={onDeleteForever}
          onArchive={onArchive}
          onTrash={onTrash}
          onDismiss={() => setMenuAt(null)}
          touch={touch}
        />
      ) : null}
    </div>
  );
}




/**
 * Connect affordances. The host decides what a sign-in actually does: the
 * planner sends the user to its OAuth routes, the standalone product runs the
 * flow itself. See `@/lib/mail/connect-mailbox`.
 */
