"use client";

/**
 * The folder rail: every folder on every mailbox, down the left of the list.
 *
 * It replaces a dropdown that had to be opened, read, and dismissed for
 * each filing. A rail is open or it is not, and while it is, filing a
 * conversation is one motion — pick it up, drop it on a folder already in
 * front of you. That only works if the folder is on screen before the drag
 * starts, which is the whole argument for a rail over a menu.
 *
 * Top to bottom:
 *
 *   Sent · Drafts · Trash · Junk   one set, across every mailbox
 *   ★ Favourites                   folders pinned here, mailboxes mixed
 *   Filter folders…                narrows the sections, not the views
 *   one headed section per mailbox, each a real tree
 *
 * The order is the argument. The four views at the top are the same four
 * for everybody and never move. What is below them is the reader's own
 * filing, which is theirs and is different on every machine.
 */

import * as React from "react";
import {
  Archive,
  ChevronRight,
  FilePen,
  Folder,
  FolderInput,
  FolderPlus,
  Home,
  Inbox,
  Loader2,
  Pencil,
  Send,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { toast } from "@/lib/mail/toast";

import {
  buildFolderTree,
  filterFolderTree,
  flattenFolderTree,
  folderAncestors,
  type FolderTreeNode,
} from "@/lib/mail/folder-tree";
import {
  collapsedAccountKey,
  collapsedFolderKey,
  readCollapsedAccounts,
  readCollapsedFolders,
  writeCollapsedAccounts,
  writeCollapsedFolders,
} from "@/lib/mail/folder-rail";
import {
  folderFavouriteKey,
  pruneFolderFavourites,
  toggleFolderFavourite,
  useFolderFavourites,
} from "@/lib/mail/folder-favourites";
import { accountsWithFolders, type MailAccountFolder } from "@/lib/mail/folder-types";
import {
  accountDropPlace,
  type AccountSpan,
} from "@/lib/mail/account-order";
import { useIsOutlookAccount } from "@/lib/mail/use-outlook-accounts";
import { useMailT } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";

/**
 * How long a collapsed folder waits under the pointer before it opens.
 *
 * Long enough that crossing one on the way somewhere else does not throw
 * its contents into the path, short enough that stopping on it reads as
 * asking. The same idea as a spring-loaded folder in the Finder.
 */
const SPRING_OPEN_MS = 600;

/** Its own drag type, so nothing that takes threads mistakes one for one. */
const MAIL_FOLDER_DRAG_TYPE = "application/x-redd-mail-folder";
const MAIL_ACCOUNT_DRAG_TYPE = "application/x-redd-mail-account";

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
function clearFolderDragImage(): void {
  folderDragChip?.remove();
  folderDragChip = null;
}

function setFolderDragImage(dt: DataTransfer, label: string): void {
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
const REVEAL_MS = 2400;

/**
 * Where the views go two abreast.
 *
 * Two 6.5rem columns and the half-rem gap between them come to 216, which
 * is what this was. It waited too long: the rail has room for two columns
 * before it has room for two comfortable ones, and a rail dragged narrow is
 * one asking for the list to get shorter. Thirty less, so the second column
 * arrives while the rail is still wide enough to read.
 */
const SYSTEM_TWO_UP_WIDTH = 186;

/** The box a row scrolls inside, or null when nothing around it scrolls. */
function scrollingAncestor(row: HTMLElement): HTMLElement | null {
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
const ROLE_ICON = {
  inbox: Inbox,
  archive: Archive,
  drafts: FilePen,
  sent: Send,
  junk: ShieldAlert,
  trash: Trash2,
} as const;

/**
 * Nobody files into Sent or Drafts.
 *
 * The same rule as the unified rows above, where those two dim mid-drag —
 * and it has to hold here too, or the rule reads as "mail cannot go in
 * Sent, unless you scroll down to the other Sent".
 */
const ROLE_REFUSES_DROP = new Set<string>(["sent", "drafts"]);

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
function HeartIcon({
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

/**
 * A folder being carried to a new parent.
 *
 * Its own channel, not the thread one: the rail refuses a thread wherever
 * a folder may go and the other way about, and one flag standing for both
 * would have each answering the other's question.
 */
type FolderDrag = { account: string; name: string; label: string };

/** Everything above this folder in its own name, or "" at the top. */
function folderParentPath(name: string): string {
  return name.split("/").slice(0, -1).join("/");
}

/**
 * May this folder be dropped into that one?
 *
 * The same mailbox, because a folder is a place on a mailbox and there is
 * no moving it to another. Not into itself, and not into anything already
 * inside it — a folder cannot hold the folder that holds it, and asked to
 * do that a provider loses the subtree. And not into the parent it already
 * has, which would be a rename to the name it already has.
 *
 * A stand-in parent takes one. It is drawn for a name that has children in
 * the list but no row of its own, and the commonest of those is the
 * Outlook inbox: the rail leaves it out because the list beside it is the
 * inbox already, and people file real folders under it all the same. The
 * move is a rename — `Inbox/Receipts` — and the provider resolves the
 * parent by path against its own tree, where the inbox is a folder like
 * any other. A search row still refuses: there is nothing behind it.
 */
function folderAcceptsFolder(drag: FolderDrag, node: FolderTreeNode): boolean {
  if (node.virtual) return false;
  if (drag.account.toLowerCase() !== node.account.toLowerCase()) return false;
  const from = drag.name.toLowerCase();
  const to = node.name.toLowerCase();
  if (from === to || to.startsWith(`${from}/`)) return false;
  return folderParentPath(from).toLowerCase() !== to;
}

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
function useDragOver(opts: {
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

/**
 * What a row does while a conversation is in the air.
 *
 * "live" takes the drop. "dim" is still readable and refuses it — the row
 * keeps its place either way, because a rail that reshuffles mid-drag moves
 * the folder the reader was aiming at.
 */
type DropState = "rest" | "live" | "dim";

/** ── the four views at the top ─────────────────────────────────────────── */

function SystemRow({
  icon: Icon,
  label,
  count,
  active,
  drop,
  dragOver,
  setDragOver,
  onClick,
  onDropThread,
  onContextMenu,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count?: number | null;
  active: boolean;
  drop: DropState;
  dragOver: string | null;
  setDragOver: React.Dispatch<React.SetStateAction<string | null>>;
  onClick: () => void;
  onDropThread?: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
}) {
  const takesDrop = drop === "live" && Boolean(onDropThread);
  const { over, onEnter, onLeave, reset } = useDragOver({
    id: `view:${label}`,
    over: dragOver,
    setOver: setDragOver,
  });
  return (
    <button
      type="button"
      aria-current={active ? "true" : undefined}
      // In two columns a long name is clipped — "Uønsket post" is the one —
      // so the whole of it is a hover away.
      title={label}
      className={cn(
        // py-1, and no gap between them: the four are one block naming the
        // four places every mailbox has, and spaced like separate things
        // they took as much room as the whole of somebody's filing.
        "flex w-full items-center gap-2 rounded-md py-1 pl-2 pr-1 text-left text-sm",
        // The same navy as the folder button wears while the rail is
        // pinned. A pale wash was easy to miss on a rail of forty rows —
        // the one row that says where you are has to be the one row you
        // cannot read past.
        active
          ? "bg-[var(--mail-chrome-pinned)] font-semibold text-[var(--mail-chrome-pinned-fg)]"
          // The same hover as a row in the thread list. Both are lists of
          // rows on the same chrome, and a stone grey laid over cream reads
          // faintly green beside it.
          : "text-stone-800 hover:bg-[var(--mail-chrome-hover)]",
        // Dimmed rather than hidden. Mid-drag nothing may move, and a row
        // that vanishes takes every row below it up by its own height.
        drop === "dim" && "pointer-events-none opacity-35",
        over && takesDrop && "bg-teal-500 text-white"
      )}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDragOver={(e) => {
        if (!takesDrop) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDragEnter={(e) => {
        if (!takesDrop) return;
        e.preventDefault();
        onEnter();
      }}
      onDragLeave={onLeave}
      onDrop={(e) => {
        if (!takesDrop) return;
        e.preventDefault();
        e.stopPropagation();
        reset();
        onDropThread?.();
      }}
    >
      <Icon
        className={cn(
          "h-4 w-4 shrink-0",
          active
            ? "text-[var(--mail-chrome-pinned-fg)]"
            : "text-stone-400",
          over && takesDrop && "text-white"
        )}
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count ? (
        <span
          className={cn(
            "shrink-0 tabular-nums text-xs",
            over && takesDrop
              ? "text-white/80"
              : active
                ? "text-[var(--mail-chrome-pinned-fg)] opacity-70"
                : "text-stone-400"
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

/** ── one folder row, in the tree or in favourites ──────────────────────── */

function FolderRow({
  node,
  depth,
  collapsed,
  hasChildren,
  active,
  favourite,
  drop,
  folderDrag,
  onFolderDragStart,
  onFolderDragEnd,
  onFolderDrop,
  dragOver,
  setDragOver,
  accountTag,
  inFavourites,
  revealed,
  renaming,
  busy,
  onOpen,
  onToggleCollapse,
  onToggleFavourite,
  onDropThread,
  onSpringOpen,
  onContextMenu,
  onRenameSubmit,
  onRenameCancel,
}: {
  node: FolderTreeNode;
  depth: number;
  collapsed: boolean;
  hasChildren: boolean;
  active: boolean;
  favourite: boolean;
  drop: DropState;
  /** A folder being carried, or null. It answers instead of `drop` while set. */
  folderDrag: FolderDrag | null;
  onFolderDragStart: (drag: FolderDrag) => void;
  onFolderDragEnd: () => void;
  onFolderDrop: (target: FolderTreeNode) => void;
  dragOver: string | null;
  setDragOver: React.Dispatch<React.SetStateAction<string | null>>;
  /** Shown in the favourites band, where the mailboxes are mixed. */
  accountTag?: string;
  /** This row is in the favourites band, where being a favourite is given. */
  inFavourites?: boolean;
  /** Just arrived back in the list, and being pointed at for a moment. */
  revealed?: boolean;
  /** This row is being renamed: the name is a box rather than a label. */
  renaming?: boolean;
  /** The provider is being asked to move or rename it, and has not answered. */
  busy?: boolean;
  onOpen: () => void;
  onToggleCollapse: () => void;
  onToggleFavourite: () => void;
  onDropThread: () => void;
  onSpringOpen: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
  onRenameSubmit?: (nextLabel: string) => void;
  onRenameCancel?: () => void;
}) {
  const t = useMailT();
  const springRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // A row standing for a search has no folder behind it to file into, and
  // "Archived" is not somewhere you put mail in any case — you archive it.
  const refuses =
    node.virtual || Boolean(node.role && ROLE_REFUSES_DROP.has(node.role));
  /**
   * While a folder is being carried, that is the only question being asked
   * — so it answers instead of the thread rules rather than alongside
   * them, and a row that will not take the folder dims the way a foreign
   * mailbox dims for a thread.
   */
  const carrying = folderDrag !== null;
  const beingCarried =
    carrying &&
    folderDrag.account.toLowerCase() === node.account.toLowerCase() &&
    folderDrag.name.toLowerCase() === node.name.toLowerCase();
  const state: DropState = carrying
    ? folderAcceptsFolder(folderDrag, node)
      ? "live"
      : "dim"
    : drop;
  // A conversation cannot be filed into a stand-in parent: the rail knows
  // the name but not what is behind it, and on Gmail there is often
  // nothing. A folder can — see `folderAcceptsFolder`, where the move goes
  // through the provider's own tree rather than this one.
  const takesDrop = carrying
    ? state === "live"
    : drop === "live" && !node.implied && !refuses;
  const { over, onEnter, onLeave, reset } = useDragOver({
    id: folderFavouriteKey(node.account, node.name),
    over: dragOver,
    setOver: setDragOver,
  });
  const RowIcon = node.role ? ROLE_ICON[node.role] : Folder;
  /** A stand-in parent and a search are not folders anybody can move. */
  const canMoveThisFolder =
    !node.implied && !node.virtual && !renaming && !busy;

  /**
   * Picking the folder up.
   *
   * Set on the row and again on the name inside it. A drag begun on a
   * descendant is meant to find the draggable ancestor on its own, and in
   * this webview it does not — the name is what a hand actually lands on,
   * so the name says it is draggable too.
   */
  const startFolderDrag = (event: React.DragEvent) => {
    if (!canMoveThisFolder) return;
    event.stopPropagation();
    event.dataTransfer.setData(MAIL_FOLDER_DRAG_TYPE, node.name);
    // text/plain as well.
    //
    // The thread drag has always set both, and threads drag. WebKit will
    // not begin a drag carrying nothing it recognises, so a payload under
    // a name only this app knows is, to the browser, an empty drag.
    event.dataTransfer.setData("text/plain", `redd-mail-folder:${node.name}`);
    event.dataTransfer.effectAllowed = "move";
    setFolderDragImage(event.dataTransfer, node.label);
    /**
     * Told after the handler has returned, not during it.
     *
     * This sets state on the rail, which re-renders the row being dragged.
     * A drag whose source element is rebuilt underneath it is cancelled on
     * the spot — dragstart, then dragend, with nothing in between, which is
     * exactly what the trace showed.
     */
    const drag = {
      account: node.account,
      name: node.name,
      label: node.label,
    };
    window.setTimeout(() => onFolderDragStart(drag), 0);
  };

  const cancelSpring = React.useCallback(() => {
    if (springRef.current) {
      clearTimeout(springRef.current);
      springRef.current = null;
    }
  }, []);

  React.useEffect(() => cancelSpring, [cancelSpring]);

  return (
    <div
      data-folder-row={folderFavouriteKey(node.account, node.name)}
      draggable={canMoveThisFolder}
      onDragStart={startFolderDrag}
      onDragEnd={() => {
        clearFolderDragImage();
        onFolderDragEnd();
      }}
      className={cn(
        "group relative flex items-center rounded-md transition-shadow duration-200",
        // select-none, or the gesture is read as a text selection and the
        // drag never starts: pulling a folder highlighted its name and the
        // name of whatever it was pulled across. A name in a tree is
        // something to point at rather than something to copy, so nothing
        // is lost in making it unselectable — and a pull is left with only
        // one thing it can mean.
        //
        "select-none",
        // Ringed rather than filled: the row may already be the open folder
        // or under a drag, and this has to be legible on top of either
        // without arguing with it about what the fill means.
        //
        // Drawn inside the row, not around it. A row is the full width of a
        // column that scrolls, and a scrolling box clips on both axes — so
        // a ring sitting outside the row's edge had its left and right
        // sides cut off against the very container it was drawn in.
        revealed && "ring-2 ring-inset ring-[var(--mail-chrome-pinned)]",
        // Only while the row is not already saying something else. A folder
        // that is open, or that a conversation is being held over, has an
        // answer of its own, and a hover under it would be a second one.
        !active && drop === "rest" && "hover:bg-[var(--mail-chrome-hover)]",
        active && "bg-[var(--mail-chrome-pinned)]",
        state === "dim" && "pointer-events-none opacity-40",
        // The right mailbox, but not a folder mail goes into. Dimmed like
        // Sent and Drafts at the top of the rail, so the answer is given
        // before the drop rather than after it.
        !carrying &&
          drop === "live" &&
          refuses &&
          "pointer-events-none opacity-35",
        // Lifted: this is the folder in the air, not one it can land on.
        beingCarried && "opacity-45",
        // Asked for, not answered. It stays where it is until the provider
        // says otherwise, so it must not read as though it had already
        // arrived — and must not be picked up again on the way.
        busy && "pointer-events-none opacity-60",
        // A conversation landing on a folder is filed into it, and says so
        // in full teal. A folder landing on a folder is only going to sit
        // there — the same weight of answer as pointing at it — so it takes
        // the hover instead.
        over && takesDrop && carrying && "bg-[var(--mail-chrome-hover)]",
        over && takesDrop && !carrying && "bg-teal-500"
      )}
      style={{
        paddingLeft: depth * 14,
        /**
         * The two properties WebKit actually reads, set where they survive.
         *
         * `select-none` above compiles to `user-select: none` and nothing
         * else — no prefixed form, since nothing prefixes this build — and
         * the webview this app runs in wants `-webkit-user-select`. So the
         * folder names stayed selectable, a pull was read as a text
         * selection, and the drag never began. That is the highlight that
         * kept sweeping across the rail.
         *
         * `-webkit-user-drag` is the other half, and cannot be written as a
         * Tailwind class at all: a leading dash is read as a negative and
         * the class is dropped.
         */
        WebkitUserSelect: "none",
        ...(canMoveThisFolder
          ? ({ WebkitUserDrag: "element" } as React.CSSProperties)
          : null),
      }}
      onContextMenu={onContextMenu}
      onDragOver={(e) => {
        if (!takesDrop) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDragEnter={(e) => {
        if (state !== "live") return;
        e.preventDefault();
        // Only on arrival. Crossing from a row's name to its star is not a
        // fresh hover, and would otherwise restart the clock below every
        // time the pointer shifted along a row it was resting on.
        if (!onEnter()) return;
        // Hovering a folded folder opens it, so the one you are aiming at
        // can be inside one you have not opened since last week.
        if (hasChildren && collapsed && !springRef.current) {
          springRef.current = setTimeout(() => {
            springRef.current = null;
            onSpringOpen();
          }, SPRING_OPEN_MS);
        }
      }}
      onDragLeave={() => {
        onLeave();
        cancelSpring();
      }}
      onDrop={(e) => {
        if (!takesDrop) return;
        e.preventDefault();
        e.stopPropagation();
        reset();
        cancelSpring();
        if (carrying) onFolderDrop(node);
        else onDropThread();
      }}
    >
      {/* The triangle is its own hit area: turning a folder open and opening
          it are different things, and one must not do the other. */}
      <span className="flex h-6 w-4 shrink-0 items-center justify-center">
        {hasChildren ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={collapsed ? `Open ${node.label}` : `Fold ${node.label}`}
            className={cn(
              "rounded p-0.5",
              active
                ? "text-[var(--mail-chrome-pinned-fg)] opacity-70 hover:opacity-100"
                : "text-stone-400 hover:text-stone-700",
              over && takesDrop && !carrying && "text-white/80"
            )}
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse();
            }}
          >
            <ChevronRight
              className={cn(
                "h-3 w-3 transition-transform",
                !collapsed && "rotate-90"
              )}
            />
          </button>
        ) : null}
      </span>
      {renaming ? (
        <>
          <RowIcon
            className="ml-0 h-4 w-4 shrink-0 text-stone-400"
            aria-hidden
          />
          {/* Only the last part is editable. The parents are where the
              folder sits, not what it is called, and typing a `/` in here
              would move it rather than rename it. */}
          <input
            autoFocus
            defaultValue={node.label}
            aria-label={`Rename ${node.label}`}
            className="ml-1.5 min-w-0 flex-1 rounded border border-teal-500 bg-white px-1 py-0.5 text-sm outline-none"
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => onRenameSubmit?.(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onRenameSubmit?.(e.currentTarget.value);
              } else if (e.key === "Escape") {
                e.stopPropagation();
                onRenameCancel?.();
              }
            }}
          />
        </>
      ) : (
      // A div wearing a button, not a button. A mousedown on a real
      // <button> never starts its ancestor's drag — which is why the thread
      // rows are built this way too, and why a folder would not move
      // however hard it was pulled.
      <div
        role="button"
        draggable={canMoveThisFolder}
        onDragStart={startFolderDrag}
        onDragEnd={() => {
          clearFolderDragImage();
          onFolderDragEnd();
        }}
        tabIndex={node.implied ? -1 : 0}
        aria-current={active ? "true" : undefined}
        aria-disabled={node.implied || undefined}
        onKeyDown={(e) => {
          if (node.implied) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        className={cn(
          // `items-start` with a wrapping name: on two lines the icon
          // stands beside the first of them rather than floating in the
          // middle of the pair.
          "flex min-w-0 flex-1 items-start gap-1.5 py-1 pr-1 text-left text-sm outline-none",
          active
            ? "font-semibold text-[var(--mail-chrome-pinned-fg)]"
            : "text-stone-800",
          // An implied parent is a heading, not a place.
          node.implied
            ? "cursor-default text-stone-500"
            : "cursor-grab active:cursor-grabbing",
          over && takesDrop && !carrying && "text-white"
        )}
        onClick={() => {
          if (node.implied) return;
          onOpen();
        }}
      >
        {busy ? (
          <Loader2
            className="h-4 w-4 shrink-0 animate-spin text-[var(--mail-chrome-muted)]"
            aria-hidden
          />
        ) : (
        <RowIcon
          className={cn(
            // Nudged down to sit on the first line's baseline, now that the
            // row is aligned to the top of a name that may be two lines.
            "mt-[3px] h-4 w-4 shrink-0",
            active
              ? "text-[var(--mail-chrome-pinned-fg)]"
              : "text-stone-400",
            over && takesDrop && !carrying && "text-white"
          )}
          aria-hidden
        />
        )}
        {/* Wrapped, not cut off. A folder is named to be told apart from
            the others, and "Klienter — 2026 …" tells you nothing that
            "Klienter — 2025 …" does not. The rail is narrow and some
            names are long, so the name takes the second line it needs.
            `break-words` for the one that is long without a space in it. */}
        <span className="min-w-0 flex-1 break-words">{node.label}</span>
      </div>
      )}
      {/* Where the drop would land. The row is already filled; this says
          the conversation goes in rather than that the folder is merely
          under the pointer. */}
      {over && takesDrop && !carrying ? (
        <span aria-hidden className="shrink-0 pr-1 text-sm text-white">
          ↵
        </span>
      ) : null}
      {accountTag && !renaming && !(over && takesDrop) ? (
        // The address, cut off where it runs out of room — "sam@dig…".
        // It used to be the domain's first word, which named the mailbox
        // only until two addresses shared a domain, and then said the same
        // thing about both. The beginning of an address is the part that
        // tells them apart; the whole of it is on the title.
        <span
          title={accountTag}
          className={cn(
            "max-w-[4.75rem] shrink-0 truncate pr-1 text-[11px] lowercase",
            active
              ? "text-[var(--mail-chrome-pinned-fg)] opacity-70"
              : "text-stone-400"
          )}
        >
          {accountTag}
        </span>
      ) : null}
      {/* The heart shows on hover, and stays showing once it is on — the
          same mark the to-do app uses for the same idea, so a favourite
          means one thing across the two. */}
      {!node.implied && !renaming && !(over && takesDrop) ? (
        <button
          type="button"
          tabIndex={-1}
          title={t(favourite ? "removeFromFavourites" : "addToFavourites")}
          aria-label={
            favourite
              ? `${t("removeFromFavourites")}: ${node.label}`
              : `${t("addToFavourites")}: ${node.label}`
          }
          aria-pressed={favourite}
          className={cn(
            // Its own group: what the heart does under the pointer has to
            // be told from what the row does under the pointer.
            "group/heart shrink-0 rounded p-1",
            // Under the FAVOURITES heading every row is a favourite, so a
            // filled heart on each of them says only what the heading
            // already said — and sat between the mailbox and the count as
            // though it were a third thing about the folder. Kept, but out
            // of sight until the pointer is on the row, because it is still
            // the way back off the list.
            favourite && !inFavourites
              ? ""
              : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100",
            // The same grey as the heart in the FAVOURITES heading above.
            // Navy was the colour of a folder being open, and a heart in it
            // read as loudly as that — on every favourite at once, for a
            // mark that says "one of a handful" rather than "this one".
            // Filled and always shown is enough to tell it from the outline
            // that appears under the pointer.
            //
            // On a row that is itself navy it inverts along with everything
            // else riding on it, or it would be a heart drawn in the colour
            // of the row it sits on.
            active
              ? "text-[var(--mail-chrome-pinned-fg)]"
              : favourite
                ? // Full navy while the pointer is anywhere on the row: at
                  // rest the heart is a quiet mark among forty, and under
                  // the pointer it is the button that would take the folder
                  // off the list. Group, not self — by the time the pointer
                  // has found the heart itself the answer is late.
                  "text-[var(--mail-chrome-muted)] group-hover:text-[var(--mail-chrome-pinned)]"
                : "text-stone-300 hover:text-stone-500"
          )}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavourite();
          }}
        >
          {/* Under the pointer it fills, at less than half strength.
              A heart that is not a favourite is an outline, and on a navy
              row an outline changing shade is no answer at all — the row it
              sits on is already dark, so there is nowhere for a colour to
              go. Filling it is the answer, and filling it faintly says what
              clicking would do without claiming it has been done. */}
          <HeartIcon
            className="h-3.5 w-3.5 group-hover/heart:fill-current group-hover/heart:[fill-opacity:0.45]"
            filled={favourite}
          />
        </button>
      ) : null}
      {node.count && !renaming && !(over && takesDrop) ? (
        <span
          className={cn(
            "shrink-0 pr-1 tabular-nums text-xs",
            active
              ? "text-[var(--mail-chrome-pinned-fg)] opacity-70"
              : "text-stone-400"
          )}
        >
          {node.count}
        </span>
      ) : null}
    </div>
  );
}

/** One row of a rail menu, and the icon in front of it. */
/* No blue ring on the item the menu opens onto — see ROW_MENU_ITEM. */
const menuItemClass =
  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-stone-800 outline-none hover:bg-stone-100 focus-visible:bg-stone-100";
const menuIconClass = "h-3.5 w-3.5 shrink-0 text-stone-400";

/**
 * The right-click menu on a folder, and on the mailbox above them.
 *
 * It is a menu rather than buttons on the row because the row is already
 * carrying a triangle, a star and a count, and the things you do to a folder
 * — as against the things you do with it — are rare enough to be worth a
 * second click. The mailbox heading is the same case: a plus that appeared
 * under the pointer was a control on a row that is otherwise only a name.
 *
 * Every action is optional, and only the ones given are drawn. A mailbox can
 * be given one folder to make, where a folder is given all four. Given a
 * `note` instead, it says one thing and offers nothing: Sent, Drafts, Trash
 * and Junk are the provider's own, and a right-click that opened nothing at
 * all reads as a right-click that missed.
 *
 * Placed at the pointer and clamped to the window, so a folder near the
 * bottom of a long rail does not open its menu off the end of the screen.
 */
function FolderContextMenu({
  x,
  y,
  note,
  onNewFolder,
  onRename,
  onNewSubfolder,
  onMove,
  onDelete,
  onDismiss,
}: {
  x: number;
  y: number;
  /** A line that answers instead of acting. Drawn on its own. */
  note?: string;
  onNewFolder?: () => void;
  onRename?: () => void;
  onNewSubfolder?: () => void;
  onMove?: () => void;
  onDelete?: () => void;
  onDismiss: () => void;
}) {
  const t = useMailT();
  const ref = React.useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = React.useState({ left: x, top: y });

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    setPlaced({
      left: Math.min(x, window.innerWidth - box.width - 8),
      top: Math.min(y, window.innerHeight - box.height - 8),
    });
  }, [x, y]);

  React.useEffect(() => {
    // Anything that is not a click inside the menu closes it, including a
    // scroll: a menu that stays put while the rail moves under it is
    // pointing at whatever has slid into its place.
    const onDown = (event: MouseEvent) => {
      if (ref.current?.contains(event.target as Node)) return;
      onDismiss();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onDismiss, true);
    window.addEventListener("blur", onDismiss);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onDismiss, true);
      window.removeEventListener("blur", onDismiss);
    };
  }, [onDismiss]);

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left: placed.left, top: placed.top }}
      /* Wide enough for its longest item and no wider. It carried a fixed
         floor sized for a menu that never arrived, so every item sat with
         an inch of nothing to the right of it. */
      className="mail-light-surface fixed z-50 w-max rounded-lg border border-stone-200 bg-white py-1 shadow-lg"
    >
      {note ? (
        <p className="px-3 py-1.5 text-sm text-stone-500">{note}</p>
      ) : null}
      {onNewFolder ? (
        <button
          type="button"
          role="menuitem"
          autoFocus
          className={menuItemClass}
          onClick={onNewFolder}
        >
          <FolderPlus className={menuIconClass} aria-hidden />
          {t("newFolder")}
        </button>
      ) : null}
      {onRename ? (
        <button
          type="button"
          role="menuitem"
          autoFocus
          className={menuItemClass}
          onClick={onRename}
        >
          <Pencil className={menuIconClass} aria-hidden />
          {t("renameFolder")}
        </button>
      ) : null}
      {onNewSubfolder ? (
        <button
          type="button"
          role="menuitem"
          className={menuItemClass}
          onClick={onNewSubfolder}
        >
          <FolderPlus className={menuIconClass} aria-hidden />
          {t("newSubfolder")}
        </button>
      ) : null}
      {onMove ? (
        <button
          type="button"
          role="menuitem"
          className={menuItemClass}
          onClick={onMove}
        >
          <FolderInput className={menuIconClass} aria-hidden />
          {t("moveFolder")}
        </button>
      ) : null}
      {onDelete ? (
        <button
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-red-700 hover:bg-red-50"
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5 shrink-0 text-red-400" aria-hidden />
          {t("deleteFolder")}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Asking before a folder goes.
 *
 * A folder is not a message: undo cannot put one back, and what deleting
 * costs is not the same on both providers — so the asking says which,
 * rather than a single sentence that is half true wherever it is read.
 */
function FolderDeleteConfirm({
  x,
  y,
  label,
  onOutlook,
  busy,
  onConfirm,
  onDismiss,
}: {
  x: number;
  y: number;
  label: string;
  onOutlook: boolean;
  busy: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const t = useMailT();
  const ref = React.useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = React.useState({ left: x, top: y });

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    setPlaced({
      left: Math.min(x, window.innerWidth - box.width - 8),
      top: Math.min(y, window.innerHeight - box.height - 8),
    });
  }, [x, y]);

  React.useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (ref.current?.contains(event.target as Node)) return;
      onDismiss();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [onDismiss]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t("deleteFolderTitle", { label })}
      style={{ left: placed.left, top: placed.top }}
      className="mail-light-surface fixed z-50 w-64 rounded-xl border border-stone-200 bg-white p-3 shadow-lg"
    >
      <p className="text-sm font-semibold text-stone-800">
        {t("deleteFolderAsk", { label })}
      </p>
      <p className="pt-1 text-xs leading-snug text-stone-500">
        {t(onOutlook ? "deleteFolderOutlook" : "deleteFolderGmail")}
      </p>
      <div className="flex justify-end gap-2 pt-3">
        <button
          type="button"
          className="rounded-lg px-2.5 py-1 text-sm font-semibold text-stone-600 hover:bg-stone-100"
          onClick={onDismiss}
        >
          {t("keep")}
        </button>
        <button
          type="button"
          autoFocus
          disabled={busy}
          className="rounded-lg bg-red-600 px-2.5 py-1 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
          onClick={onConfirm}
        >
          {busy ? t("deleting") : t("delete")}
        </button>
      </div>
    </div>
  );
}

/**
 * Where a folder is going, chosen from a list.
 *
 * The same vocabulary as filing a message: a filter box over a tree. It
 * exists because dragging a folder is only discoverable to people who
 * think to try it, and because a folder forty rows down cannot be dragged
 * to one forty rows up without a scroll nobody can hold.
 *
 * Only this folder's own mailbox is offered. A folder is a place on a
 * mailbox and there is no moving it to another, so the others are not
 * shown and refused — they are simply not the question.
 */
function FolderMovePicker({
  moving,
  rows,
  x,
  y,
  onMove,
  onDismiss,
}: {
  moving: FolderTreeNode;
  /** Every folder on the moving folder's own mailbox. */
  rows: MailAccountFolder[];
  x: number;
  y: number;
  /** `null` means the top of the mailbox. */
  onMove: (targetName: string | null) => void;
  onDismiss: () => void;
}) {
  const t = useMailT();
  const ref = React.useRef<HTMLDivElement>(null);
  const [query, setQuery] = React.useState("");
  const [highlight, setHighlight] = React.useState(0);
  const [placed, setPlaced] = React.useState({ left: x, top: y });

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    setPlaced({
      left: Math.min(x, window.innerWidth - box.width - 8),
      top: Math.min(y, window.innerHeight - box.height - 8),
    });
  }, [x, y]);

  React.useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (ref.current?.contains(event.target as Node)) return;
      onDismiss();
    };
    window.addEventListener("mousedown", onDown, true);
    return () => window.removeEventListener("mousedown", onDown, true);
  }, [onDismiss]);

  const atTop = folderParentPath(moving.name) === "";

  /**
   * The tree, without the folder being moved or anything inside it.
   *
   * Not greyed out but absent: a folder cannot go into itself, and a row
   * offering to do it is a row that has to be explained.
   */
  const options = React.useMemo(() => {
    const from = moving.name.toLowerCase();
    const kept = rows.filter((row) => {
      if (row.virtual) return false;
      const name = row.name.toLowerCase();
      return name !== from && !name.startsWith(`${from}/`);
    });
    const tree = filterFolderTree(buildFolderTree(kept), query);
    const out: { node: FolderTreeNode; depth: number }[] = [];
    const walk = (list: FolderTreeNode[], depth: number) => {
      for (const node of list) {
        out.push({ node, depth });
        walk(node.children, depth + 1);
      }
    };
    walk(tree, 0);
    return out;
  }, [rows, moving.name, query]);

  /** What Enter would take: the top row, then the folders that can take it. */
  const choices = React.useMemo(() => {
    const list: (string | null)[] = [];
    if (!atTop && !query.trim()) list.push(null);
    for (const { node } of options) {
      if (node.implied) continue;
      if (folderParentPath(moving.name) === node.name) continue;
      list.push(node.name);
    }
    return list;
  }, [atTop, options, query, moving.name]);

  React.useEffect(() => setHighlight(0), [query]);

  const take = (name: string | null) => onMove(name);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t("moveFolderTitle", { label: moving.label })}
      style={{ left: placed.left, top: placed.top }}
      className="mail-light-surface fixed z-50 flex max-h-[22rem] w-72 flex-col rounded-xl border border-stone-200 bg-white p-2 shadow-lg"
    >
      <p className="shrink-0 px-1 pb-2 text-sm text-stone-700">
        {t("moveFolderToBefore")}
        <span className="font-semibold">{moving.label}</span>
        {t("moveFolderToAfter")}
      </p>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("filterFoldersPlaceholder")}
        aria-label={t("filterFolders")}
        className="mb-1 w-full shrink-0 rounded-md border border-stone-200 bg-white px-2 py-1.5 text-sm outline-none placeholder:text-stone-400 focus:border-stone-300"
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((n) => Math.min(n + 1, choices.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((n) => Math.max(n - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (choices.length) take(choices[highlight] ?? null);
          } else if (e.key === "Escape") {
            e.stopPropagation();
            onDismiss();
          }
        }}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!atTop && !query.trim() ? (
          <MoveRow
            label={t("topLevel")}
            note={null}
            depth={0}
            icon={Home}
            highlighted={choices[highlight] === null}
            onPick={() => take(null)}
          />
        ) : null}
        {atTop && !query.trim() ? (
          <MoveRow
            label={t("topLevel")}
            note={t("whereItIsNow")}
            depth={0}
            icon={Home}
            highlighted={false}
            onPick={null}
          />
        ) : null}
        {options.map(({ node, depth }) => {
          const isParent = folderParentPath(moving.name) === node.name;
          const pickable = !node.implied && !isParent;
          return (
            <MoveRow
              key={node.name}
              label={node.label}
              note={isParent ? t("whereItIsNow") : null}
              depth={depth}
              icon={Folder}
              highlighted={pickable && choices[highlight] === node.name}
              onPick={pickable ? () => take(node.name) : null}
            />
          );
        })}
        {options.length === 0 ? (
          <p className="px-2 py-3 text-center text-xs text-stone-400">
            {t("noFolderByThatName")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function MoveRow({
  label,
  note,
  depth,
  icon: Icon,
  highlighted,
  onPick,
}: {
  label: string;
  note: string | null;
  depth: number;
  icon: React.ComponentType<{ className?: string }>;
  highlighted: boolean;
  /** null when this row is only there to hold its children under a name. */
  onPick: (() => void) | null;
}) {
  return (
    <button
      type="button"
      disabled={!onPick}
      onClick={() => onPick?.()}
      style={{ paddingLeft: 8 + depth * 14 }}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-sm",
        // Navy, like the open folder's row and the chip that names it.
        // Teal in this rail means a conversation is about to land on
        // something; nothing is landing here — this is the row that is
        // picked, which the rail already has a colour for.
        highlighted
          ? "bg-[var(--mail-chrome-pinned)] text-[var(--mail-chrome-pinned-fg)]"
          : onPick
            ? "text-stone-800 hover:bg-[var(--mail-chrome-hover)]"
            : "cursor-default text-stone-400"
      )}
    >
      <Icon
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          highlighted
            ? "text-[var(--mail-chrome-pinned-fg)]"
            : "text-stone-400"
        )}
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {note ? (
        <span
          className={cn(
            "shrink-0 text-[11px]",
            highlighted
              ? "text-[var(--mail-chrome-pinned-fg)] opacity-70"
              : "text-stone-400"
          )}
        >
          ({note})
        </span>
      ) : null}
      {highlighted ? (
        <span
          aria-hidden
          className="shrink-0 text-sm text-[var(--mail-chrome-pinned-fg)]"
        >
          ↵
        </span>
      ) : null}
    </button>
  );
}

