"use client";

/**
 * The "Move to folder" menu: type-ahead over the folders, with Inbox,
 * Archived, Junk and Bin above them. Moved out of MailFolders.tsx, which
 * was at the size limit.
 */

import * as React from "react";
import {
  Archive,
  CornerDownLeft,
  Folder,
  FolderInput,
  Inbox,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { toast } from "@/lib/mail/toast";


import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { MailPopoverContent } from "@/components/mail/MailPopoverContent";
import { type MailFolder } from "@/lib/mail/folder-types";
import {
  checkNewFolderName,
  folderPickItems,
  newFolderNameProblem,
  type FolderPickItem,
} from "@/lib/mail/folder-picker";
import { mailSay, useMailT } from "@/lib/mail/i18n";
import { THREAD_ACTION_CLASS } from "@/components/mail/thread-actions";
import { cn } from "@/lib/utils";
import {
  FolderNameLabel,
  NewFolderFooter,
  NewFolderRow,
  NO_HIGHLIGHT,
  folderNamesOn,
  useDismissFolderPopover,
} from "@/components/mail/MailFolders";

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
  account,
  onMoved,
  onMoveToJunk,
  destinations,
  here,
  openSignal,
  onClosed,
  trigger,
  title = "Move to folder",
}: {
  folders: MailFolder[];
  /**
   * The mailbox of the conversation. Only its folders are offered: the list
   * is every mailbox's, and a Gmail label was offered to a KU message.
   */
  account?: string;
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
  /** Called when the menu, once open, closes: the row menu goes with it. */
  onClosed?: () => void;
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
  const wasOpen = React.useRef(false);
  React.useEffect(() => {
    if (open) wasOpen.current = true;
    else if (wasOpen.current) {
      wasOpen.current = false;
      onClosed?.();
    }
  }, [open, onClosed]);
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
  const filable = React.useMemo(() => {
    const own = account ? folderNamesOn(account) : null;
    // A folder under the bin or under Junk is deleted or junk itself: filing
    // mail there is binning it by a longer road. The rail still shows them.
    const binned = folders
      .filter((f) => f.role === "trash" || f.role === "junk")
      .map((f) => `${f.name.toLowerCase()}/`);
    return folders.filter(
      (f) =>
        !f.role &&
        !f.virtual &&
        (!own || own.has(f.name.toLowerCase())) &&
        !binned.some((prefix) => f.name.toLowerCase().startsWith(prefix))
    );
    // `open`: the kept list may have grown since the menu was last opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders, account, open]);
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
