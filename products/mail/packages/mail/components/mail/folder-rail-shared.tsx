"use client";

/*
 * What the folder rail's parts share: its drag types and the chip in the air,
 * the timings, the icons by role, the props of the rail, and the hook that
 * tracks a drag over a row. The rules for a drop are in lib/mail/folder-drop.
 *
 * The rail itself is MailFolderRail.tsx; its rows and menus are
 * folder-rail-rows.tsx.
 */

import * as React from "react";
import { Archive, FilePen, Inbox, Send, ShieldAlert, Trash2 } from "lucide-react";
import { type MailAccountFolder } from "@/lib/mail/folder-types";

/**
 * How long a collapsed folder waits under the pointer before it opens.
 *
 * Long enough that crossing one on the way somewhere else does not throw
 * its contents into the path, short enough that stopping on it reads as
 * asking. The same idea as a spring-loaded folder in the Finder.
 */
export const SPRING_OPEN_MS = 600;

/** Its own drag type, so nothing that takes threads mistakes one for one. */
export const MAIL_FOLDER_DRAG_TYPE = "application/x-redd-mail-folder";
export const MAIL_ACCOUNT_DRAG_TYPE = "application/x-redd-mail-account";

/**
 * A chip naming the folder in the air.
 *
 * The browser's own ghost of the row is a wide pale slab, and a wide pale
 * slab is hard to tell from no drag at all — which matters here, because
 * "it did not pick up" and "it picked up and nothing would take it" look
 * the same from the outside and want different fixes.
 */
let folderDragChip: HTMLElement | null = null;

/** The chip is only litter once the drag is over. */
export function clearFolderDragImage(): void {
  folderDragChip?.remove();
  folderDragChip = null;
}

export function setFolderDragImage(dt: DataTransfer, label: string): void {
  if (typeof document === "undefined") return;
  clearFolderDragImage();
  const chip = document.createElement("div");
  chip.textContent = label;
  chip.setAttribute(
    "style",
    [
      "position:fixed",
      "top:-1000px",
      "left:-1000px",
      "max-width:170px",
      "overflow:hidden",
      "text-overflow:ellipsis",
      "white-space:nowrap",
      "padding:3px 9px",
      "border-radius:9999px",
      "background:rgba(26,39,53,0.72)",
      "color:#fff",
      "font:600 11px/1.35 ui-sans-serif,-apple-system,system-ui,sans-serif",
    ].join(";")
  );
  document.body.appendChild(chip);
  folderDragChip = chip;
  try {
    dt.setDragImage(chip, 6, chip.offsetHeight + 8);
  } catch {
    // Some shells refuse a custom image; the default is only ugly.
  }
  // Taken away at dragend, not on the next tick. WebKit reads the element
  // after the handler returns, and pulling it out from under the drag is
  // one of the ways a drag dies the instant it begins.
}

/**
 * How long a folder is pointed at after being taken off the favourites.
 *
 * Long enough to find after the scroll settles, short enough that it is
 * gone before it becomes something to dismiss.
 */
/** Long enough to find the folder after the rail has scrolled to it. */
export const REVEAL_MS = 2400;

/**
 * Where the views go two abreast.
 *
 * Two 6.5rem columns and the half-rem gap between them come to 216, which
 * is what this was. It waited too long: the rail has room for two columns
 * before it has room for two comfortable ones, and a rail dragged narrow is
 * one asking for the list to get shorter. Thirty less, so the second column
 * arrives while the rail is still wide enough to read.
 */
export const SYSTEM_TWO_UP_WIDTH = 186;