/** ── the rail ──────────────────────────────────────────────────────────── */

export function MailFolderRail({
  accountFolders,
  loading,
  accounts,
  openFolder,
  systemView,
  draftCount,
  onOpenFolder,
  onOpenSent,
  onOpenDrafts,
  onOpenTrash,
  onOpenInbox,
  onOpenJunk,
  onOpenArchived,
  onCreateFolder,
  onReorderAccount,
  onRenameFolder,
  onDeleteFolder,
  draggingAccount,
  onDropThread,
  onDropTrash,
  onDropJunk,
  onDropInbox,
  side = "left",
}: FolderRailProps) {
  const t = useMailT();
  const railRef = React.useRef<HTMLElement>(null);
  const [query, setQuery] = React.useState("");
  const [collapsed, setCollapsedState] = React.useState<Set<string>>(
    () => new Set()
  );
  /**
   * Whole mailboxes folded shut.
   *
   * Three accounts of eighty folders is a rail nobody can see the bottom
   * of, and the two you are not filing into today are most of it.
   */
  const [collapsedAccounts, setCollapsedAccountsState] = React.useState<
    Set<string>
  >(() => new Set());
  const [creatingFor, setCreatingFor] = React.useState<string | null>(null);
  /**
   * The mailbox a folder is being made on, while the provider makes it.
   *
   * Its own state, and not `creatingFor` and `saving` together, because the
   * name box does not survive the wait: it is disabled the moment the work
   * starts, a disabled field cannot hold focus, and the blur that follows is
   * the one that closes the box. So by the time there was anything to wait
   * for, `creatingFor` was already null and the spinner had nothing to hang
   * from.
   */
  const [creatingIn, setCreatingIn] = React.useState<string | null>(null);
  /**
   * A folder being made inside another, by mailbox and parent name.
   *
   * Kept apart from `creatingFor`, which names a mailbox: one of these
   * puts a box under a heading and the other puts it under a row, and
   * having both open at once would be two boxes wanting the same name.
   */
  const [creatingUnder, setCreatingUnder] = React.useState<{
    account: string;
    parent: string;
  } | null>(null);
  /**
   * The folder under the right-click, and where the pointer was.
   *
   * The node rather than its name: what the menu can offer depends on what
   * the folder is, and a parent nobody made or a row standing for a search
   * cannot be renamed because there is nothing at the provider to rename.
   */
  const [menu, setMenu] = React.useState<{
    node: FolderTreeNode;
    x: number;
    y: number;
    /**
     * The provider owns this row — Inbox, Sent, Trash and the rest.
     *
     * It answers a right-click all the same, with the one thing that is
     * true of it: something can be filed under it. The rest of the menu
     * would be a lie, since none of these can be renamed, moved or thrown
     * away from here.
     */
    fixed?: boolean;
  } | null>(null);
  /** The mailbox heading that was right-clicked, and where. */
  const [accountMenu, setAccountMenu] = React.useState<{
    account: string;
    x: number;
    y: number;
  } | null>(null);
  /** Where a right-click landed on Sent, Drafts, Trash, or Junk. */
  const [fixedMenu, setFixedMenu] = React.useState<{
    x: number;
    y: number;
  } | null>(null);
  /** The folder being renamed, by mailbox and whole name. */
  const [renamingKey, setRenamingKey] = React.useState<string | null>(null);
  /** The folder being asked about, and where the asking is drawn. */
  const [confirmDelete, setConfirmDelete] = React.useState<{
    node: FolderTreeNode;
    x: number;
    y: number;
  } | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  /** The folder being moved by menu rather than by hand, and where to draw. */
  const [movingFolder, setMovingFolder] = React.useState<{
    node: FolderTreeNode;
    x: number;
    y: number;
  } | null>(null);
  const isOutlookAccount = useIsOutlookAccount();
  /** One at a time: the pointer is only ever over one heading. */
  const accountSpringRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  React.useEffect(
    () => () => {
      if (accountSpringRef.current) clearTimeout(accountSpringRef.current);
    },
    []
  );
  const [newName, setNewName] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const favourites = useFolderFavourites();

  React.useEffect(() => {
    setCollapsedState(readCollapsedFolders());
    setCollapsedAccountsState(readCollapsedAccounts());
  }, []);

  const setCollapsed = React.useCallback(
    (next: Set<string>) => {
      setCollapsedState(next);
      writeCollapsedFolders(next);
    },
    []
  );

  const toggleAccount = React.useCallback((account: string) => {
    setCollapsedAccountsState((current) => {
      const key = collapsedAccountKey(account);
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeCollapsedAccounts(next);
      return next;
    });
  }, []);

  const openAccount = React.useCallback((account: string) => {
    setCollapsedAccountsState((current) => {
      const key = collapsedAccountKey(account);
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      writeCollapsedAccounts(next);
      return next;
    });
  }, []);

  const toggleCollapsed = React.useCallback(
    (account: string, name: string) => {
      const key = collapsedFolderKey(account, name);
      const next = new Set(collapsed);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      setCollapsed(next);
    },
    [collapsed, setCollapsed]
  );

  /**
   * A folder taken off the favourites is shown where it actually lives.
   *
   * Unfavouriting from the band at the top makes the row vanish from under
   * the pointer, and its real home may be forty rows down inside two folded
   * folders — so the folder reads as deleted rather than unpinned. This
   * opens the way to it, brings it into view and rings it for a moment.
   *
   * Only from the band. Unfavouriting from the row itself changes nothing
   * about where that row is, and scrolling to what is already under the
   * pointer would be the app taking the view away for no reason.
   */
  const [revealed, setRevealed] = React.useState<string | null>(null);
  /** The reveal the rail has already scrolled to, so it goes there once. */
  const scrolledToRef = React.useRef<string | null>(null);

  /**
   * The one row a dropped conversation would land on.
   *
   * Held here rather than on each row, so that lighting one puts the last
   * one out — see `useDragOver`.
   */
  const [dragOver, setDragOver] = React.useState<string | null>(null);

  /** The folder in the air, while one is. */
  const [folderDrag, setFolderDrag] = React.useState<FolderDrag | null>(null);
  /** The mailbox heading being dragged. */
  const [accountDrag, setAccountDrag] = React.useState<string | null>(null);
  /**
   * Wide enough for the four views to stand two abreast.
   *
   * Measured, because the rail is dragged to whatever width its reader wants
   * and a media query only knows about the window. The number is what two
   * columns need: 6.5rem each and the gap between them.
   */
  const [systemTwoUp, setSystemTwoUp] = React.useState(false);
  React.useEffect(() => {
    const rail = railRef.current;
    if (!rail || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      setSystemTwoUp(entry.contentRect.width >= SYSTEM_TWO_UP_WIDTH);
    });
    observer.observe(rail);
    return () => observer.disconnect();
  }, []);

  /** Each mailbox section, so a drop can be told which space it is in. */
  const sectionRefs = React.useRef(new Map<string, HTMLDivElement>());
  /**
   * Where it would land: in front of this mailbox, or at the end.
   *
   * A place between two headings rather than a heading — a mailbox has no
   * inside, so there is nothing to drop one onto. The rail draws it as a
   * line, which is the only honest picture of "it goes here".
   */
  const [accountDropBefore, setAccountDropBefore] = React.useState<
    string | null | undefined
  >(undefined);
  /**
   * A folder the provider has been asked about and has not answered.
   *
   * Both providers take seconds over a move, and the rail cannot show it
   * in its new place until they say it is there — so for those seconds the
   * folder sat exactly where it had been, with nothing to say anything had
   * been asked at all.
   */
  const [busyFolder, setBusyFolder] = React.useState<string | null>(null);

  /** Hold the row while the provider is asked, whatever it is asked. */
  const whileBusy = React.useCallback(
    async (account: string, name: string, run: () => Promise<void>) => {
      setBusyFolder(folderFavouriteKey(account, name));
      try {
        await run();
      } finally {
        setBusyFolder(null);
      }
    },
    []
  );

  /**
   * Moving a folder is renaming it to where it is going.
   *
   * Both providers already read a name as a place — a Gmail label is its
   * whole path, and the Outlook rename compares the parent it had with the
   * parent it is being given and re-parents when they differ — so there is
   * nothing here a move needs that a rename did not already do.
   */
  const dropFolderInto = React.useCallback(
    async (target: FolderTreeNode) => {
      const drag = folderDrag;
      setFolderDrag(null);
      setDragOver(null);
      if (!drag || !folderAcceptsFolder(drag, target)) return;
      const held = drag;
      // Open where it is going, so it can be seen to have arrived.
      setCollapsedState((current) => {
        const key = collapsedFolderKey(target.account, target.name);
        if (!current.has(key)) return current;
        const next = new Set(current);
        next.delete(key);
        writeCollapsedFolders(next);
        return next;
      });
      await whileBusy(held.account, held.name, async () => {
        try {
          await onRenameFolder(
            held.account,
            held.name,
            `${target.name}/${held.label}`
          );
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : t("couldNotMoveFolder")
          );
        }
      });
    },
    [folderDrag, onRenameFolder, whileBusy, t]
  );

  /** Out of whatever holds it, back to the top of its own mailbox. */
  const dropFolderAtTop = React.useCallback(
    async (account: string) => {
      const drag = folderDrag;
      setFolderDrag(null);
      setDragOver(null);
      if (!drag) return;
      if (drag.account.toLowerCase() !== account.toLowerCase()) return;
      // Already there: nothing above it to come out of.
      if (!folderParentPath(drag.name)) return;
      await whileBusy(drag.account, drag.name, async () => {
        try {
          await onRenameFolder(drag.account, drag.name, drag.label);
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : t("couldNotMoveFolder")
          );
        }
      });
    },
    [folderDrag, onRenameFolder, whileBusy, t]
  );

  const revealFolder = React.useCallback(
    (account: string, name: string) => {
      openAccount(account);
      setCollapsedState((current) => {
        const next = new Set(current);
        let changed = false;
        for (const path of folderAncestors(name)) {
          if (next.delete(collapsedFolderKey(account, path))) changed = true;
        }
        if (!changed) return current;
        writeCollapsedFolders(next);
        return next;
      });
      setRevealed(folderFavouriteKey(account, name));
    },
    [openAccount]
  );

  /** Stop pointing at it after a beat. */
  React.useEffect(() => {
    if (!revealed) {
      scrolledToRef.current = null;
      return;
    }
    const timer = window.setTimeout(() => setRevealed(null), REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, [revealed]);

  /**
   * Once it is on screen, scroll to it. Once, and not before it is there.
   *
   * A folder just made is not in the rail when the reveal is asked for: the
   * provider answers, the whole list is read back, and the row arrives a
   * render or two later. Looking for it on the next frame found nothing and
   * gave up — which is why a new folder was ringed where it stood and never
   * scrolled to.
   *
   * So this looks after every render while a reveal is pending, and takes
   * the rail there the first time the row exists.
   */
  React.useEffect(() => {
    if (!revealed || scrolledToRef.current === revealed) return;
    /*
      Read back and compared here, rather than asked for in a selector.

      The key joins the mailbox to the folder with a NUL, which is the one
      character `CSS.escape` cannot carry: the rules say to write it as the
      replacement character instead, so the selector asked for a key with a
      U+FFFD in it and no row ever had one. The ring showed, because that is
      a comparison in JavaScript, and the rail never moved.
    */
    const rows = railRef.current?.querySelectorAll<HTMLElement>(
      "[data-folder-row]"
    );
    const row = rows
      ? Array.from(rows).find((el) => el.dataset.folderRow === revealed)
      : undefined;
    if (!row) return;
    scrolledToRef.current = revealed;
    const gently = !window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches;
    row.scrollIntoView({ block: "center", behavior: gently ? "smooth" : "auto" });
    if (!gently) return;
    /*
      And again, without the animation, if the animation did nothing.

      A smooth scroll is a request the engine may decline — this webview
      declines it — and a reveal that does not move is no reveal at all: the
      folder ends up ringed somewhere off the bottom of the rail, which is
      the very thing the scroll is for. So the scroller is read a beat later,
      and if it has not moved the rail is simply put there.
    */
    const scroller = scrollingAncestor(row);
    const before = scroller?.scrollTop;
    window.setTimeout(() => {
      if (!scroller || scroller.scrollTop !== before) return;
      row.scrollIntoView({ block: "center", behavior: "auto" });
    }, 150);
  });

  const openCollapsed = React.useCallback(
    (account: string, name: string) => {
      const key = collapsedFolderKey(account, name);
      if (!collapsed.has(key)) return;
      const next = new Set(collapsed);
      next.delete(key);
      setCollapsed(next);
    },
    [collapsed, setCollapsed]
  );

  /** A favourite pointing at a folder the provider no longer has is dropped. */
  React.useEffect(() => {
    if (loading || !accountFolders.length) return;
    pruneFolderFavourites(accountFolders);
  }, [accountFolders, loading]);

  const trees = React.useMemo(() => {
    const byAccount = new Map<string, MailAccountFolder[]>();
    for (const row of accountFolders) {
      const list = byAccount.get(row.account);
      if (list) list.push(row);
      else byAccount.set(row.account, [row]);
    }
    // Every connected mailbox gets a section, even an empty one: a heading
    // with nothing under it says "no folders here yet", and no heading at
    // all says "this mailbox does not exist".
    const order = accounts.length
      ? accounts
      : accountsWithFolders(accountFolders);
    return order.map((account) => ({
      account,
      nodes: buildFolderTree(byAccount.get(account) ?? []),
    }));
  }, [accountFolders, accounts]);

  const filtered = React.useMemo(
    () =>
      trees.map(({ account, nodes }) => ({
        account,
        nodes: filterFolderTree(nodes, query),
      })),
    [trees, query]
  );

  /** The mailboxes as the rail lists them, which is the order being changed. */
  const railAccounts = React.useMemo(
    () => filtered.map((section) => section.account),
    [filtered]
  );

  /**
   * Where a drop would put the dragged mailbox, if it can go there at all.
   *
   * One question for the whole rail rather than one per section, because the
   * places a mailbox can go are the spaces between the sections, and a space
   * is not inside either of the two it separates. Asked section by section,
   * the rail had spaces it could not name at all: the one above the first
   * mailbox needed the pointer in the top half of a section that is as tall
   * as the mailbox is deep, so with the folders open — or the rail scrolled
   * a little — the top of the list was somewhere the reader could not point.
   *
   * See `accountDropPlace`, which does the reading. Any place is a place:
   * the order is the reader's own arrangement, so a mailbox may sit anywhere
   * among the others, whichever provider each of them came from.
   */
  const dropPlaceAt = React.useCallback(
    (y: number): string | null | undefined => {
      if (!accountDrag) return undefined;
      const spans: AccountSpan[] = [];
      for (const account of railAccounts) {
        const box = sectionRefs.current.get(account)?.getBoundingClientRect();
        if (!box) continue;
        spans.push({ account, top: box.top, bottom: box.bottom });
      }
      return accountDropPlace(railAccounts, spans, accountDrag, y);
    },
    [accountDrag, railAccounts]
  );

  const favouriteKeys = React.useMemo(
    () =>
      new Set(favourites.map((f) => folderFavouriteKey(f.account, f.name))),
    [favourites]
  );

  /**
   * Favourites, as rows to draw.
   *
   * Read out of the trees rather than out of the stored list, so a count
   * and a name here are the same ones the section below shows.
   */
  const favouriteRows = React.useMemo(() => {
    if (!favourites.length) return [];
    const byKey = new Map<string, FolderTreeNode>();
    for (const { nodes } of trees) {
      for (const node of flattenFolderTree(nodes)) {
        byKey.set(folderFavouriteKey(node.account, node.name), node);
      }
    }
    const needle = query.trim().toLowerCase();
    return favourites
      .map((f) => byKey.get(folderFavouriteKey(f.account, f.name)))
      .filter((node): node is FolderTreeNode => Boolean(node))
      .filter((node) => !needle || node.label.toLowerCase().includes(needle));
  }, [favourites, trees, query]);

  /**
   * What a row does while a conversation is in the air.
   *
   * A conversation belongs to one mailbox and can only be filed inside it,
   * so every folder on another account refuses the drop. It stays on screen
   * and stays readable: hiding it would move the rows below it, and the
   * reader is already aiming at one of them.
   */
  const dropStateFor = React.useCallback(
    (account: string): DropState => {
      if (!draggingAccount) return "rest";
      return account.toLowerCase() === draggingAccount.toLowerCase()
        ? "live"
        : "dim";
    },
    [draggingAccount]
  );

  const dragging = draggingAccount !== null;

  // A drag can end anywhere — off the rail, off the window, on a row that
  // refused it — and none of those send a last leave.
  React.useEffect(() => {
    if (!dragging) setDragOver(null);
  }, [dragging]);

  /**
   * Rename, keeping the folder where it is.
   *
   * The box holds the last part of the name, so the parents are put back
   * around whatever is typed: renaming Figenbladet under Academia asks for
   * `Academia/<new>`, and the folder stays inside Academia. Typing a path
   * would otherwise move it, which is not what Rename says it does.
   */
  const submitRename = React.useCallback(
    async (node: FolderTreeNode, nextLabel: string) => {
      setRenamingKey(null);
      const label = nextLabel.trim().replace(/\//g, " ");
      if (!label || label === node.label) return;
      const parent = node.name.slice(
        0,
        node.name.length - node.label.length
      );
      await whileBusy(node.account, node.name, async () => {
        try {
          await onRenameFolder(node.account, node.name, `${parent}${label}`);
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : t("couldNotRenameFolder")
          );
        }
      });
    },
    [onRenameFolder, whileBusy, t]
  );

  const runDelete = React.useCallback(async () => {
    const target = confirmDelete?.node;
    if (!target || deleting) return;
    setDeleting(true);
    try {
      await onDeleteFolder(target.account, target.name);
      setConfirmDelete(null);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("couldNotDeleteFolder")
      );
    } finally {
      setDeleting(false);
    }
  }, [confirmDelete, deleting, onDeleteFolder, t]);

  /**
   * Make a folder inside the one that was right-clicked.
   *
   * The parent's whole name goes in front of whatever is typed, so the
   * provider is asked for `Clients/2026` and not for a second top-level
   * folder called 2026. A typed `/` is flattened for the same reason the
   * rename flattens one: this makes a folder here, and nowhere else.
   */
  const submitSubfolder = async () => {
    const target = creatingUnder;
    const label = newName.trim().replace(/\//g, " ");
    if (!target || !label || saving) return;
    const name = `${target.parent}/${label}`;
    setSaving(true);
    // The parent carries the wait, the way it carries a move or a rename.
    await whileBusy(target.account, target.parent, async () => {
      try {
        await onCreateFolder(target.account, name);
        setCreatingUnder(null);
        setNewName("");
        // A folder lands in the order the provider keeps, which on a long
        // rail is nowhere near where it was asked for.
        revealFolder(target.account, name);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : t("couldNotMakeFolder")
        );
      }
    });
    setSaving(false);
  };

  const submitNewFolder = async (account: string) => {
    const name = newName.trim();
    if (!name || saving) return;
    setSaving(true);
    setCreatingIn(account);
    try {
      await onCreateFolder(account, name);
      setCreatingFor(null);
      setNewName("");
      revealFolder(account, name);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("couldNotMakeFolder")
      );
    } finally {
      setSaving(false);
      setCreatingIn(null);
    }
  };

  /**
   * The four rows above the mailboxes answer a right-click, but have nothing
   * to offer: the provider owns them, so they cannot be renamed, moved, or
   * deleted. Saying so beats a menu that never opens.
   */
  const openFixedMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    setMenu(null);
    setAccountMenu(null);
    setFixedMenu({ x: event.clientX, y: event.clientY });
  };

  const renderNodes = (nodes: FolderTreeNode[], account: string, depth = 0) =>
    nodes.map((node) => {
      const key = collapsedFolderKey(account, node.name);
      // A filter opens what it found: a match hidden inside a folded parent
      // is a match the reader cannot see or drop onto.
      const isCollapsed = query.trim() ? false : collapsed.has(key);
      const hasChildren = node.children.length > 0;
      return (
        <React.Fragment key={node.name}>
          <FolderRow
            node={node}
            depth={depth}
            collapsed={isCollapsed}
            hasChildren={hasChildren}
            active={
              openFolder?.name.toLowerCase() === node.name.toLowerCase() &&
              (openFolder.account ?? "").toLowerCase() ===
                account.toLowerCase()
            }
            favourite={favouriteKeys.has(
              folderFavouriteKey(account, node.name)
            )}
            drop={dropStateFor(account)}
            dragOver={dragOver}
            setDragOver={setDragOver}
            folderDrag={folderDrag}
            onFolderDragStart={setFolderDrag}
            onFolderDragEnd={() => setFolderDrag(null)}
            onFolderDrop={(target) => void dropFolderInto(target)}
            renaming={
              renamingKey === folderFavouriteKey(account, node.name)
            }
            revealed={revealed === folderFavouriteKey(account, node.name)}
            busy={busyFolder === folderFavouriteKey(account, node.name)}
            onContextMenu={(event) => {
              // A parent standing in for one nobody made: there is nothing
              // at the provider to rename, and nothing to file into it.
              if (node.implied) return;
              event.preventDefault();
              setAccountMenu(null);
              setFixedMenu(null);
              // Inbox is the row a reader reaches for when they want a
              // folder to put mail in, and it was the one row that handed
              // them the browser's menu instead of ours.
              setMenu({
                node,
                x: event.clientX,
                y: event.clientY,
                fixed: Boolean(node.virtual || node.role),
              });
            }}
            onRenameSubmit={(next) => void submitRename(node, next)}
            onRenameCancel={() => setRenamingKey(null)}
            onOpen={() => onOpenFolder(account, node.name)}
            onToggleCollapse={() => toggleCollapsed(account, node.name)}
            onToggleFavourite={() =>
              toggleFolderFavourite(account, node.name)
            }
            onDropThread={() => void onDropThread(account, node.name)}
            onSpringOpen={() => openCollapsed(account, node.name)}
          />
          {creatingUnder?.account === account &&
          creatingUnder.parent === node.name ? (
            <input
              autoFocus
              value={newName}
              disabled={saving}
              placeholder={t("newFolderName")}
              aria-label={t("newFolderInside", { name: node.label })}
              className="mb-1 mt-0.5 w-full rounded-md border border-teal-500 bg-white px-2 py-1 text-sm outline-none"
              // Where the folder will be: one step in from its parent, in
              // the place the row itself will take once it exists.
              style={{ marginLeft: (depth + 1) * 14 }}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={() => setCreatingUnder(null)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submitSubfolder();
                } else if (e.key === "Escape") {
                  e.stopPropagation();
                  setCreatingUnder(null);
                }
              }}
            />
          ) : null}
          {hasChildren && !isCollapsed
            ? renderNodes(node.children, account, depth + 1)
            : null}
        </React.Fragment>
      );
    });

  const sentRow = (
    <SystemRow
      icon={Send}
      label={t("viewSent")}
      active={systemView === "sent"}
      // You never file into Sent or Drafts. Dimmed mid-drag so the rule
      // is visible before the drop rather than after it.
      drop={dragging ? "dim" : "rest"}
      dragOver={dragOver}
      setDragOver={setDragOver}
      onClick={onOpenSent}
      onContextMenu={openFixedMenu}
    />
  );
  const draftsRow = (
    <SystemRow
      icon={FilePen}
      label={t("viewDrafts")}
      count={draftCount}
      active={systemView === "drafts"}
      drop={dragging ? "dim" : "rest"}
      dragOver={dragOver}
      setDragOver={setDragOver}
      onClick={onOpenDrafts}
      onContextMenu={openFixedMenu}
    />
  );
  const trashRow = (
    <SystemRow
      icon={Trash2}
      label={t("viewTrash")}
      active={systemView === "trash"}
      drop={dragging ? "live" : "rest"}
      dragOver={dragOver}
      setDragOver={setDragOver}
      onClick={onOpenTrash}
      onContextMenu={openFixedMenu}
      onDropThread={() => void onDropTrash()}
    />
  );
  const inboxRow = (
    <SystemRow
      icon={Inbox}
      label={t("viewInbox")}
      active={systemView === "inbox"}
      /* A drop target like the rest.
         It was dimmed on the argument that the inbox is where a conversation
         already was — true of one dragged out of the inbox, and not of one
         dragged out of the archive, the bin or a folder, which is the case a
         reader actually has in hand when they drag onto Inbox. It goes back
         to the mailbox it belongs to; nothing here can move mail between
         accounts. */
      drop={dragging && onDropInbox ? "live" : dragging ? "dim" : "rest"}
      dragOver={dragOver}
      setDragOver={setDragOver}
      onClick={onOpenInbox}
      onContextMenu={openFixedMenu}
      onDropThread={onDropInbox ? () => void onDropInbox() : undefined}
    />
  );

  const junkRow = (
    <SystemRow
      icon={ShieldAlert}
      label={t("viewJunk")}
      active={systemView === "junk"}
      // Filing something as junk is a real thing to want, and the move
      // menu is not the only place to want it.
      drop={dragging ? "live" : "rest"}
      dragOver={dragOver}
      setDragOver={setDragOver}
      onClick={onOpenJunk}
      onContextMenu={openFixedMenu}
      onDropThread={() => void onDropJunk?.()}
    />
  );
  const archivedRow = (
    <SystemRow
      icon={Archive}
      label={t("viewArchived")}
      active={systemView === "archived"}
      /* Nothing is filed into Archived. On Gmail it is not a folder at all
         — it is everything the inbox label has been taken off — and the
         archive action is what puts mail there. */
      drop={dragging ? "dim" : "rest"}
      dragOver={dragOver}
      setDragOver={setDragOver}
      onClick={onOpenArchived}
      onContextMenu={openFixedMenu}
    />
  );

  return (
    <aside
      ref={railRef}
      aria-label={t("folders")}
      /**
       * The head stays; the mailboxes scroll under it.
       *
       * Done by splitting the rail rather than by sticking the head to the
       * top of one long scroll: a sticky head sits over the rows passing
       * beneath it, and a row half under it is still a drop target. Two
       * boxes, one fixed and one scrolling, cannot overlap at all.
       */
      className={cn(
        "group/rail flex h-full w-full shrink-0 flex-col overflow-hidden border-[var(--mail-chrome-border)] bg-[var(--mail-chrome)] px-2 pt-1",
        side === "right" ? "border-l" : "border-r"
      )}
    >
      {/* What this column is. The way out of it is the folder button that
          opened it, which closes it again — one control for the pair, so
          the rail carries no cross of its own. */}
      <div className="flex shrink-0 items-center gap-1 pl-2">
        <p className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide text-[var(--mail-chrome-muted)]">
          {t("folders")}
        </p>
      </div>

      {/*
        The four views. One set, across every mailbox — there is no
        per-account Trash to keep, and never was.

        Two columns when two will fit, and one when they will not. Four rows
        of one word each, stacked, take a fifth of a rail that has folders to
        show; side by side they take half of that.

        The order changes with the shape, which is why the width is measured
        rather than left to the grid. Stacked, they run in the order they
        are spoken about: Inbox, Sent, Drafts, Trash. Two abreast, the pair
        that holds mail stands on the left and the pair you write from on
        the right — so the grid is dealt Inbox, Sent, Trash, Drafts, and
        reads down as Inbox/Trash and Sent/Drafts.

        Six, in two columns of three that read down: Drafts, Junk, Trash,
        and beside them Inbox, Sent, Archived — the mail you are writing or
        have thrown out on one side, the mail that arrived and where it goes
        on the other. The grid fills across, so the order below is those two
        columns interleaved.

        In one column they read in the order a reader wants them: Inbox,
        Sent, Archived first, then Drafts, Junk, Trash.

        Junk and Archived were listed under each account only, on the
        argument that across every mailbox at once they are places nobody
        reads. Asked for here, and the argument was thin: a reader who wants
        to know what was filed as junk does not want to ask it once per
        mailbox. Both are still under each account, where the question is
        what *this* account holds.
      */}
      <div
        className={cn(
          "grid shrink-0 gap-x-2",
          systemTwoUp ? "grid-cols-2" : "grid-cols-1"
        )}
      >
        {systemTwoUp ? (
          <>
            {draftsRow}
            {inboxRow}
            {junkRow}
            {sentRow}
            {trashRow}
            {archivedRow}
          </>
        ) : (
          <>
            {inboxRow}
            {sentRow}
            {archivedRow}
            {draftsRow}
            {junkRow}
            {trashRow}
          </>
        )}
      </div>

      {favouriteRows.length ? (
        // Capped, and scrolling inside the cap. Everything above the filter
        // box is now held out of the scroll, so a reader with twenty
        // favourites would otherwise pin twenty rows and leave the folders
        // a sliver at the bottom.
        <div className="mt-3 flex max-h-[35%] shrink-0 flex-col">
          <p className="flex shrink-0 items-center gap-1 px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--mail-chrome-muted)]">
            <HeartIcon className="h-3 w-3" filled />
            {t("favourites")}
          </p>
          <div className="min-h-0 overflow-y-auto">
          {favouriteRows.map((node) => (
            <FolderRow
              key={folderFavouriteKey(node.account, node.name)}
              node={node}
              depth={0}
              collapsed
              hasChildren={false}
              active={
                openFolder?.name.toLowerCase() === node.name.toLowerCase() &&
                (openFolder.account ?? "").toLowerCase() ===
                  node.account.toLowerCase()
              }
              favourite
              drop={dropStateFor(node.account)}
              dragOver={dragOver}
              setDragOver={setDragOver}
              folderDrag={folderDrag}
              onFolderDragStart={setFolderDrag}
              onFolderDragEnd={() => setFolderDrag(null)}
              onFolderDrop={(target) => void dropFolderInto(target)}
              // The mailboxes are mixed up here, so each row has to say
              // which one it is on. In the sections below, the heading says.
              accountTag={node.account}
              inFavourites
              onOpen={() => onOpenFolder(node.account, node.name)}
              onToggleCollapse={() => {}}
              onToggleFavourite={() => {
                // Every row here is a favourite, so this only ever removes
                // one — and the row goes with it.
                toggleFolderFavourite(node.account, node.name);
                revealFolder(node.account, node.name);
              }}
              onDropThread={() => void onDropThread(node.account, node.name)}
              onSpringOpen={() => {}}
            />
          ))}
          </div>
        </div>
      ) : null}

      {/* Under the divider, over the sections: it narrows what is below it
          and never the four views above, and standing between the two is
          how it says so. */}
      <div className="mt-3 shrink-0 border-t border-[var(--mail-chrome-border)] pt-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("filterFoldersPlaceholder")}
          aria-label={t("filterFolders")}
          className="w-full rounded-md border border-stone-200 bg-white px-2 py-1.5 text-sm outline-none placeholder:text-stone-400 focus:border-stone-300"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setQuery("");
            }
          }}
        />
      </div>

      <div
        /* Room at the top for the line that says "in front of the first
           one". It is drawn just above the section it points at, and the
           first section starts at the very top of the scroll — so without
           this the one line the reader needed most was the one line the
           rail cut off. */
        className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pt-1.5 pb-2"
        /*
          The rail answers for a mailbox in the air, from top to bottom.

          Every place a mailbox can go is a space between two others, and
          the rail is read as a whole to find which space the pointer is in
          — including the two that are not between anything: above
          everything, and below everything. Both used to be hard to reach or
          impossible. See `dropPlaceAt`.
        */
        onDragOver={(e) => {
          if (!accountDrag) return;
          const place = dropPlaceAt(e.clientY);
          if (place === undefined) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setAccountDropBefore(place);
        }}
        onDrop={(e) => {
          if (!accountDrag) return;
          const place = dropPlaceAt(e.clientY);
          if (place === undefined) return;
          e.preventDefault();
          e.stopPropagation();
          const moved = accountDrag;
          setAccountDrag(null);
          setAccountDropBefore(undefined);
          void onReorderAccount?.(moved, place);
        }}
      >
        {loading && !accountFolders.length ? (
          <p className="px-2 py-4 text-center text-xs text-stone-400">
            {t("loadingFolders")}
          </p>
        ) : null}
        {filtered.map(({ account, nodes }) => {
          const state = dropStateFor(account);
          /**
           * While a conversation is in the air, only its own mailbox is
           * open.
           *
           * Dimming the other mailboxes said they would refuse the drop,
           * which was true and not much help: their folders were still
           * there, eighty of them on a working account, and the folder
           * actually being aimed at could be a long scroll below all of it
           * — with a thread held down the whole way.
           *
           * The headings stay, so the rail is still the shape the reader
           * knows. And this settles at the moment the drag starts, before
           * the pointer has reached the rail at all, so the rule that
           * nothing moves once you are aiming still holds.
           *
           * The source mailbox is opened whether or not it was, because it
           * is the one place the conversation can go. None of it is
           * written down: when the drag ends the reader's own arrangement
           * comes back.
           *
           * A filter opens what it found, here as much as inside a folder:
           * a match under a folded mailbox is a match nobody can see or
           * drop onto.
           *
           * A mailbox in the air folds every mailbox, its own included. The
           * move is an arrangement of the headings and nothing else, and
           * with the folders open the headings are pages apart — the reader
           * had to drag a mailbox across a list of somebody else's folders
           * to reach a place two names above it, and a place off the top of
           * the rail could not be reached at all. Folded, the whole
           * arrangement is in view and every space in it is a short move
           * away. It is not written down either: the folders come back open
           * when the drag ends.
           */
          const accountShut = accountDrag
            ? true
            : dragging
              ? state !== "live"
              : !query.trim() &&
                collapsedAccounts.has(collapsedAccountKey(account));
          const dropAbove = accountDrag !== null && accountDropBefore === account;
          /* Last in the rail, and the drop is "after everything". */
          const dropAtEnd =
            accountDrag !== null &&
            accountDropBefore === null &&
            railAccounts[railAccounts.length - 1] === account;
          return (
            <div
              key={account}
              /* The section says where it is, and the rail as a whole says
                 what a drop there would mean. */
              ref={(node) => {
                if (node) sectionRefs.current.set(account, node);
                else sectionRefs.current.delete(account);
              }}
              className="relative"
            >
              {/* Where it would land. A line between two headings, because
                  that is what the move is: a place in a list, not a thing to
                  be dropped onto. */}
              {dropAbove ? (
                <span
                  aria-hidden
                  /* Half the gap above the heading, so the line reads as
                     the space between two mailboxes rather than as a rule
                     over the name below it. */
                  className="pointer-events-none absolute inset-x-1 -top-[5px] z-10 h-0.5 rounded-full bg-teal-500"
                />
              ) : null}
              {dropAtEnd ? (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-1 -bottom-[3px] z-10 h-0.5 rounded-full bg-teal-500"
                />
              ) : null}
              <div
                className={cn(
                  "flex items-center gap-1 pr-2 pb-1",
                  state === "dim" && "opacity-40"
                )}
                /* Making a folder is the only thing there is to do to a
                   mailbox from here, and it is rare — so it waits behind a
                   right-click, the way everything you do to a folder does,
                   rather than appearing under the pointer on a row that is
                   otherwise just a name. */
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenu(null);
                  setFixedMenu(null);
                  setAccountMenu({
                    account,
                    x: event.clientX,
                    y: event.clientY,
                  });
                }}
              >
                {/* The whole heading turns the mailbox, rather than the
                    triangle alone. A folder row has two jobs — open it, or
                    fold it — and needs the two apart. A heading has only
                    this one, so the small target would be a small target
                    for no reason. */}
                <button
                  type="button"
                  aria-expanded={!accountShut}
                  title={account}
                  /* The heading is the mailbox, so the heading is what you
                     pick up to move it. Only when nothing else is in the
                     air: a rail that answers two drags at once answers
                     neither. */
                  draggable={Boolean(onReorderAccount) && !dragging && !folderDrag}
                  /*
                    The two properties this webview actually reads, set where
                    they survive — `select-none` above compiles to the
                    unprefixed rule alone, and `-webkit-user-drag` cannot be
                    written as a class at all. The same pair the folder rows
                    carry; see `FolderRow`.
                  */
                  style={{
                    WebkitUserSelect: "none",
                    ...(onReorderAccount
                      ? ({ WebkitUserDrag: "element" } as React.CSSProperties)
                      : null),
                  }}
                  onDragStart={(event) => {
                    if (!onReorderAccount) return;
                    event.stopPropagation();
                    event.dataTransfer.setData(MAIL_ACCOUNT_DRAG_TYPE, account);
                    // A payload the browser knows, as well as ours: WebKit
                    // will not begin a drag that carries nothing it can read.
                    event.dataTransfer.setData(
                      "text/plain",
                      `redd-mail-account:${account}`
                    );
                    event.dataTransfer.effectAllowed = "move";
                    setFolderDragImage(event.dataTransfer, account);
                    // After the handler, not during it. Setting state here
                    // rebuilds the row under the drag, which cancels it.
                    setTimeout(() => setAccountDrag(account), 0);
                  }}
                  onDragEnd={() => {
                    clearFolderDragImage();
                    setAccountDrag(null);
                    setAccountDropBefore(undefined);
                  }}
                  /*
                    A heading takes two kinds of drop, and they are told
                    apart by what is in the air.

                    A mailbox lands on it and takes its place. A folder
                    dropped on it comes out of whatever holds it — without
                    somewhere to mean "the top", a folder dragged into
                    another could never come back out, and the rail would
                    nest and never unnest.
                  */
                  onDragOver={(e) => {
                    // An account in the air is the section's to answer.
                    if (accountDrag) return;
                    if (!folderDrag) return;
                    if (
                      folderDrag.account.toLowerCase() !==
                      account.toLowerCase()
                    ) {
                      return;
                    }
                    if (!folderParentPath(folderDrag.name)) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(e) => {
                    if (accountDrag) return;
                    if (!folderDrag) return;
                    e.preventDefault();
                    e.stopPropagation();
                    void dropFolderAtTop(account);
                  }}
                  className={cn(
                    // select-none, for the same reason a folder row has it:
                    // a right-click on a name took the name as well as the
                    // menu, and a pull across the heading swept a highlight
                    // over it. The mailbox is something to point at, not
                    // something to copy.
                    "flex min-w-0 flex-1 select-none items-center gap-1 rounded-md py-0.5 pl-1 pr-1 text-left",
                    "hover:bg-[var(--mail-chrome-hover)]",
                    // The one being carried. Where it would land is a line
                    // between headings, drawn on the section — see below.
                    accountDrag === account && "opacity-40"
                  )}
                  onClick={() => toggleAccount(account)}
                  onDragEnter={() => {
                    // Same as a folded folder: hovering it mid-drag opens
                    // it, so the mailbox you are filing into need not have
                    // been left open. A mailbox being dragged is not being
                    // filed into, so it opens nothing.
                    if (accountDrag) return;
                    if (state !== "live" || !accountShut) return;
                    if (accountSpringRef.current) {
                      clearTimeout(accountSpringRef.current);
                    }
                    accountSpringRef.current = setTimeout(() => {
                      accountSpringRef.current = null;
                      openAccount(account);
                    }, SPRING_OPEN_MS);
                  }}
                  onDragLeave={() => {
                    if (!accountSpringRef.current) return;
                    clearTimeout(accountSpringRef.current);
                    accountSpringRef.current = null;
                  }}
                >
                  <ChevronRight
                    aria-hidden
                    className={cn(
                      "h-3 w-3 shrink-0 transition-transform",
                      !accountShut && "rotate-90",
                      state === "live"
                        ? "text-teal-700"
                        : "text-[var(--mail-chrome-muted)]"
                    )}
                  />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide",
                      // Dark enough to read. It was the same faint grey as a
                      // folder's count, which is a number you glance at — but
                      // this names the mailbox everything under it belongs to,
                      // and at 11px, uppercase and tracked out, faint grey is
                      // the hardest thing on the rail to read.
                      //
                      // The muted chrome colour rather than a stone: the rail
                      // sits on chrome, which is cream in one mode and navy in
                      // the other, and a fixed grey can only suit one.
                      //
                      // The mailbox the conversation came from is the one it
                      // can go into. Naming it in teal answers "why will that
                      // folder not take it" before it is asked.
                      state === "live"
                        ? "text-teal-700"
                        : "text-[var(--mail-chrome-muted)]"
                    )}
                  >
                    {account}
                  </span>
                  {/*
                    The mailbox carries the wait for a folder made on it.

                    A provider takes a second or two to make one, and until
                    now the only word of it was the toast at the end — by
                    which time the reader had been looking at an unchanged
                    rail wondering whether the Enter had landed.
                  */}
                  {creatingIn === account ? (
                    <Loader2
                      className="h-3 w-3 shrink-0 animate-spin text-[var(--mail-chrome-muted)]"
                      aria-hidden
                    />
                  ) : null}
                </button>
              </div>
              {accountShut ? null : creatingFor === account ? (
                <input
                  autoFocus
                  value={newName}
                  disabled={saving}
                  placeholder={t("newFolderName")}
                  aria-label={t("newFolderNameOn", { account })}
                  className="mb-1 w-full rounded-md border border-teal-500 bg-white px-2 py-1 text-sm outline-none"
                  onChange={(e) => setNewName(e.target.value)}
                  onBlur={() => setCreatingFor(null)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void submitNewFolder(account);
                    } else if (e.key === "Escape") {
                      e.stopPropagation();
                      setCreatingFor(null);
                    }
                  }}
                />
              ) : null}
              {accountShut ? null : nodes.length ? (
                renderNodes(nodes, account)
              ) : loading ? (
                /* Nothing, while the answer is still on its way.
                   "No folders yet" is a statement about the mailbox, and
                   under a heading whose folders have not arrived it reads
                   as one — the reader is told their account is empty by a
                   rail that has simply not been told otherwise. The line
                   above the sections says loading once, which is the right
                   number of times to say it. */
                null
              ) : (
                <p className="px-2 py-1 text-xs text-stone-400">
                  {query.trim() ? t("noFolderByThatName") : t("noFoldersYet")}
                </p>
              )}
            </div>
          );
        })}
      </div>
      {menu ? (
        <FolderContextMenu
          x={menu.x}
          y={menu.y}
          onDismiss={() => setMenu(null)}
          note={menu.fixed ? t("systemFolderFixed") : undefined}
          onRename={
            menu.fixed
              ? undefined
              : () => {
                  setRenamingKey(
                    folderFavouriteKey(menu.node.account, menu.node.name)
                  );
                  setMenu(null);
                }
          }
          onNewSubfolder={() => {
            // Open the parent, or the box would be typed into behind a
            // triangle and the folder would appear somewhere unseen.
            openCollapsed(menu.node.account, menu.node.name);
            setCreatingFor(null);
            setCreatingUnder({
              account: menu.node.account,
              parent: menu.node.name,
            });
            setNewName("");
            setMenu(null);
          }}
          onMove={
            menu.fixed
              ? undefined
              : () => {
                  setMovingFolder({ node: menu.node, x: menu.x, y: menu.y });
                  setMenu(null);
                }
          }
          onDelete={
            menu.fixed
              ? undefined
              : () => {
                  setConfirmDelete({ node: menu.node, x: menu.x, y: menu.y });
                  setMenu(null);
                }
          }
        />
      ) : null}
      {fixedMenu ? (
        <FolderContextMenu
          x={fixedMenu.x}
          y={fixedMenu.y}
          note={t("systemFolderFixed")}
          onDismiss={() => setFixedMenu(null)}
        />
      ) : null}
      {accountMenu ? (
        <FolderContextMenu
          x={accountMenu.x}
          y={accountMenu.y}
          onDismiss={() => setAccountMenu(null)}
          onNewFolder={() => {
            // Somewhere to put it, and somewhere to see it made.
            openAccount(accountMenu.account);
            setCreatingUnder(null);
            setCreatingFor(accountMenu.account);
            setNewName("");
            setAccountMenu(null);
          }}
        />
      ) : null}
      {movingFolder ? (
        <FolderMovePicker
          moving={movingFolder.node}
          rows={accountFolders.filter(
            (f) =>
              f.account.toLowerCase() ===
              movingFolder.node.account.toLowerCase()
          )}
          x={movingFolder.x}
          y={movingFolder.y}
          onDismiss={() => setMovingFolder(null)}
          onMove={(target) => {
            const node = movingFolder.node;
            setMovingFolder(null);
            // The same rename the drag uses: a folder's name is where it
            // is, so moving it is giving it the name of where it is going.
            void whileBusy(node.account, node.name, async () => {
              try {
                await onRenameFolder(
                  node.account,
                  node.name,
                  target ? `${target}/${node.label}` : node.label
                );
              } catch (err) {
                toast.error(
                  err instanceof Error
                    ? err.message
                    : t("couldNotMoveFolder")
                );
              }
            });
          }}
        />
      ) : null}
      {confirmDelete ? (
        <FolderDeleteConfirm
          x={confirmDelete.x}
          y={confirmDelete.y}
          label={confirmDelete.node.label}
          onOutlook={isOutlookAccount(confirmDelete.node.account)}
          busy={deleting}
          onConfirm={() => void runDelete()}
          onDismiss={() => setConfirmDelete(null)}
        />
      ) : null}
    </aside>
  );
}
