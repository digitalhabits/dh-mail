"use client";

/*
 * Part of MailPage's markup, moved out of MailPage.tsx.
 *
 * Each component reads the page's slices that it needs (see
 * mail-page-slices.tsx). Markup it shares with the rest of the page
 * comes in as props. The JSX is MailPage's own, word for word.
 */

import { usePageCompose, usePageLayout, usePageList, usePageReader } from "@/components/mail/mail-page-slices";
import { useMailT } from "@/lib/mail/i18n";
import * as React from "react";
import { Search, SquarePen, X } from "lucide-react";
import { beginNativeWindowDragOnMove } from "@/lib/native-shell";
import { cn } from "@/lib/utils";
import { SyncControl } from "@/components/mail/SyncControl";
import { StacksSwitch } from "@/components/mail/stack-threads-setting";
import { AutoReplyPill } from "@/components/mail/auto-reply-pill";
import { threadKey } from "@/lib/mail/thread-copies";
import { SearchOptionsMenu } from "@/components/mail/SearchOptionsMenu";
import { HiddenSearchChip, hiddenSearchChipShown } from "@/components/mail/hidden-account-mark";
import { mailSearchPlaceholder } from "@/components/mail/mail-list-state";
import { TriageButton } from "@/components/mail/team-layer";

/** The row the window is dragged by: search, sync, pause and the view controls. */
export function MailTitleBar({
  layoutMenu,
  listToggle,
  listOut = false,
}: {
  /** The list put away is out on hover: the row moves over with it. */
  listOut?: boolean;
  layoutMenu: React.ReactNode;
  /** The button that hides and shows the list (ListHideButton). */
  listToggle: React.ReactNode;
}) {
  const t = useMailT();
  const pageReader = usePageReader();
  const { activeCustomList, activeFolder, search, searchDeleted, hiddenSearch, searchFocused, searchInputRef, setSearch, setSearchDeleted, setSearchFocused, tab } = usePageList();
  const { chromeDark, titlebarLeft, titlebarToggleLeft, peekTitlebarLeft } = usePageLayout();
  const { startCompose } = usePageCompose();
  // Hidden accounts' hits are in the list: the field says so.
  const chipShown = hiddenSearchChipShown(search, hiddenSearch);
  // The search menu, opened by its chevron or by the hidden chip.
  const [optionsOpen, setOptionsOpen] = React.useState(false);
  const controlsRef = React.useRef<HTMLDivElement>(null);
  const searchRef = React.useRef<HTMLLabelElement>(null);
  const compact = useTitlebarCompact(controlsRef, searchRef);
  return (
    <>
      {/* Overlay title bar — same height as the Mac traffic-light strip
          (matches .dh-titlebar / NativeTitleDragStrip h-11), on the
          screen: at another Text size it is 44 screen pixels still, so the
          controls stay level with the lights. Search sits in
          this row like Outlook, not in a second toolbar underneath.
          `deep` makes empty chrome draggable; inputs stay interactive. */}
      <div
        data-tauri-drag-region="deep"
        // The folder rail's ground, so the bar and the rail read as one
        // frame round the list and the reader, which are lighter. No line
        // under it: the step in colour is the edge. The 1px stays, clear,
        // so nothing below moves.
        className="mail-titlebar mail-chrome-strip relative flex h-[calc(44px/var(--mail-window-scale,1))] shrink-0 items-center gap-3 border-b bg-[var(--mail-sidebar)] transition-[padding-left] ease-out motion-reduce:transition-none"
        style={{
          borderColor: "transparent",
          // Where the row stops. A shell that puts window buttons at the
          // right of the strip (the standalone app on Windows) sets this.
          paddingRight: "var(--mail-titlebar-right, 12px)",
          // Where the controls start — see `titlebarLeft`.
          paddingLeft: listOut ? peekTitlebarLeft : titlebarLeft,
          // At the speed of the rail, so the row follows the folders rather
          // than jumping while they are still sliding.
          transitionDuration: "var(--mail-rail-slide)",
        }}
      >
        {/* The list's button, New email, Sync with its pause menu, then settings,
            then search takes the rest — the whole row standing over the
            list column. A shell can put the search first instead
            — see the standalone app's Windows window in
            apps/mail/src/standalone.css. */}
        {/* The list's button: next to the traffic lights, as a sidebar
            button is, and there whatever the folders are doing — so it is
            always where the hand goes for it. Out of the row, which moves
            over with the list. The -4px answers the row's own. */}
        <div
          className="absolute top-1/2 -translate-y-1/2"
          style={{ left: `calc(${titlebarToggleLeft} - 4px)` }}
        >
          {listToggle}
        </div>
        {/* The whole row: the search takes what the buttons leave (20c). */}
        <div
          ref={controlsRef}
          data-tb-compact={compact ? "" : undefined}
          className="mail-titlebar-controls -ml-[4px] flex min-w-0 flex-1 items-center gap-2"
        >
          {/* First, where it is in reach whatever the list is doing: it
              stood at the head of the list, and went with the list when
              the list was put away. */}
          <button
            type="button"
            title={t("newEmail")}
            aria-label={t("newEmail")}
            className={cn(
              // 2px rounder than a control: the bar's two big objects, New
              // email and the search field, and the mailbox tabs below them.
              "flex h-7 shrink-0 items-center gap-1.5 rounded-[8px] border px-3 text-[13px] font-semibold",
              chromeDark
                ? "border-[var(--mail-action-border)] bg-[var(--mail-action)] text-[var(--mail-action-fg)] hover:bg-[var(--mail-action-hover)]"
                : "border-[var(--mail-field-border-soft)] bg-[var(--mail-field-bg)] text-[var(--mail-chrome-fg)] shadow-sm hover:bg-[var(--mail-chrome-hover)]"
            )}
            onPointerDown={beginNativeWindowDragOnMove}
            onClick={() => startCompose()}
          >
            <SquarePen className="h-3.5 w-3.5" aria-hidden />
            {t("newEmail")}
          </button>
          <SyncControl />
          {/* The auto-reply, when it is on: a pill that opens it, beside
              Sync, as both say what the mailboxes are doing on their own. */}
          <AutoReplyPill onDark={chromeDark} />
          <label
            ref={searchRef}
            className={cn(
              "mail-titlebar-search",
              // h-7 (~28px) centers with traffic lights in the 44px strip.
              // Its own colours, not stone: on the dark theme the blanket
              // rewrite made this the same shade as the bar it sits in, so
              // the box a reader types into had no edges.
              // 12rem at least: room to type beside the hidden-mail chip.
              // The auto-reply pill beside it gives way first.
              // No wider than 40rem: past that a field reads as a bar, and
              // the eye travels too far along it.
              // A frame field (mail.css): no fill and an outline at rest, as
              // the account tabs; white with a stronger edge once clicked
              // into, or while it holds a search (2026-10-29).
              "relative flex h-7 min-w-[12rem] max-w-[40rem] flex-1 items-center rounded-[8px] border border-[var(--mail-frame-field-edge)] bg-[var(--mail-frame-field)] text-[var(--mail-frame-field-ink)]",
              "focus-within:border-[var(--mail-frame-field-focus-edge)] focus-within:bg-[var(--mail-field-bg)]",
              "has-[input:not(:placeholder-shown)]:border-[var(--mail-frame-field-focus-edge)] has-[input:not(:placeholder-shown)]:bg-[var(--mail-field-bg)]"
            )}
          >
            {/* Which mailboxes to search is which mailbox the tabs are
                showing, so no menu for that here any more. What is left is
                the one thing that is about the searching rather than about
                the list: whether deleted mail answers. */}
            <SearchOptionsMenu
              includeDeleted={searchDeleted}
              onIncludeDeletedChange={setSearchDeleted}
              hiddenCount={hiddenSearch.count}
              open={optionsOpen}
              onOpenChange={setOptionsOpen}
              includeHidden={hiddenSearch.on}
              onIncludeHiddenChange={hiddenSearch.set}
            />
            <Search
              className="pointer-events-none h-3.5 w-3.5 shrink-0"
              aria-hidden
            />
            <input
              ref={searchInputRef}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              // A search is names and half-words; macOS offered to
              // capitalise and respell them in a bubble under the box.
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              // An empty box with the cursor in it shows the words it
              // reads — from:, has:attachment, "a phrase" — in place of
              // its name. Gone with the first letter typed.
              placeholder={
                searchFocused && !search
                  ? t("searchHint")
                  : mailSearchPlaceholder({
                      folderName: activeFolder?.name ?? null,
                      customListName: activeCustomList?.name ?? null,
                      tab,
                      t,
                      exceptHidden: hiddenSearch.leftOut,
                    })
              }
              className={cn(
                "h-full min-w-0 flex-1 border-0 bg-transparent py-1 pl-2 text-[13px] text-[var(--mail-chrome-fg)] outline-none placeholder:text-[var(--mail-frame-field-ink)] shadow-none [&::-webkit-search-cancel-button]:hidden",
                // Room for the clear button, and for the hidden chip beside
                // it, only when they are there. An empty box kept 32px for a
                // clear button it does not show, and cut its hint off in
                // front of the empty space.
                chipShown ? "pr-36" : search ? "pr-8" : "pr-2"
              )}
            />
            {chipShown ? (
              <HiddenSearchChip
                count={hiddenSearch.count}
                onOpenOptions={() => setOptionsOpen(true)}
              />
            ) : null}
            {search ? (
              <button
                type="button"
                title={t("clearSearch")}
                aria-label={t("clearSearch")}
                className="absolute right-1.5 flex h-5 w-5 items-center justify-center rounded-full text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                onPointerDown={beginNativeWindowDragOnMove}
                // Clearing takes this button away mid-click, and the
                // <label> round it then passed the click on to its first
                // control, the chevron, which opened the search menu.
                onClick={(e) => {
                  e.preventDefault();
                  setSearch("");
                }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </label>
          {/* The organization's build ranks the inbox from here: it reads
              the whole mailbox shown, as the search beside it does. */}
          <TriageButton />
          {/* Right of the search: the list's switch, then the settings
              button at the end of the row (Ulrik, 2026-10-17). Stacks
              change the list more than anything in Settings, so the switch
              is out here. */}
          <StacksSwitch onDark={chromeDark} openKey={pageReader.selected ? threadKey(pageReader.selected) : null} />
          {layoutMenu}
          {/* Beside the search field, because it is about this mailbox as a
              whole rather than about any list in it — and because a mailbox
              that has stopped fetching has to say so where the eye already
              goes. */}
        </div>
      </div>
    </>
  );
}

/** The least the search field is let be before the buttons drop their words. */
const SEARCH_ROOM_PX = 320;

/**
 * Whether the title bar's buttons go to their icons (20c). The search field
 * keeps 320px: below that the words go, and come back once the field has
 * room for them and its 320px both. Measured, not set by a window width,
 * because what stands in the row (Triage, the auto-reply) differs.
 */
function useTitlebarCompact(
  rowRef: React.RefObject<HTMLDivElement | null>,
  searchRef: React.RefObject<HTMLElement | null>
): boolean {
  const [compact, setCompact] = React.useState(false);
  // What the words took when they went: the room they need to come back.
  const wordsRef = React.useRef(0);
  React.useLayoutEffect(() => {
    const row = rowRef.current;
    const search = searchRef.current;
    if (!row || !search || typeof ResizeObserver === "undefined") return;
    const check = () => {
      const room = search.getBoundingClientRect().width;
      if (!row.hasAttribute("data-tb-compact")) {
        if (room >= SEARCH_ROOM_PX) return;
        // Each word, and the gap before it beside its icon.
        wordsRef.current = [...row.querySelectorAll<HTMLElement>(".mail-tb-label")].reduce(
          (sum, el) => sum + el.getBoundingClientRect().width + 6,
          0
        );
        setCompact(true);
      } else if (room - wordsRef.current >= SEARCH_ROOM_PX + 8) {
        setCompact(false);
      }
    };
    const observer = new ResizeObserver(check);
    observer.observe(row);
    observer.observe(search);
    check();
    return () => observer.disconnect();
  }, [rowRef, searchRef]);
  return compact;
}