/** The box a row scrolls inside, or null when nothing around it scrolls. */
export function scrollingAncestor(row: HTMLElement): HTMLElement | null {
  let node = row.parentElement;
  while (node) {
    const overflow = getComputedStyle(node).overflowY;
    if (
      (overflow === "auto" || overflow === "scroll") &&
      node.scrollHeight > node.clientHeight + 1
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * The four the provider manages, drawn as themselves.
 *
 * A manila folder against Sent and Deleted would say they are the same kind
 * of thing as ScanSoc, and they are not — the same glyphs as the unified
 * rows at the top of the rail, which are these same places with every
 * mailbox at once rather than one.
 */
export const ROLE_ICON = {
  inbox: Inbox,
  archive: Archive,
  drafts: FilePen,
  sent: Send,
  junk: ShieldAlert,
  trash: Trash2,
} as const;

/**
 * The heart the to-do app draws, drawn here.
 *
 * Not lucide's. Lucide's is two arcs over a near-triangle — straight edges
 * down to a tip rounded to two units — and at fourteen pixels it reads as
 * a spade with sharp shoulders. The to-do app has never used it: it keeps
 * its own path, the older rounder one, and since the point of a heart here
 * is that a favourite means the same thing in both apps, it should be the
 * same heart and not merely the same idea of one.
 *
 * Copied rather than shared because the two are separate packages with no
 * icon between them. If either changes, this comment is the thread back:
 * the original is `HeartIcon` in the to-do app's TodoPage.
 */
export function HeartIcon({
  filled,
  className,
}: {
  filled: boolean;
  className?: string;
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={className}
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

/** Which of the unified views is showing, if any. */
export type MailSystemView =
  | "inbox"
  | "sent"
  | "drafts"
  | "trash"
  | "junk"
  | "archived"
  | null;

/** The folder the list is showing, and the mailbox it was opened from. */
export type OpenFolder = { account: string | null; name: string } | null;

export type FolderRailProps = {
  accountFolders: MailAccountFolder[];
  loading: boolean;
  /** Mailboxes with no folders still get a heading, so the rail is complete. */
  accounts: string[];
  openFolder: OpenFolder;
  systemView: MailSystemView;
  draftCount?: number | null;
  onOpenFolder: (account: string, name: string) => void;
  onOpenSent: () => void;
  onOpenDrafts: () => void;
  onOpenTrash: () => void;
  onOpenInbox: () => void;
  onOpenJunk: () => void;
  onOpenArchived: () => void;
  onCreateFolder: (account: string, name: string) => Promise<void>;
  /** `name` and `newName` are whole paths, so a nested folder stays nested. */
  onRenameFolder: (
    account: string,
    name: string,
    newName: string
  ) => Promise<void>;
  onDeleteFolder: (account: string, name: string) => Promise<void>;
  /**
   * Put one mailbox in front of another, or last when `before` is null.
   *
   * The rail says which two; what that means to a store — an order kept per
   * provider, with the hidden mailboxes in it — is the host's to know.
   */
  onReorderAccount?: (
    moved: string,
    before: string | null
  ) => void | Promise<void>;
  /**
   * The mailbox a conversation is being dragged from, or null when nothing
   * is being dragged. Everything the drop rules turn on comes from this one
   * value — see `dropState` below.
   */
  draggingAccount: string | null;
  onDropThread: (account: string, folderName: string) => void | Promise<void>;
  /** Dragging onto Trash deletes; onto Junk marks as junk. Both are moves. */
  onDropTrash: () => void | Promise<void>;
  /** Filing a conversation as junk from the rail. */
  onDropJunk?: () => void | Promise<void>;
  /** Putting one back in its own mailbox's inbox. */
  onDropInbox?: () => void | Promise<void>;
  /**
   * Which side of the window the rail is against.
   *
   * It follows the mail list: with the list on the right, the folders are on
   * the right of it, so the edge that faces the rest of the app — and takes
   * the border — is the left one.
   */
  side?: "left" | "right";
};

/**
 * Is the dragged thing over this row, counting its children as the row?
 *
 * `dragenter` and `dragleave` fire for every element the pointer crosses,
 * not only the one the handler sits on — so moving from a row's name to its
 * star fires a leave and then an enter, and a highlight driven straight off
 * those blinks off and on as the pointer travels along a row it is already
 * resting on. That is what made the folders look as though they were lit at
 * the wrong moment, or somewhere slightly other than the pointer.
 *
 * So the arrivals are counted rather than watched, and the row under the
 * pointer is held as one name for the whole rail rather than as a flag on
 * each row.
 *
 * One name, because counting alone let two rows light at once. Rows move
 * under a pointer that has not moved — a folded folder springs open above
 * them, the other mailboxes shut when the drag begins — and a row that
 * slides out from under the pointer is never sent a leave for the count to
 * balance. It simply stayed lit while the row that took its place lit too.
 * Whoever is entered last holds the name, and holding it takes it off
 * whoever had it, whether or not their leave ever arrives.
 */
export function useDragOver(opts: {
  id: string;
  over: string | null;
  setOver: React.Dispatch<React.SetStateAction<string | null>>;
}) {
  const { id, setOver } = opts;
  const depth = React.useRef(0);
  const over = opts.over === id;

  const reset = React.useCallback(() => {
    depth.current = 0;
    setOver((current) => (current === id ? null : current));
  }, [id, setOver]);

  /** @returns true when this is the pointer arriving, not moving within. */
  const onEnter = React.useCallback(() => {
    depth.current += 1;
    // Claim it outright. Whichever row held it before is let go by the
    // same stroke, which is the half a per-row count cannot do.
    setOver(id);
    return depth.current === 1;
  }, [id, setOver]);

  const onLeave = React.useCallback(() => {
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) {
      setOver((current) => (current === id ? null : current));
    }
  }, [id, setOver]);

  return { over, onEnter, onLeave, reset };
}
