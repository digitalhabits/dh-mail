"use client";

/**
 * The mail interface on a phone.
 *
 * One list, with the chrome sunk to the edges: a top row with the filter
 * toggle, the mailbox tabs and the search glass, and a footer with the
 * folders, the thread/person toggle and Settings, with New email as a
 * round button at the thumb. The reader, a person's mail and the composer
 * open over the list as a page of their own, with the way back at the top.
 * The folders are an edge drawer from the left, the way Outlook and Gmail
 * keep theirs.
 *
 * Nothing here knows what a message is. MailPage builds every piece —
 * the tabs, the chips, the rows, the reader — and hands them in; this is the
 * frame they stand in when the window is a phone. See `usePhoneLayout` in
 * `lib/mail/host-form.ts` for when that is.
 */

import * as React from "react";
import {
  ChevronDown,
  ChevronLeft,
  Folder,
  Funnel,
  Search,
  SquarePen,
  X,
} from "lucide-react";

import {
  MailViewModeTabs,
  type MailViewMode,
} from "@/components/mail/MailListControls";
import {
  PHONE_SEARCH_SCOPES,
  phoneSearchQuery,
  type PhoneSearchScope,
} from "@/lib/mail/host-form";
import { useMailT, type MailStringKey } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";

/** What stands over the list, and how the way back is drawn. */
export type MailPhoneDetail = {
  kind: "thread" | "person" | "compose" | "selection";
  node: React.ReactNode;
};

const SCOPE_LABEL: Record<PhoneSearchScope, MailStringKey> = {
  everywhere: "phoneScopeEverywhere",
  from: "phoneScopeFrom",
  subject: "phoneScopeSubject",
  file: "phoneScopeHasFile",
};

/** How long a finger rests before a row's menu opens. */
const LONG_PRESS_MS = 480;
/** A finger that travels further than this is scrolling, not pressing. */
const LONG_PRESS_SLOP_PX = 10;
/** From how close to the left edge a swipe pulls the folders out. */
const EDGE_SWIPE_PX = 24;
/** How far that swipe has to travel. */
const EDGE_SWIPE_TRAVEL_PX = 48;

/**
 * A long press opens the same menu a right-click does.
 *
 * Android's webview raises `contextmenu` for a long press on its own; iOS
 * does not raise it for a finger at all. So the press is timed here, and
 * the row is sent the event it already listens for. The tap that ends the
 * press would open the row, so the next click is swallowed once.
 */
function useLongPressMenu(ref: React.RefObject<HTMLElement | null>): void {
  React.useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let timer: number | null = null;
    let start: { x: number; y: number; target: Element } | null = null;
    let fired = false;

    const clear = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      start = null;
    };
    const swallowClick = (event: Event) => {
      event.stopPropagation();
      event.preventDefault();
      root.removeEventListener("click", swallowClick, true);
    };
    const onDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || !event.isPrimary) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || !target.closest("[data-thread-key], [data-person-key]")) return;
      clear();
      fired = false;
      start = { x: event.clientX, y: event.clientY, target };
      timer = window.setTimeout(() => {
        if (!start) return;
        fired = true;
        const { x, y, target: pressed } = start;
        clear();
        pressed.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
          })
        );
        root.addEventListener("click", swallowClick, true);
        // The finger lifting is not a click any more; but if it never
        // lifts on this element, the guard must not wait forever.
        window.setTimeout(
          () => root.removeEventListener("click", swallowClick, true),
          1200
        );
      }, LONG_PRESS_MS);
    };
    const onMove = (event: PointerEvent) => {
      if (!start) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (dx * dx + dy * dy > LONG_PRESS_SLOP_PX * LONG_PRESS_SLOP_PX) clear();
    };
    const onEnd = () => {
      if (!fired) clear();
    };
    root.addEventListener("pointerdown", onDown);
    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerup", onEnd);
    root.addEventListener("pointercancel", onEnd);
    return () => {
      clear();
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerup", onEnd);
      root.removeEventListener("pointercancel", onEnd);
      root.removeEventListener("click", swallowClick, true);
    };
  }, [ref]);
}

