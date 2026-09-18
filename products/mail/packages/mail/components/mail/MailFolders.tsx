"use client";

import * as React from "react";
import {
  Archive,
  ArrowLeft,
  ChevronDown,
  CornerDownLeft,
  FilePen,
  Folder,
  FolderInput,
  Inbox,
  FolderPlus,
  Loader2,
  Send,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { toast } from "@/lib/mail/toast";

import { shouldIgnoreFetchError } from "@/lib/mail/ignore-fetch-error";

import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { MailPopoverContent } from "@/components/mail/MailPopoverContent";
import {
  mergeFoldersByName,
  type MailAccountFolder,
  type MailFolder,
} from "@/lib/mail/folder-types";
import {
  applyStickyFolderCounts,
  bumpFolderCount,
  type StickyFolderCounts,
} from "@/lib/mail/folder-counts";
import {
  checkNewFolderName,
  folderPickItems,
  newFolderNameProblem,
  type FolderPickItem,
} from "@/lib/mail/folder-picker";
import { mailSay, useMailT } from "@/lib/mail/i18n";
import { THREAD_ACTION_CLASS } from "@/components/mail/thread-actions";
import { cn } from "@/lib/utils";
import { mailApiJson as apiJson } from "@/lib/mail/api";


/** Nested Gmail labels use `/` — show `…/leaf`; full path is on hover. */
function formatFolderLabel(name: string): string {
  const parts = name.split("/").filter(Boolean);
  if (parts.length <= 1) return parts[0] || name;
  return `…/${parts[parts.length - 1]}`;
}

/**
 * Dismiss a folder popover when the user clicks the thread (HTML mail is an
 * iframe — Radix never sees that as an outside click).
 *
 * `shouldIgnore` keeps the menu open during HTML5 thread-drag filing.
 * `onDismiss` should run the same cleanup as the popover’s controlled close.
 */
function useDismissFolderPopover(
  open: boolean,
  onDismiss: () => void,
  options: {
    contentRef: React.RefObject<HTMLElement | null>;
    triggerRef: React.RefObject<HTMLElement | null>;
    shouldIgnore?: () => boolean;
  }
): void {
  const { contentRef, triggerRef, shouldIgnore } = options;
  React.useEffect(() => {
    if (!open) return;
    const isInside = (node: EventTarget | null) => {
      if (!(node instanceof Node)) return false;
      if (contentRef.current?.contains(node)) return true;
      if (triggerRef.current?.contains(node)) return true;
      if (node instanceof Element) {
        return Boolean(node.closest("[data-radix-popper-content-wrapper]"));
      }
      return false;
    };
    const onPointerDown = (event: PointerEvent) => {
      if (shouldIgnore?.()) return;
      if (isInside(event.target)) return;
      onDismiss();
    };
    const onWindowBlur = () => {
      if (shouldIgnore?.()) return;
      onDismiss();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, [open, onDismiss, contentRef, triggerRef, shouldIgnore]);
}

function FolderNameLabel({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  return (
    <span
      className={cn("min-w-0 flex-1 truncate text-left", className)}
      title={name}
    >
      {formatFolderLabel(name)}
    </span>
  );
}

/** HTML5 DnD payload for filing a thread onto a folder. */
export const MAIL_THREAD_DRAG_TYPE = "application/x-redd-mail-thread";

export type MailThreadDragPayload = {
  account: string;
  threadId: string;
};

/**
 * What is being dragged, while it is being dragged.
 *
 * Kept here rather than read off the DataTransfer, because a `dragover`
 * handler is not allowed to read the data — only `dragstart` and `drop`
 * are. So anything that has to decide how to *look* mid-drag, rather than
 * what to do on the drop, has to be told out of band. The folder rail dims
 * every mailbox except this one, and this is how it knows which.
 */
let mailThreadDragActive = false;
let mailThreadDragging: MailThreadDragPayload | null = null;
const mailThreadDragListeners = new Set<() => void>();

function notifyMailThreadDrag(): void {
  for (const listener of mailThreadDragListeners) listener();
}

export function setMailThreadDragData(
  dt: DataTransfer,
  thread: MailThreadDragPayload,
  /** Named on the chip that follows the pointer. */
  label?: string
): void {
  mailThreadDragActive = true;
  mailThreadDragging = thread;
  notifyMailThreadDrag();
  const payload = JSON.stringify(thread);
  dt.setData(MAIL_THREAD_DRAG_TYPE, payload);
  dt.setData("text/plain", `redd-mail-thread:${payload}`);
  dt.effectAllowed = "move";
  if (label) setMailThreadDragImage(dt, label);
}

/**
 * What follows the pointer while a conversation is being filed.
 *
 * Without this the browser photographs the row being dragged and carries
 * that: a full-width slab of list, square-cornered and barely see-through,
 * sitting over the folder names it is being aimed at. The one thing a
 * reader needs to see mid-drag is the name of the folder under the
 * pointer, and the picture of what they picked up was covering it.
 *
 * A small rounded chip instead, well under half opaque, and lifted above
 * the pointer rather than hung below it — so the row being aimed at is
 * never the row underneath the picture.
 */
function setMailThreadDragImage(dt: DataTransfer, label: string): void {
  if (typeof document === "undefined" || !label) return;
  const chip = document.createElement("div");
  chip.textContent = label;
  chip.setAttribute(
    "style",
    [
      // Off-screen but laid out: the browser can only photograph something
      // it has actually drawn.
      "position:fixed",
      "top:-1000px",
      "left:-1000px",
      "max-width:170px",
      "overflow:hidden",
      "text-overflow:ellipsis",
      "white-space:nowrap",
      "padding:3px 9px",
      "border-radius:9999px",
      "background:rgba(26,39,53,0.55)",
      "color:#fff",
      "font:600 11px/1.35 ui-sans-serif,-apple-system,system-ui,sans-serif",
    ].join(";")
  );
  document.body.appendChild(chip);
  try {
    // Bottom-left of the chip at the pointer, so it floats up and to the
    // right and leaves the folder under the cursor in plain sight.
    dt.setDragImage(chip, 6, chip.offsetHeight + 8);
  } catch {
    // Some shells refuse a custom image; the default is only ugly.
  }
  // The photograph is taken during this tick. After it, this is litter.
  window.setTimeout(() => chip.remove(), 0);
}

export function clearMailThreadDrag(): void {
  mailThreadDragActive = false;
  if (mailThreadDragging) {
    mailThreadDragging = null;
    notifyMailThreadDrag();
  }
}

/** The conversation in the air, or null at rest. */
export function draggingMailThread(): MailThreadDragPayload | null {
  return mailThreadDragging;
}

/** The mailbox it came from, which is the only one it can be filed on. */
export function draggingMailAccount(): string | null {
  return mailThreadDragging?.account ?? null;
}

function subscribeMailThreadDrag(onChange: () => void): () => void {
  mailThreadDragListeners.add(onChange);
  return () => {
    mailThreadDragListeners.delete(onChange);
  };
}

/**
 * The mailbox being dragged from, as state.
 *
 * A `dragend` of its own, because a drag can end anywhere — outside the
 * window, on the desktop, on a row that refused it — and every one of
 * those has to put the rail back the way it was.
 */
export function useDraggingMailAccount(): string | null {
  const account = React.useSyncExternalStore(
    subscribeMailThreadDrag,
    draggingMailAccount,
    () => null
  );
  React.useEffect(() => {
    const onEnd = () => clearMailThreadDrag();
    window.addEventListener("dragend", onEnd);
    window.addEventListener("drop", onEnd);
    return () => {
      window.removeEventListener("dragend", onEnd);
      window.removeEventListener("drop", onEnd);
    };
  }, []);
  return account;
}

export function isMailThreadDrag(dt?: DataTransfer): boolean {
  if (mailThreadDragActive) return true;
  if (!dt) return false;
  return [...dt.types].includes(MAIL_THREAD_DRAG_TYPE);
}

export function readMailThreadDragData(
  dt: DataTransfer
): MailThreadDragPayload | null {
  const raw =
    dt.getData(MAIL_THREAD_DRAG_TYPE) ||
    dt.getData("text/plain").replace(/^redd-mail-thread:/, "");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<MailThreadDragPayload>;
    if (
      typeof parsed.account === "string" &&
      parsed.account &&
      typeof parsed.threadId === "string" &&
      parsed.threadId
    ) {
      return { account: parsed.account, threadId: parsed.threadId };
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Session cache so every open of the folder menu isn't a cold fetch.
 *
 * One row per account per folder, the way the provider holds them. Anything
 * that wants the old single list folds them together with
 * `mergeFoldersByName` — the rail is the one place that needs them apart.
 */
let foldersCache: MailAccountFolder[] | null = null;
let foldersListeners = new Set<(folders: MailAccountFolder[]) => void>();
/** Corrections held over the provider's numbers — see `lib/mail/folder-counts`. */
const stickyCounts: StickyFolderCounts = new Map();

function notifyFolders(folders: MailAccountFolder[]) {
  foldersCache = folders;
  for (const listener of foldersListeners) listener(folders);
}

function applyStickyCounts(folders: MailAccountFolder[]): MailAccountFolder[] {
  return applyStickyFolderCounts(folders, stickyCounts, Date.now());
}

export async function refreshMailFolders(
  account?: string
): Promise<MailAccountFolder[]> {
  const params = new URLSearchParams();
  if (account && account !== "all") params.set("account", account);
  const baseQs = params.toString();
  const withParam = (extra: string) => {
    const joined = [baseQs, extra].filter(Boolean).join("&");
    return `/api/mail/folders${joined ? `?${joined}` : ""}`;
  };

  // Names first (no per-label Gmail gets), then fill counts in the background.
  const fast = await apiJson<{ folders: MailAccountFolder[] }>(
    withParam("includeCounts=0")
  );
  const mergedFast = applyStickyCounts(fast.folders);
  notifyFolders(mergedFast);

  void apiJson<{ folders: MailAccountFolder[] }>(withParam("includeCounts=1"))
    .then((json) => {
      notifyFolders(applyStickyCounts(json.folders));
    })
    .catch(() => {
      // Keep the names-only list; badge counts stay 0 until the next refresh.
    });

  return mergedFast;
}

/**
 * A folder gained or lost a conversation. Show that now.
 *
 * Both providers take a moment to include a change of this kind in a search,
 * and the folder counts come from a search. Without this the list under an
 * open folder shows one row and the badge beside its name still says two.
 */
export function bumpMailFolderCount(
  account: string,
  name: string,
  delta: number
): void {
  notifyFolders(
    bumpFolderCount(
      foldersCache ?? [],
      stickyCounts,
      account,
      name,
      delta,
      Date.now()
    )
  );
}

export function useMailFolders(
  accountFilter: string,
  options?: { deferMs?: number }
) {
  const deferMs = options?.deferMs ?? 0;
  const [accountFolders, setFolders] = React.useState<MailAccountFolder[]>(
    () => foldersCache ?? []
  );
  const [loading, setLoading] = React.useState(!foldersCache);

  React.useEffect(() => {
    const listener = (next: MailAccountFolder[]) => setFolders(next);
    foldersListeners.add(listener);
    let cancelled = false;
    setLoading(true);

    const start = () => {
      void refreshMailFolders(accountFilter)
        .then((list) => {
          if (!cancelled) setFolders(list);
        })
        .catch(() => {
          if (!cancelled && !shouldIgnoreFetchError()) {
            toast.error(mailSay("couldNotLoadFolders"));
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };

    // Let the inbox thread list claim the network first when asked.
    const timer =
      deferMs > 0 ? window.setTimeout(start, deferMs) : (start(), null);

    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
      foldersListeners.delete(listener);
    };
  }, [accountFilter, deferMs]);

  /**
   * The merged list, for everything built before folders had accounts.
   *
   * Memoised on the rows: the menu re-renders on every keystroke in its
   * filter box, and folding the list again each time would hand it a new
   * array to diff for no reason.
   */
  const folders = React.useMemo(
    () => mergeFoldersByName(accountFolders),
    [accountFolders]
  );

  return {
    folders,
    accountFolders,
    loading,
    refresh: () => refreshMailFolders(accountFilter),
  };
}

/** Folder icon + chevron at the end of the All / In CRM / … tab row. */
/**
 * No row is highlighted. The highlight is both the keyboard cursor and what
 * the pointer is on, so it has to be able to be nowhere: hovering the footer
 * below the list must take it off the row the pointer left.
 */
const NO_HIGHLIGHT = -1;

/**
 * The way in to making a folder.
 *
 * Typing a name into the box has always made one, but the box says "Filter
 * folders" and nothing said the other thing was there. This is the button
 * that says it.
 */
function NewFolderFooter({
  onClick,
  onHover,
  disabled,
}: {
  onClick: () => void;
  /** Take the highlight off the list — the pointer is down here now. */
  onHover: () => void;
  disabled?: boolean;
}) {
  const t = useMailT();
  return (
    <div className="border-t border-stone-100 p-1">
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        onMouseEnter={onHover}
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-stone-800 hover:bg-stone-50 disabled:opacity-60"
      >
        <FolderPlus className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />
        {t("newFolder")}
      </button>
    </div>
  );
}

/**
 * The row that makes a folder.
 *
 * Making one is not quick — the provider makes it, and then every folder is
 * listed again to pick up its number. `pending` is what says the Enter landed,
 * so nobody presses it twice.
 */
function NewFolderRow({
  name,
  highlighted,
  disabled,
  pending,
  onPick,
  onHover,
}: {
  name: string;
  highlighted: boolean;
  disabled?: boolean;
  pending?: boolean;
  onPick: () => void;
  onHover: () => void;
}) {
  const t = useMailT();
  return (
    <button
      type="button"
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      data-picked={highlighted || pending ? "true" : undefined}
      className="mail-menu-pick flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm text-stone-800"
      onMouseEnter={onHover}
      onClick={onPick}
    >
      {pending ? (
        <Loader2
          className="h-4 w-4 shrink-0 animate-spin text-teal-600"
          aria-hidden
        />
      ) : (
        <FolderPlus className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />
      )}
      <span className="min-w-0 flex-1 truncate">
        {pending ? t("makingFolder") : t("makeFolder")} &lsquo;{name}&rsquo;
        {pending ? "…" : null}
      </span>
      {highlighted && !pending ? (
        <CornerDownLeft className="h-3.5 w-3.5 shrink-0" />
      ) : null}
    </button>
  );
}

export function FoldersTabMenu({
  folders,
  loading,
  onOpenFolder,
  onOpenSent,
  onOpenDrafts,
  draftCount,
  onOpenTrash,
  onOpenJunk,
  onCreateFolder,
  onMenuOpen,
  onDropThread,
  onNavy = false,
  iconOnly = false,
}: {
  folders: MailFolder[];
  loading: boolean;
  onOpenFolder: (folder: MailFolder) => void;
  /** Sent lives here rather than in the tab row — see MAIL_LIST_TABS. */
  onOpenSent?: () => void;
  /** Drafts, ours and the providers', sits under Sent. */
  onOpenDrafts?: () => void;
  /** How many unsent messages there are. Sent has no count on purpose. */
  draftCount?: number | null;
  /**
   * Trash sits under Sent and Drafts: those are places you go on purpose,
   * this is where you go when something has gone wrong.
   */
  onOpenTrash?: () => void;
  /** Junk, under Trash. The reader comes here to rescue something. */
  onOpenJunk?: () => void;
  onCreateFolder: (name: string) => Promise<void>;
  /** Refresh counts when the menu opens (Gmail totals catch up eventually). */
  onMenuOpen?: () => void;
  /** File a dragged thread onto a folder. */
  onDropThread?: (
    folderName: string,
    thread: MailThreadDragPayload
  ) => void | Promise<void>;
  /** Trigger sits on the navy list chrome. */
  onNavy?: boolean;
  /** Square icon button (avatar-rail chrome) instead of the tab-row trigger. */
  iconOnly?: boolean;
}) {
  const t = useMailT();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [highlight, setHighlight] = React.useState(0);
  const [saving, setSaving] = React.useState(false);
  /** The name being made, while the provider is making it. */
  const [creating, setCreating] = React.useState<string | null>(null);
  /** The box names a new folder rather than filtering the list. */
  const [naming, setNaming] = React.useState(false);
  const [dragOverTrigger, setDragOverTrigger] = React.useState(false);
  const [dragOverFolder, setDragOverFolder] = React.useState<string | null>(
    null
  );
  const openedByDragRef = React.useRef(false);
  const triggerDragDepth = React.useRef(0);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const searchRef = React.useRef<HTMLInputElement | null>(null);
  const ignoreDismissWhileDrag = React.useCallback(
    () => openedByDragRef.current,
    []
  );

  const q = query.trim().toLowerCase();
  const items: FolderPickItem[] = folderPickItems(folders, query, { naming });
  const nameProblem = naming
    ? newFolderNameProblem(checkNewFolderName(folders, query))
    : null;
  /** The one row naming mode shows, once the name can be used. */
  const newFolder =
    naming && items[0]?.kind === "create" ? items[0] : null;

  const dismissMenu = React.useCallback(() => {
    if (openedByDragRef.current) return;
    setOpen(false);
    setQuery("");
    setHighlight(0);
    setNaming(false);
    setDragOverTrigger(false);
    setDragOverFolder(null);
    openedByDragRef.current = false;
  }, []);

  const startNaming = React.useCallback(() => {
    setNaming(true);
    setQuery("");
    setHighlight(0);
    requestAnimationFrame(() => searchRef.current?.focus());
  }, []);

  const openMenu = React.useCallback(
    (fromDrag: boolean) => {
      if (fromDrag) openedByDragRef.current = true;
      setOpen(true);
      onMenuOpen?.();
    },
    [onMenuOpen]
  );

  useDismissFolderPopover(open, dismissMenu, {
    contentRef,
    triggerRef,
    shouldIgnore: ignoreDismissWhileDrag,
  });

  React.useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  React.useEffect(() => {
    if (!open) return;
    setQuery("");
    setHighlight(0);
    setNaming(false);
    // Don't steal focus while filing via drag — the pointer is busy.
    if (!openedByDragRef.current) {
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onDragEnd = () => {
      setDragOverTrigger(false);
      setDragOverFolder(null);
      triggerDragDepth.current = 0;
      if (openedByDragRef.current) {
        openedByDragRef.current = false;
        setOpen(false);
      }
    };
    window.addEventListener("dragend", onDragEnd);
    return () => window.removeEventListener("dragend", onDragEnd);
  }, [open]);

  const pick = async (item: (typeof items)[number]) => {
    if (saving) return;
    if (item.kind === "folder") {
      onOpenFolder(item.folder);
      dismissMenu();
      return;
    }
    setSaving(true);
    setCreating(item.name);
    try {
      await onCreateFolder(item.name);
      setQuery("");
      setNaming(false);
      setOpen(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : mailSay("couldNotMakeFolder")
      );
    } finally {
      setSaving(false);
      setCreating(null);
    }
  };

  const acceptThreadDrag = (e: React.DragEvent) => {
    if (!isMailThreadDrag(e.dataTransfer)) return false;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    return true;
  };

  const dropOnFolder = async (folderName: string, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const thread = readMailThreadDragData(e.dataTransfer);
    setDragOverFolder(null);
    setDragOverTrigger(false);
    openedByDragRef.current = false;
    setOpen(false);
    if (!thread || !onDropThread) return;
    try {
      await onDropThread(folderName, thread);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : mailSay("couldNotMove"));
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        // While dragging a thread, keep the menu open even if Radix tries to
        // dismiss it (focus moves oddly during HTML5 DnD).
        if (!next && openedByDragRef.current) return;
        setOpen(next);
        if (next) onMenuOpen?.();
        if (!next) {
          setQuery("");
          setHighlight(0);
          setNaming(false);
          setDragOverTrigger(false);
          setDragOverFolder(null);
          openedByDragRef.current = false;
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          title={t("folders")}
          aria-label={t("folders")}
          className={
            iconOnly
              ? cn(
                  "rounded-md p-1.5",
                  onNavy
                    ? cn(
                        open
                          ? "bg-white/15 text-white"
                          : "text-white/70 hover:bg-white/10 hover:text-white",
                        dragOverTrigger && "bg-white/10 text-teal-200"
                      )
                    : cn(
                        open
                          ? "bg-stone-200/70 text-stone-900"
                          : "text-stone-500 hover:bg-stone-200/60 hover:text-stone-800",
                        dragOverTrigger && "bg-teal-50 text-teal-800"
                      )
                )
              : cn(
                  // Same underline metrics as All / In Contacts tabs (-mb-px,
                  // border-b-[3px], pb-1). Center the glyph with the tab label
                  // midline — not the text baseline (items-end sat too low).
                  "-mb-px inline-flex items-center justify-center gap-0.5 border-b-[3px] border-transparent pb-1 font-medium leading-none",
                  onNavy
                    ? cn(
                        "text-white/60 hover:text-white",
                        open && "text-white",
                        dragOverTrigger &&
                          "rounded-md border-teal-300/80 bg-white/10 px-1 text-teal-200"
                      )
                    : cn(
                        "text-stone-500 hover:text-stone-700",
                        open && "text-stone-800",
                        dragOverTrigger &&
                          "rounded-md border-teal-600 bg-teal-50 px-1 text-teal-800"
                      )
                )
          }
          onDragEnter={(e) => {
            if (!isMailThreadDrag(e.dataTransfer)) return;
            e.preventDefault();
            triggerDragDepth.current += 1;
            setDragOverTrigger(true);
            openMenu(true);
          }}
          onDragOver={(e) => {
            acceptThreadDrag(e);
          }}
          onDragLeave={() => {
            triggerDragDepth.current = Math.max(0, triggerDragDepth.current - 1);
            if (triggerDragDepth.current === 0) setDragOverTrigger(false);
          }}
          onDrop={(e) => {
            // Dropping on the icon alone just keeps the menu open — pick a folder.
            if (!acceptThreadDrag(e)) return;
            openMenu(true);
            setDragOverTrigger(false);
          }}
        >
          {iconOnly ? (
            <Folder className="h-4 w-4" />
          ) : (
            <span className="inline-flex h-[1em] min-h-[1.25rem] items-center gap-0.5">
              <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <ChevronDown className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
            </span>
          )}
        </button>
      </PopoverTrigger>
      <MailPopoverContent
        ref={contentRef}
        align={iconOnly ? "start" : "end"}
        className="w-72 p-0"
        onDragOver={(e) => {
          acceptThreadDrag(e);
        }}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onPointerDownOutside={dismissMenu}
        onFocusOutside={dismissMenu}
        onInteractOutside={dismissMenu}
      >
        {onOpenSent || onOpenDrafts || onOpenTrash || onOpenJunk ? (
          <div className="border-b border-stone-100 p-1">
            {onOpenSent ? (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-stone-800 hover:bg-stone-50"
                onClick={() => {
                  setOpen(false);
                  onOpenSent();
                }}
              >
                <Send className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />
                {t("viewSent")}
              </button>
            ) : null}
            {onOpenDrafts ? (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-stone-800 hover:bg-stone-50"
                onClick={() => {
                  setOpen(false);
                  onOpenDrafts();
                }}
              >
                <FilePen className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />
                Drafts
                {draftCount ? (
                  <span className="tabular-nums text-xs text-stone-400">
                    {draftCount}
                  </span>
                ) : null}
              </button>
            ) : null}
            {onOpenTrash ? (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-stone-800 hover:bg-stone-50"
                onClick={() => {
                  setOpen(false);
                  onOpenTrash();
                }}
              >
                <Trash2 className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />
                {t("viewTrash")}
              </button>
            ) : null}
            {onOpenJunk ? (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-stone-800 hover:bg-stone-50"
                onClick={() => {
                  setOpen(false);
                  onOpenJunk();
                }}
              >
                <ShieldAlert
                  className="h-4 w-4 shrink-0 text-stone-400"
                  aria-hidden
                />
                {t("viewJunk")}
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="border-b border-stone-100 p-2">
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && items.length) {
                e.preventDefault();
                setHighlight((h) => (h < 0 ? 0 : (h + 1) % items.length));
              } else if (e.key === "ArrowUp" && items.length) {
                e.preventDefault();
                setHighlight((h) =>
                  h < 0 ? items.length - 1 : (h - 1 + items.length) % items.length
                );
              } else if (e.key === "Enter") {
                e.preventDefault();
                const item = items[highlight];
                if (item) void pick(item);
              } else if (e.key === "Escape") {
                e.preventDefault();
                // Back to the list first — Escape closes the menu only when
                // there is nothing else to step out of.
                if (naming) {
                  setNaming(false);
                  setQuery("");
                } else {
                  dismissMenu();
                }
              }
            }}
            placeholder={
              naming ? t("nameForNewFolder") : t("filterFoldersPlaceholder")
            }
            readOnly={saving}
            className="w-full rounded-lg border border-teal-600 px-2.5 py-1.5 text-sm outline-none read-only:text-stone-400"
          />
        </div>
        {naming ? (
          <div className="py-1">
            {creating ? (
              <NewFolderRow
                name={creating}
                highlighted
                pending
                onPick={() => {}}
                onHover={() => {}}
              />
            ) : newFolder ? (
              <NewFolderRow
                name={newFolder.name}
                highlighted
                disabled={saving}
                onPick={() => void pick(newFolder)}
                onHover={() => setHighlight(0)}
              />
            ) : (
              <p className="px-2.5 py-2 text-sm text-stone-400">
                {nameProblem ?? t("typeNameThenEnter")}
              </p>
            )}
          </div>
        ) : loading && !folders.length ? (
          <p className="px-2.5 py-2 text-sm text-stone-400">{t("loading")}</p>
        ) : items.length ? (
          <ul className="max-h-[32rem] overflow-y-auto py-1">
            {items.map((item, i) =>
              item.kind === "folder" ? (
                <li
                  key={item.folder.name}
                  onDragEnter={(e) => {
                    if (!isMailThreadDrag(e.dataTransfer)) return;
                    e.preventDefault();
                    setDragOverFolder(item.folder.name);
                  }}
                  onDragOver={(e) => {
                    if (acceptThreadDrag(e)) setDragOverFolder(item.folder.name);
                  }}
                  onDragLeave={(e) => {
                    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                    setDragOverFolder((current) =>
                      current === item.folder.name ? null : current
                    );
                  }}
                  onDrop={(e) => void dropOnFolder(item.folder.name, e)}
                >
                  <button
                    type="button"
                    disabled={saving}
                    /* The row the keys and the pointer agree on. Marked
                       rather than hovered, because the arrows move it
                       without the pointer going anywhere — see
                       `mail-menu-pick`, which the snooze menu wears too. */
                    data-picked={i === highlight ? "true" : undefined}
                    className={cn(
                      "mail-menu-pick flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm text-stone-800",
                      dragOverFolder === item.folder.name &&
                        "bg-teal-50 ring-1 ring-inset ring-teal-600/40"
                    )}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => void pick(item)}
                  >
                    <Folder className="h-4 w-4 shrink-0 text-stone-400" />
                    <FolderNameLabel name={item.folder.name} />
                    <span className="tabular-nums text-xs text-stone-400">
                      {item.folder.count}
                    </span>
                    {i === highlight ? (
                      <CornerDownLeft className="h-3.5 w-3.5 shrink-0" />
                    ) : null}
                  </button>
                </li>
              ) : (
                <li key={`new:${item.name}`}>
                  <NewFolderRow
                    name={item.name}
                    highlighted={i === highlight}
                    disabled={saving}
                    pending={creating === item.name}
                    onPick={() => void pick(item)}
                    onHover={() => setHighlight(i)}
                  />
                </li>
              )
            )}
          </ul>
        ) : (
          <p className="px-2.5 py-2 text-sm text-stone-400">
            {q ? t("noMatchingFolders") : t("noFoldersYet")}
          </p>
        )}
        {naming ? null : (
          <NewFolderFooter
            onClick={startNaming}
            onHover={() => setHighlight(NO_HIGHLIGHT)}
            disabled={saving}
          />
        )}
      </MailPopoverContent>
    </Popover>
  );
}

/** Replaces the tab row while a folder is open. */
/**
 * The open folder, and the folders it sits inside.
 *
 * A nested folder used to be one pill reading `…/A second test`, which
 * gives the reader an ellipsis where the answer should be and makes them
 * hover to learn where they are. The parents are written out now, in plain
 * grey, each one a way back up to it.
 *
 * Only the open folder is an object: one pill, one thing you are in. The
 * parents are text, so the row reads as a place with a path to it rather
 * than as a line of chips of equal weight.
 */
export function FolderViewHeader({
  folder,
  onBack,
  onOpenParent,
  onNavy = false,
}: {
  folder: MailFolder;
  onBack: () => void;
  /** Open one of the folders this one sits inside, by its whole path. */
  onOpenParent?: (path: string) => void;
  onNavy?: boolean;
}) {
  const t = useMailT();
  const parts = folder.name.split("/").filter(Boolean);
  const leaf = parts[parts.length - 1] ?? folder.name;
  /** Each parent with the whole path that opens it. */
  const parents = parts.slice(0, -1).map((label, i) => ({
    label,
    path: parts.slice(0, i + 1).join("/"),
  }));
  return (
    <div
      className={cn(
        // No row gap: the three gaps along a breadcrumb are not one gap.
        // The arrow sits close to where the path begins, and the path
        // breathes a little more around its own separators.
        "mt-3 flex items-center border-b pb-2",
        onNavy ? "border-white/10" : "border-stone-200"
      )}
    >
      <button
        type="button"
        title={t("backToInbox")}
        aria-label={t("backToInbox")}
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          // Close to the path it points back along — but not when there is
          // no path, where it would crowd the folder's own pill.
          parents.length ? "mr-[3px]" : "mr-2",
          onNavy
            ? "text-white/70 hover:bg-white/10 hover:text-white"
            : "text-stone-500 hover:bg-stone-200/60 hover:text-stone-800"
        )}
        onClick={onBack}
      >
        <ArrowLeft className="h-4 w-4" />
      </button>
      {/* The way up, one folder at a time. Grey text rather than chips:
          these are where the folder is, not what you are looking at. */}
      {parents.map((parent) => (
        <span
          key={parent.path}
          className="mr-[10px] flex min-w-0 shrink items-center gap-[6px]"
        >
          <button
            type="button"
            title={parent.path}
            className={cn(
              "min-w-0 truncate text-sm",
              onNavy
                ? "text-white/50 hover:text-white/80"
                : "text-stone-400 hover:text-stone-700"
            )}
            onClick={() => onOpenParent?.(parent.path)}
          >
            {parent.label}
          </button>
          <span
            aria-hidden
            className={cn(
              "shrink-0 text-sm",
              onNavy ? "text-white/30" : "text-stone-300"
            )}
          >
            ›
          </span>
        </span>
      ))}
      {/* Filled navy, the same as the folder's own row in the rail and the
          button that opens it. Three places name the folder you are in, and
          they should not each pick their own colour for saying so. */}
      <span
        className="inline-flex min-w-0 shrink-0 items-center gap-1.5 rounded-full bg-[var(--mail-chrome-pinned)] px-3 py-1 text-sm font-medium text-[var(--mail-chrome-pinned-fg)]"
      >
          <Folder className="h-3.5 w-3.5 shrink-0 opacity-70" />
          <span className="min-w-0 flex-1 truncate text-left" title={folder.name}>
            {leaf}
          </span>
          {/* A number, or nothing — never a nought.
              Not every folder has a count to give. Gmail's Archived, Sent
              and Bin are searches rather than folders, so the provider
              offers no total for them, and the zero standing in for "we do
              not know" was printed beside a list of two dozen conversations
              as though it were the answer. A folder that really holds
              nothing says so with an empty list. */}
          {folder.count > 0 ? (
            <span className="shrink-0 opacity-70">· {folder.count}</span>
          ) : null}
      </span>
    </div>
  );
}

/** Type-ahead move-to picker next to archive/delete. */
/** Where a conversation is now, so the menu can say so. */
export type MoveMenuHere = {
  view?: "inbox" | "archived" | "junk" | "trash" | null;
  folder?: string | null;
};

/**
 * The places that are not folders: the four the rail keeps at its head.
 *
 * Each is a move like any other — a conversation leaves where it is and
 * arrives somewhere — so they belong in the menu that moves it, above the
 * folders and in the rail's own order. Only the ones the caller can carry
 * out are shown.
 */
export type MoveMenuDestinations = {
  inbox?: () => void;
  archived?: () => void;
  junk?: () => void;
  trash?: () => void;
};

const DESTINATION_ORDER: Array<{
  key: keyof MoveMenuDestinations;
  icon: typeof Inbox;
  label: string;
}> = [
  { key: "inbox", icon: Inbox, label: "viewInbox" },
  { key: "archived", icon: Archive, label: "viewArchived" },
  { key: "junk", icon: ShieldAlert, label: "viewJunk" },
  { key: "trash", icon: Trash2, label: "viewTrash" },
];

export function MoveToFolderMenu({
  folders,
  onMoved,
  onMoveToJunk,
  destinations,
  here,
  openSignal,
  trigger,
  title = "Move to folder",
}: {
  folders: MailFolder[];
  onMoved: (folderName: string, create: boolean) => Promise<void>;
  /**
   * Junk, pinned above the folders. Filing something as junk is a move, and
   * it does not need a button of its own beside archive and delete.
   *
   * Kept for callers that offer junk and nothing else; `destinations.junk`
   * is the same thing said with the other three.
   */
  onMoveToJunk?: () => void;
  /** Inbox, Archived, Junk and Bin, in the rail's order. */
  destinations?: MoveMenuDestinations;
  /** Marked "where it is now", the way the folder-move menu marks a parent. */
  here?: MoveMenuHere;
  /** Bump to open the menu from elsewhere — the keyboard shortcut does. */
  openSignal?: number;
  /**
   * What opens it, when the toolbar's round icon is the wrong shape.
   *
   * The row's right-click menu offers this among its own items, so there it
   * is a row of that menu — the same arrangement the snooze menu already
   * allows. Given one, the title and label belong to it.
   */
  trigger?: React.ReactNode;
  /**
   * What the trigger says on hover. Given by the caller, because the key
   * that opens this is the caller's to know and the reader's to be told:
   * a menu with a shortcut that nothing on screen names is a shortcut
   * only its author will ever press.
   */
  title?: string;
}) {
  const t = useMailT();
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (openSignal) setOpen(true);
  }, [openSignal]);
  const [query, setQuery] = React.useState("");
  const [highlight, setHighlight] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  /** The name being made, while the provider is making it. */
  const [creating, setCreating] = React.useState<string | null>(null);
  /** The box names a new folder to file this in, rather than filtering. */
  const [naming, setNaming] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);

  /**
   * Everything the menu offers, in one list.
   *
   * The keys walk this and Enter takes whatever is under them, so the four
   * places at the top cannot be a separate list rendered above: a reader
   * pressing Down from the box has to reach Inbox before Academia.
   */
  const junkFallback = destinations?.junk ?? onMoveToJunk;
  const term = query.trim().toLowerCase();
  const places = naming
    ? []
    : DESTINATION_ORDER.flatMap((place) => {
        const run =
          place.key === "junk" ? junkFallback : destinations?.[place.key];
        if (!run) return [];
        const label = t(place.label as Parameters<typeof t>[0]);
        // Type-ahead reaches these the way it reaches a folder.
        if (term && !label.toLowerCase().startsWith(term)) return [];
        return [{ ...place, label, run }];
      });
  /*
    The folders somebody made, and not the ones the provider keeps.

    Inbox, Sent, Drafts, Junk, Archive and the bin are above this list as
    places, or are not filing targets at all — nobody moves a conversation
    into Sent. Left in, the menu offered Inbox twice and offered Drafts as
    somewhere to put a thread.
  */
  const filable = React.useMemo(
    () => folders.filter((f) => !f.role && !f.virtual),
    [folders]
  );
  const folderItems: FolderPickItem[] = folderPickItems(filable, query, {
    naming,
  });
  const items: FolderPickItem[] = folderItems;
  const count = places.length + folderItems.length;
  const nameProblem = naming
    ? newFolderNameProblem(checkNewFolderName(folders, query))
    : null;
  const newFolder =
    naming && items[0]?.kind === "create" ? items[0] : null;

  React.useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  React.useEffect(() => {
    if (open) {
      setQuery("");
      setHighlight(0);
      setNaming(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const startNaming = React.useCallback(() => {
    setNaming(true);
    setQuery("");
    setHighlight(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const dismissMenu = React.useCallback(() => setOpen(false), []);
  useDismissFolderPopover(open, dismissMenu, { contentRef, triggerRef });

  const pick = async (item: (typeof items)[number]) => {
    if (busy) return;
    setBusy(true);
    if (item.kind === "create") setCreating(item.name);
    try {
      if (item.kind === "folder") {
        await onMoved(item.folder.name, false);
      } else {
        await onMoved(item.name, true);
      }
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : mailSay("couldNotMove"));
    } finally {
      setBusy(false);
      setCreating(null);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <button
            ref={triggerRef}
            type="button"
            title={title}
            aria-label={t("moveToFolder")}
            aria-expanded={open}
            className={cn(
              "inline-flex items-center justify-center",
              THREAD_ACTION_CLASS,
              open &&
                "bg-[var(--mail-chrome-selected)] text-[var(--mail-thread-fg)]"
            )}
          >
            <FolderInput />
          </button>
        )}
      </PopoverTrigger>
      <MailPopoverContent
        ref={contentRef}
        /* Named, so a menu this one opens out of can tell a press in here
           from a press outside itself — see ThreadToolbarOverflow. */
        data-mail-move-menu
        align="end"
        className="w-72 p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onPointerDownOutside={dismissMenu}
        onFocusOutside={dismissMenu}
        onInteractOutside={dismissMenu}
      >
        <div className="border-b border-stone-100 p-2">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && count) {
                e.preventDefault();
                setHighlight((h) => (h < 0 ? 0 : (h + 1) % count));
              } else if (e.key === "ArrowUp" && count) {
                e.preventDefault();
                setHighlight((h) =>
                  h < 0 ? count - 1 : (h - 1 + count) % count
                );
              } else if (e.key === "Enter") {
                e.preventDefault();
                // The places come first, so the first few numbers are theirs.
                const place = places[highlight];
                if (place) {
                  setOpen(false);
                  place.run();
                } else {
                  const item = items[highlight - places.length];
                  if (item) void pick(item);
                }
              } else if (e.key === "Escape" && naming) {
                e.preventDefault();
                setNaming(false);
                setQuery("");
              }
            }}
            placeholder={naming ? t("nameForNewFolder") : t("moveTo")}
            readOnly={busy}
            className="w-full rounded-lg border border-teal-600 px-2.5 py-1.5 text-sm outline-none read-only:text-stone-400"
          />
        </div>
        {/* The rail's four, in the rail's order, above the folders. */}
        {places.length ? (
          <ul className="border-b border-stone-100 p-1">
            {places.map((place, i) => {
              const Icon = place.icon;
              const isHere = here?.view === place.key;
              return (
                <li key={place.key}>
                  <button
                    type="button"
                    disabled={busy}
                    data-picked={i === highlight ? "true" : undefined}
                    className="mail-menu-pick flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-stone-800"
                    title={place.key === "junk" ? t("junkHint") : undefined}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => {
                      setOpen(false);
                      place.run();
                    }}
                  >
                    <Icon
                      className="h-4 w-4 shrink-0 text-stone-400"
                      aria-hidden
                    />
                    <span className="truncate">{place.label}</span>
                    {isHere ? (
                      <span className="ml-auto shrink-0 text-xs text-stone-400">
                        {t("whereItIsNow")}
                      </span>
                    ) : i === highlight ? (
                      <CornerDownLeft className="ml-auto h-3.5 w-3.5 shrink-0" />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        {naming ? (
          <div className="py-1">
            {creating ? (
              <NewFolderRow
                name={creating}
                highlighted
                pending
                onPick={() => {}}
                onHover={() => {}}
              />
            ) : newFolder ? (
              <NewFolderRow
                name={newFolder.name}
                highlighted
                disabled={busy}
                onPick={() => void pick(newFolder)}
                onHover={() => setHighlight(0)}
              />
            ) : (
              <p className="px-2.5 py-2 text-sm text-stone-400">
                {nameProblem ?? t("typeNameThenEnter")}
              </p>
            )}
          </div>
        ) : (
        <ul className="max-h-[32rem] overflow-y-auto py-1">
          {items.length ? (
            items.map((item, index) => {
              // The places above hold the first numbers; these carry on.
              const i = index + places.length;
              return item.kind === "folder" ? (
                <li key={item.folder.name}>
                  <button
                    type="button"
                    disabled={busy}
                    /* The row the keys and the pointer agree on — see
                       `mail-menu-pick`, which the snooze menu wears too. */
                    data-picked={i === highlight ? "true" : undefined}
                    className="mail-menu-pick flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm text-stone-800"
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => void pick(item)}
                  >
                    <Folder className="h-4 w-4 shrink-0 text-stone-400" />
                    <FolderNameLabel name={item.folder.name} />
                    {here?.folder &&
                    here.folder.toLowerCase() === item.folder.name.toLowerCase() ? (
                      <span className="ml-auto shrink-0 text-xs text-stone-400">
                        {t("whereItIsNow")}
                      </span>
                    ) : i === highlight ? (
                      <CornerDownLeft className="ml-auto h-3.5 w-3.5 shrink-0" />
                    ) : null}
                  </button>
                </li>
              ) : (
                <li key={`new:${item.name}`}>
                  <NewFolderRow
                    name={item.name}
                    highlighted={i === highlight}
                    disabled={busy}
                    pending={creating === item.name}
                    onPick={() => void pick(item)}
                    onHover={() => setHighlight(i)}
                  />
                </li>
              );
            })
          ) : (
            places.length ? null : (
              <li className="px-2.5 py-2 text-sm text-stone-400">
                {t("noMatchingFolders")}
              </li>
            )
          )}
        </ul>
        )}
        {naming ? null : (
          <NewFolderFooter
            onClick={startNaming}
            onHover={() => setHighlight(NO_HIGHLIGHT)}
            disabled={busy}
          />
        )}
      </MailPopoverContent>
    </Popover>
  );
}
