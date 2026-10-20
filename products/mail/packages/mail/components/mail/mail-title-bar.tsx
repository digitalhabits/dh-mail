"use client";

/*
 * Part of MailPage's markup, moved out of MailPage.tsx.
 *
 * Each component takes the page's model (`m`, from useMailPage) and reads
 * the names it needs from it. Markup it shares with the rest of the page
 * comes in as props. The JSX is MailPage's own, word for word.
 */

import * as React from "react";
import { Search, SquarePen, X } from "lucide-react";
import { beginNativeWindowDragOnMove } from "@/lib/native-shell";
import { cn } from "@/lib/utils";
import { SyncControl } from "@/components/mail/SyncControl";
import { StacksSwitch } from "@/components/mail/stack-threads-setting";
import { threadKey } from "@/lib/mail/thread-copies";
import { SearchOptionsMenu } from "@/components/mail/SearchOptionsMenu";
import { HiddenSearchChip, hiddenSearchChipShown } from "@/components/mail/hidden-account-mark";
import { mailSearchPlaceholder } from "@/components/mail/mail-list-state";
import { TriageButton } from "@/components/mail/team-layer";
import type { MailPageModel } from "@/components/mail/use-mail-page";

/** The row the window is dragged by: search, sync, pause and the view controls. */
export function MailTitleBar({
  m,
  layoutMenu,
  listToggle,
  listOut = false,
}: {
  m: MailPageModel;
  /** The list put away is out on hover: the row moves over with it. */
  listOut?: boolean;
  layoutMenu: React.ReactNode;
  /** The button that hides and shows the list (ListHideButton). */
  listToggle: React.ReactNode;
}) {
  const {
    activeCustomList,
    activeFolder,
    chromeDark,
    search,
    searchDeleted,
    hiddenSearch,
    searchFocused,
    searchInputRef,
    setSearch,
    setSearchDeleted,
    setSearchFocused,
    startCompose,
    t,
    tab,
    titlebarLeft,
    titlebarToggleLeft,
    peekTitlebarLeft,
  } = m;
  // Hidden accounts' hits are in the list: the field says so.
  const chipShown = hiddenSearchChipShown(search, hiddenSearch);
  // The search menu, opened by its chevron or by the hidden chip.
  const [optionsOpen, setOptionsOpen] = React.useState(false);
  return (
    <>
      {/* Overlay title bar — same height as the Mac traffic-light strip
          (matches .dh-titlebar / NativeTitleDragStrip h-11). Search sits in
          this row like Outlook, not in a second toolbar underneath.
          `deep` makes empty chrome draggable; inputs stay interactive. */}
      <div
        data-tauri-drag-region="deep"
        className="mail-titlebar mail-chrome-strip relative flex h-11 shrink-0 items-center gap-3 border-b bg-[var(--mail-chrome)] transition-[padding-left] ease-out motion-reduce:transition-none"
        style={{
          borderColor: "var(--mail-chrome-border)",
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
        <div className="mail-titlebar-controls -ml-[4px] flex min-w-0 max-w-3xl flex-1 items-center gap-2">
          {/* First, where it is in reach whatever the list is doing: it
              stood at the head of the list, and went with the list when
              the list was put away. */}
          <button
            type="button"
            title={t("newEmail")}
            aria-label={t("newEmail")}
            className={cn(
              "flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold",
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
          <SyncControl m={m} />
          <label
            className={cn(
              "mail-titlebar-search",
              // h-7 (~28px) centers with traffic lights in the 44px strip.
              // Its own colours, not stone: on the dark theme the blanket
              // rewrite made this the same shade as the bar it sits in, so
              // the box a reader types into had no edges.
              "relative flex h-7 min-w-0 flex-1 items-center rounded-full border border-[var(--mail-field-border-soft)] bg-[var(--mail-field-bg)] shadow-sm",
              "focus-within:ring-2 focus-within:ring-[var(--mail-title-search-ring)]"
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
              className="pointer-events-none h-3.5 w-3.5 shrink-0 text-stone-400"
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
                "h-full min-w-0 flex-1 border-0 bg-transparent py-1 pl-2 text-[13px] text-[var(--mail-chrome-fg)] outline-none placeholder:text-[var(--mail-placeholder)] shadow-none [&::-webkit-search-cancel-button]:hidden",
                // Room for the clear button, and for the hidden chip beside it.
                chipShown ? "pr-36" : "pr-8"
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
          <TriageButton m={m} />
          {/* Right of the search: the list's switch, then the settings
              button at the end of the row (Ulrik, 2026-10-17). Stacks
              change the list more than anything in Settings, so the switch
              is out here. */}
          <StacksSwitch onDark={chromeDark} openKey={m.selected ? threadKey(m.selected) : null} />
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