export function MailPhoneShell({
  surfaceRef,
  colorMode,
  style,
  heading,
  accountTabs,
  filterChips,
  filterOn,
  folder,
  onLeaveFolder,
  searchInputRef,
  searchPlaceholder,
  onSearchChange,
  liveMenu,
  list,
  folderRail,
  folderKey,
  viewMode,
  onViewModeChange,
  settingsMenu,
  onCompose,
  detail,
  onBack,
  dockedDraft,
  children,
}: {
  surfaceRef: React.Ref<HTMLDivElement>;
  colorMode: "light" | "dark";
  style?: React.CSSProperties;
  /** Which list this is — Inbox, or the folder or list open. */
  heading: string;
  /** The mailbox tabs, or null with one mailbox. */
  accountTabs: React.ReactNode;
  /** The filter chips: All, In CRM, Other, Snoozed, and the reader's lists. */
  filterChips: React.ReactNode;
  /** A filter is narrowing the list, so the chips must stay on screen. */
  filterOn: boolean;
  folder: { name: string } | null;
  onLeaveFolder: () => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  searchPlaceholder: string;
  onSearchChange: (query: string) => void;
  /** The pause menu, with the Live dot as its trigger. */
  liveMenu: React.ReactNode;
  list: React.ReactNode;
  folderRail: React.ReactNode;
  /** Changes when a folder is picked, which closes the drawer. */
  folderKey: string;
  viewMode: MailViewMode;
  onViewModeChange: (mode: MailViewMode) => void;
  settingsMenu: React.ReactNode;
  onCompose: () => void;
  detail: MailPhoneDetail | null;
  onBack: () => void;
  /** A composer put away with its words kept: a bar that brings it back. */
  dockedDraft: {
    label: string;
    onResume: () => void;
    onHide: () => void;
  } | null;
  /** Dialogs and the like that MailPage mounts beside the layout. */
  children?: React.ReactNode;
}) {
  const t = useMailT();
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [searchText, setSearchText] = React.useState("");
  const [scope, setScope] = React.useState<PhoneSearchScope>("everywhere");
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  useLongPressMenu(listRef);

  // Picking a folder closes the drawer: the list behind it is the answer.
  const firstFolderKey = React.useRef(folderKey);
  React.useEffect(() => {
    if (folderKey !== firstFolderKey.current) setDrawerOpen(false);
    firstFolderKey.current = folderKey;
  }, [folderKey]);

  // The words and the chip make one query; the list hears the query.
  const searchFor = React.useCallback(
    (nextScope: PhoneSearchScope, text: string) => {
      setScope(nextScope);
      setSearchText(text);
      onSearchChange(phoneSearchQuery(nextScope, text));
    },
    [onSearchChange]
  );
  const openSearch = () => {
    setSearchOpen(true);
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  };
  const closeSearch = () => {
    setSearchOpen(false);
    searchFor("everywhere", "");
  };

  /*
    A finger from the left edge pulls the folders out, and a finger across
    the open drawer pushes them back. Touch events rather than pointer
    events: the list scrolls under a finger, and a horizontal pull from the
    very edge is the one gesture the list does not own.
  */
  const edgeSwipe = React.useRef<{ x: number; y: number; fromEdge: boolean } | null>(null);
  const onTouchStart = (event: React.TouchEvent) => {
    const touch = event.touches[0];
    if (!touch) return;
    edgeSwipe.current = {
      x: touch.clientX,
      y: touch.clientY,
      fromEdge: touch.clientX <= EDGE_SWIPE_PX,
    };
  };
  const onTouchMove = (event: React.TouchEvent) => {
    const start = edgeSwipe.current;
    const touch = event.touches[0];
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dy) > Math.abs(dx)) return;
    if (!drawerOpen && start.fromEdge && dx > EDGE_SWIPE_TRAVEL_PX && !detail) {
      setDrawerOpen(true);
      edgeSwipe.current = null;
    } else if (drawerOpen && dx < -EDGE_SWIPE_TRAVEL_PX) {
      setDrawerOpen(false);
      edgeSwipe.current = null;
    }
  };
  const onTouchEnd = () => {
    edgeSwipe.current = null;
  };

  const chipsShowing = !searchOpen && (filtersOpen || filterOn);

  return (
    <div
      ref={surfaceRef}
      className="mail-shell mail-phone relative flex h-[var(--mail-viewport-h,100dvh)] min-h-0 flex-1 flex-col overflow-hidden bg-[var(--mail-chrome)]"
      data-theme={colorMode}
      data-phone-detail={detail?.kind}
      style={style}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      {/* ------------------------------------------------ top row */}
      <div className="mail-phone-top mail-chrome-strip shrink-0 border-b border-[var(--mail-chrome-border)] bg-[var(--mail-chrome)]">
        {searchOpen ? (
          <div className="flex h-12 items-center gap-2 px-3">
            <label className="mail-phone-search flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full border border-[var(--mail-field-border-soft)] bg-[var(--mail-field-bg)] px-3 focus-within:ring-2 focus-within:ring-teal-600/40">
              <Search className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />
              <input
                ref={searchInputRef}
                type="search"
                value={searchText}
                onChange={(event) => searchFor(scope, event.target.value)}
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint="search"
                placeholder={searchPlaceholder}
                aria-label={t("phoneOpenSearch")}
                className="h-full min-w-0 flex-1 border-0 bg-transparent text-[16px] text-[var(--mail-chrome-fg)] outline-none placeholder:text-[var(--mail-placeholder)] [&::-webkit-search-cancel-button]:hidden"
              />
              {searchText ? (
                <button
                  type="button"
                  aria-label={t("clearSearch")}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-stone-400"
                  onClick={() => searchFor(scope, "")}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </label>
            <button
              type="button"
              className="shrink-0 px-1 text-[15px] font-medium text-teal-700"
              onClick={closeSearch}
            >
              {t("cancel")}
            </button>
          </div>
        ) : (
          <div className="flex h-12 items-center gap-2 px-2">
            <button
              type="button"
              title={filtersOpen ? t("phoneHideFilters") : t("phoneShowFilters")}
              aria-label={filtersOpen ? t("phoneHideFilters") : t("phoneShowFilters")}
              aria-expanded={chipsShowing}
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                chipsShowing ? "text-teal-700" : "text-[var(--mail-chrome-muted)]"
              )}
              onClick={() => setFiltersOpen((open) => !open)}
            >
              <Funnel className="h-4 w-4" />
            </button>
            <div className="mail-phone-tabs min-w-0 flex-1">
              {accountTabs ?? (
                <p className="truncate px-1 text-[15px] font-semibold text-[var(--mail-chrome-fg)]">
                  {heading}
                </p>
              )}
            </div>
            {liveMenu}
            <button
              type="button"
              title={t("phoneOpenSearch")}
              aria-label={t("phoneOpenSearch")}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--mail-chrome-muted)]"
              onClick={openSearch}
            >
              <Search className="h-[18px] w-[18px]" />
            </button>
          </div>
        )}
        {searchOpen ? (
          <div className="mail-phone-scopes flex items-center gap-1.5 overflow-x-auto px-3 pb-2 [scrollbar-width:none]">
            {PHONE_SEARCH_SCOPES.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={scope === option}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1 text-[13px]",
                  scope === option
                    ? "border-teal-600/30 bg-teal-600/10 text-teal-800"
                    : "border-[var(--mail-chrome-chip-border)] text-[var(--mail-chrome-muted)]"
                )}
                onClick={() => searchFor(option, searchText)}
              >
                {t(SCOPE_LABEL[option])}
              </button>
            ))}
          </div>
        ) : folder ? (
          <div className="flex items-center gap-2 px-3 pb-2 text-sm">
            <span className="flex min-w-0 items-center gap-1.5 rounded-full bg-[var(--mail-chrome-pinned)] px-3 py-1 text-[13px] font-medium text-[var(--mail-chrome-pinned-fg)]">
              <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">{folder.name}</span>
              <button
                type="button"
                title={t("phoneLeaveFolder")}
                aria-label={t("phoneLeaveFolder")}
                className="-mr-1 flex h-5 w-5 items-center justify-center rounded-full"
                onClick={onLeaveFolder}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          </div>
        ) : chipsShowing ? (
          <div className="mail-phone-chips px-3 pb-1 text-sm">{filterChips}</div>
        ) : null}
      </div>

      {/* ------------------------------------------------ the list */}
      <div ref={listRef} className="mail-phone-list relative flex min-h-0 flex-1 flex-col">
        {list}
      </div>

      {/* ------------------------------------------------ docked draft */}
      {dockedDraft && !detail ? (
        <div className="mail-phone-docked flex shrink-0 items-center gap-2 border-t border-[var(--mail-chrome-border)] bg-[var(--mail-chrome)] px-3 py-1.5">
          <button
            type="button"
            title={t("phoneResumeDraft")}
            className="flex min-w-0 flex-1 items-center gap-2 text-left text-[13px] text-[var(--mail-chrome-fg)]"
            onClick={dockedDraft.onResume}
          >
            <SquarePen className="h-3.5 w-3.5 shrink-0 text-teal-700" aria-hidden />
            <span className="truncate">{dockedDraft.label}</span>
          </button>
          <button
            type="button"
            title={t("phoneHideDraft")}
            aria-label={t("phoneHideDraft")}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-stone-400"
            onClick={dockedDraft.onHide}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      {/* ------------------------------------------------ footer */}
      <div className="mail-phone-footer mail-chrome-strip relative z-10 flex shrink-0 items-center gap-2 border-t border-[var(--mail-chrome-border)] bg-[var(--mail-chrome)] px-3">
        <button
          type="button"
          title={t("phoneOpenFolders")}
          aria-label={t("phoneOpenFolders")}
          aria-expanded={drawerOpen}
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-full",
            drawerOpen ? "text-teal-700" : "text-[var(--mail-chrome-muted)]"
          )}
          onClick={() => setDrawerOpen(true)}
        >
          <Folder className="h-5 w-5" />
        </button>
        <MailViewModeTabs viewMode={viewMode} onChange={onViewModeChange} />
        <div className="mail-phone-settings flex items-center">{settingsMenu}</div>
        <button
          type="button"
          title={t("newEmail")}
          aria-label={t("newEmail")}
          className="mail-phone-fab absolute right-4 flex h-14 w-14 items-center justify-center bg-teal-700 text-white shadow-lg"
          onClick={onCompose}
        >
          <SquarePen className="h-6 w-6" />
        </button>
      </div>

      {/* ------------------------------------------------ folders */}
      {drawerOpen ? (
        <button
          type="button"
          aria-label={t("phoneCloseFolders")}
          className="mail-phone-scrim absolute inset-0 z-30 bg-black/35"
          onClick={() => setDrawerOpen(false)}
        />
      ) : null}
      <div
        className={cn(
          "mail-phone-drawer absolute inset-y-0 left-0 z-40 flex w-[84%] max-w-[360px] flex-col bg-[var(--mail-chrome)] shadow-2xl transition-transform duration-200 ease-out motion-reduce:transition-none",
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        )}
        aria-hidden={!drawerOpen}
        // Inert while closed, so nothing in it can be tabbed into or read out.
        inert={drawerOpen ? undefined : true}
      >
        {folderRail}
      </div>

      {/* ------------------------------------------------ the page over the list */}
      {detail ? (
        <div className="mail-phone-detail absolute inset-0 z-20 flex flex-col bg-[var(--mail-thread-chrome)]">
          <div className="mail-phone-back mail-chrome-strip flex h-11 shrink-0 items-center border-b border-[var(--mail-thread-chrome-line)] bg-[var(--mail-thread-chrome)] px-2">
            <button
              type="button"
              className="flex h-9 items-center gap-0.5 rounded-full pl-1 pr-3 text-[15px] text-teal-700"
              onClick={onBack}
            >
              {detail.kind === "compose" ? (
                <>
                  <ChevronDown className="h-5 w-5" aria-hidden />
                  {t("phoneKeepDraft")}
                </>
              ) : (
                <>
                  <ChevronLeft className="h-5 w-5" aria-hidden />
                  {heading}
                </>
              )}
            </button>
          </div>
          <div className="relative flex min-h-0 flex-1 flex-col">{detail.node}</div>
        </div>
      ) : null}
      {children}
    </div>
  );
}
