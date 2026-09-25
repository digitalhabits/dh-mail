"use client";

/*
 * The folder rail's rows and their menus: a system view (Sent, Drafts, Trash,
 * Junk), a folder with its drag and drop and its right-click menu, the
 * question before a folder is deleted, and the picker that moves a folder.
 *
 * The rail itself is MailFolderRail.tsx.
 */

import * as React from "react";
import {
  ChevronRight,
  Folder,
  FolderInput,
  FolderPlus,
  Home,
  Loader2,
  Pencil,
  Trash2,
} from "lucide-react";
import { buildFolderTree, filterFolderTree, type FolderTreeNode } from "@/lib/mail/folder-tree";
import { folderFavouriteKey } from "@/lib/mail/folder-favourites";
import { type MailAccountFolder } from "@/lib/mail/folder-types";
import { useMailT } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";
import {
  HeartIcon,
  MAIL_FOLDER_DRAG_TYPE,
  ROLE_ICON,
  SPRING_OPEN_MS,
  clearFolderDragImage,
  setFolderDragImage,
  useDragOver,
} from "@/components/mail/folder-rail-shared";
import { type DropState, type FolderDrag, folderParentPath } from "@/lib/mail/folder-drop";
import { folderRowDropState } from "@/lib/mail/folder-drop";

/** ── the four views at the top ─────────────────────────────────────────── */

export function SystemRow({
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

export function FolderRow({
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
  const springRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const { refuses, carrying, beingCarried, state, takesDrop, canMoveThisFolder } =
    folderRowDropState({
      node,
      drop,
      folderDrag,
      renaming: Boolean(renaming),
      busy: Boolean(busy),
    });
  const { over, onEnter, onLeave, reset } = useDragOver({
    id: folderFavouriteKey(node.account, node.name),
    over: dragOver,
    setOver: setDragOver,
  });
  const RowIcon = node.role ? ROLE_ICON[node.role] : Folder;

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
      {/* The address, the heart and the count stand aside while the row is
          being renamed, or is taking what is held over it. */}
      {!renaming && !(over && takesDrop) ? (
        <FolderRowTrail
          node={node}
          accountTag={accountTag}
          favourite={favourite}
          inFavourites={inFavourites}
          active={active}
          onToggleFavourite={onToggleFavourite}
        />
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
export function FolderContextMenu({
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
export function FolderDeleteConfirm({
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
export function FolderMovePicker({
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


/** The end of a folder row: its mailbox (under Favourites), its heart, its count. */
function FolderRowTrail({
  node,
  accountTag,
  favourite,
  inFavourites,
  active,
  onToggleFavourite,
}: {
  node: FolderTreeNode;
  accountTag: string | undefined;
  favourite: boolean;
  inFavourites?: boolean;
  active: boolean;
  onToggleFavourite: () => void;
}) {
  return (
    <>
      {accountTag ? (
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
      {!node.implied ? (
        <FavouriteHeart
          label={node.label}
          favourite={favourite}
          inFavourites={inFavourites}
          active={active}
          onToggle={onToggleFavourite}
        />
      ) : null}
      {node.count ? (
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
    </>
  );
}

/**
 * The heart on a folder row, which puts the folder in Favourites or takes
 * it out. It shows on hover, and stays showing once it is on — the same
 * mark the to-do app uses for the same idea, so a favourite means one
 * thing across the two.
 */
function FavouriteHeart({
  label,
  favourite,
  inFavourites,
  active,
  onToggle,
}: {
  label: string;
  favourite: boolean;
  inFavourites?: boolean;
  active: boolean;
  onToggle: () => void;
}) {
  const t = useMailT();
  return (
    <button
      type="button"
      tabIndex={-1}
      title={t(favourite ? "removeFromFavourites" : "addToFavourites")}
      aria-label={
        favourite
          ? `${t("removeFromFavourites")}: ${label}`
          : `${t("addToFavourites")}: ${label}`
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
        onToggle();
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
  );
}
