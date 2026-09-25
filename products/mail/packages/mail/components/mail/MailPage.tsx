"use client";

import * as React from "react";
// One tempo for every pane sweep — see pane-slide. The local names say
// which movement each drives here.
import {
  PANE_SLIDE_MS as LIST_SLIDE_MS,
  PANE_SLIDE_EASE as LIST_SLIDE_EASE,
} from "@/lib/mail/pane-slide";
import { CrmProposalHost } from "@/components/mail/CrmProposalHost";
import { Moon, Radio } from "lucide-react";
import { AutoReplyDialog } from "@/components/mail/AutoReplyDialog";
import { FOLDER_RAIL_MAX_WIDTH, FOLDER_RAIL_MIN_WIDTH } from "@/lib/mail/folder-rail";
import { CONTACTS_CHANGED_EVENT, ContactSourcesDialogHost } from "@/components/mail/ContactSourcesDialog";
import { MacContactsAskCard } from "@/components/mail/MacContactsAskCard";
import { useMailPage, type MailPageProps } from "@/components/mail/use-mail-page";
import { ReadingPaneFrame, ListResizeHandle, ListPaneFrame } from "@/components/mail/mail-pane-frames";
import { MailTitleBar } from "@/components/mail/mail-title-bar";
import { FloatingCards } from "@/components/mail/mail-floating-cards";
import { ReadingPaneContent } from "@/components/mail/mail-reading-pane";
import { ThreadListColumn } from "@/components/mail/mail-thread-list";
import { FoldersMenu, FolderRail, FoldersButton, FilterButton, FilterChips, FilterRow, AccountTabs, ListTabsOrFolder, LayoutMenu } from "@/components/mail/mail-list-chrome";
import { MailPauseMenu } from "@/components/mail/MailPauseMenu";
import { openMailAccountsMenu } from "@/lib/mail/open-mail-accounts-menu";
import { MailPhoneShell, type MailPhoneDetail } from "@/components/mail/MailPhoneShell";
import type { MailThreadSummary } from "@/lib/mail/types";
import { cn } from "@/lib/utils";
import { mailBuiltinTabLabels, mailSearchPlaceholder } from "@/components/mail/mail-list-state";
export { openMailAccountsMenu };


export type MailPageSnapshot = {
  /** Clerk user id (planner) or local owner id (Mac app). */
  ownerId: string;
  accounts: string[];
  /** Last-painted thread list (any folder/filter). */
  threads: MailThreadSummary[];
  listCacheKey: string;
  listCursor: string | null;
};



export function MailPage(props: MailPageProps) {
  const m = useMailPage(props);
  const {
    accountEmails,
    accountLabels,
    accountTabsShowing,
    activeCustomList,
    activeFolder,
    archive,
    autoReplyAccount,
    autoReplyOpen,
    clearMultiSelection,
    closeAutoReply,
    closeCompose,
    colorMode,
    composeSeed,
    composing,
    filterIsOn,
    hideList,
    isOutlookAccount,
    listControlsLeft,
    listMounted,
    listSlideOverlay,
    listSliding,
    listVertical,
    macAskTrigger,
    mailSurfaceRef,
    markThreadInCrm,
    multiSelectedCount,
    paneRowRef,
    pauseChip,
    pauseMailUntil,
    pauseNow,
    pauseState,
    pausedLabel,
    phone,
    phoneDockedDraft,
    railHidden,
    railInset,
    railOnRight,
    railResizing,
    railShowing,
    railSlideDuration,
    railSlideTransform,
    railSystemView,
    railWidth,
    resumeMail,
    searchInputRef,
    selected,
    selectedPerson,
    setActiveFolder,
    setFollowAllHours,
    setMailQuietHours,
    setPhoneDockedDraft,
    setSearch,
    setSelected,
    setSelectedPersonKey,
    setViewMode,
    shownRailWidth,
    startCompose,
    startRailResize,
    storeAutoReply,
    t,
    tab,
    viewMode,
  } = m;

  const foldersMenu = (iconOnly: boolean) => (
    <FoldersMenu m={m} iconOnly={iconOnly} />
  );
  const folderRail = <FolderRail m={m} />;
  /**
   * The way to the folders.
   *
   * On the expanded toolbar it stands before New email, because it says
   * which mail this is. Unexpanded it stays on the mailbox row, or on
   * the filter row when there is no mailbox row.
   *
   * It stays while the rail is open, lit the way the funnel is lit while
   * the filters are showing. Pressing it again puts the rail away: it is
   * the only way out, and a control that vanished once it had worked
   * would leave a gap in the row and the rail with no way to close it.
   */
  const foldersButton = <FoldersButton m={m} />;
  const filterButton = <FilterButton m={m} />;
  /** The filter chips: the built-in lists, the reader's own, and New list. */
  const filterChips = <FilterChips m={m} />;
  const filterRow = <FilterRow m={m} filterButton={filterButton} filterChips={filterChips} foldersButton={foldersButton} />;
  /** The mailbox row: All, then one tab per mailbox. */
  const accountTabs = <AccountTabs m={m} />;
  const listTabsOrFolder = <ListTabsOrFolder m={m} accountTabs={accountTabs} filterRow={filterRow} foldersButton={foldersButton} />;
  /** Display & accounts, with Settings, shortcuts and contact sources in it. */
  const layoutMenu = <LayoutMenu m={m} />;
  /** The rows, with the banners over them and the load-more under them. */
  const threadListColumn = <ThreadListColumn m={m} listTabsOrFolder={listTabsOrFolder} />;
  /** What the reading pane holds: a composer, a thread, a person, or the rest picture. */
  const readingPaneContent = <ReadingPaneContent m={m} />;
  /* Update CRM, for whichever pane asked. Here and not in the pane: the pane
     is made again for every thread, and the dialog stays until the reader
     presses Skip or Apply. */
  const crmProposalHost = (
    <CrmProposalHost
      onCrmChanged={markThreadInCrm}
      onArchive={(origin) => void archive(origin)}
    />
  );
  const autoReplyDialog = (
      <AutoReplyDialog
        open={autoReplyOpen}
        initialAccount={autoReplyAccount}
        onClose={closeAutoReply}
        onSaved={storeAutoReply}
      />
  );
  const contactDialogs = (
    <>
      <ContactSourcesDialogHost />
      <MacContactsAskCard
        trigger={macAskTrigger}
        onGranted={() =>
          window.dispatchEvent(new CustomEvent(CONTACTS_CHANGED_EVENT))
        }
      />
    </>
  );
  if (phone) {
    // Which list this is, for the top row with one mailbox and for the
    // way back over an open thread.
    const phoneHeading =
      activeFolder?.name ??
      activeCustomList?.name ??
      (tab === "all"
        ? t("phoneInbox")
        : (mailBuiltinTabLabels(t)[tab] ?? t("phoneInbox")));
    const phoneDetail: MailPhoneDetail | null = composing
      ? { kind: "compose", node: readingPaneContent }
      : multiSelectedCount
        ? { kind: "selection", node: readingPaneContent }
        : selected
          ? { kind: "thread", node: readingPaneContent }
          : viewMode === "people" && selectedPerson
            ? { kind: "person", node: readingPaneContent }
            : null;
    return (
      <MailPhoneShell
        surfaceRef={mailSurfaceRef}
        colorMode={colorMode}
        heading={phoneHeading}
        accountTabs={accountTabsShowing ? accountTabs : null}
        filterChips={filterChips}
        filterOn={filterIsOn}
        folder={activeFolder ? { name: activeFolder.name } : null}
        onLeaveFolder={() => setActiveFolder(null)}
        searchInputRef={searchInputRef}
        searchPlaceholder={mailSearchPlaceholder({
          folderName: activeFolder?.name ?? null,
          customListName: activeCustomList?.name ?? null,
          tab,
          t,
        })}
        onSearchChange={setSearch}
        liveMenu={
          <MailPauseMenu
            state={pauseState}
            now={pauseNow}
            accounts={accountEmails}
            labels={accountLabels}
            isOutlookAccount={isOutlookAccount}
            onPause={pauseMailUntil}
            onResume={resumeMail}
            onQuietHoursChange={setMailQuietHours}
            onFollowAllHours={setFollowAllHours}
            trigger={
              <button
                type="button"
                title={pauseChip.paused ? pausedLabel : t("mailAwakeTitle")}
                aria-label={pauseChip.paused ? pausedLabel : t("mailAwake")}
                className={cn(
                  "mail-phone-live flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                  pauseChip.paused ? "text-indigo-600" : "text-teal-700"
                )}
              >
                {pauseChip.paused ? (
                  <Moon className="h-4 w-4" aria-hidden />
                ) : (
                  <Radio className="h-4 w-4" aria-hidden />
                )}
              </button>
            }
          />
        }
        list={threadListColumn}
        folderRail={folderRail}
        folderKey={`${activeFolder?.account ?? ""}|${activeFolder?.name ?? ""}|${railSystemView}`}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        settingsMenu={layoutMenu}
        onCompose={() => startCompose()}
        detail={phoneDetail}
        onBack={() => {
          // Down from the composer keeps the words: the draft is written
          // as the composer leaves, and the bar over the footer brings it
          // back. Back from anything else is one step towards the list.
          if (composing) {
            setPhoneDockedDraft({ seed: composeSeed });
            closeCompose();
            return;
          }
          if (multiSelectedCount) {
            clearMultiSelection();
            return;
          }
          if (selected) {
            setSelected(null);
            return;
          }
          setSelectedPersonKey(null);
        }}
        dockedDraft={
          phoneDockedDraft
            ? {
                label: `${t("draft")} · ${
                  phoneDockedDraft.seed?.subject || t("newEmail")
                }`,
                onResume: () => startCompose(phoneDockedDraft.seed ?? undefined),
                onHide: () => setPhoneDockedDraft(null),
              }
            : null
        }
      >
        {autoReplyDialog}
        {crmProposalHost}
        {contactDialogs}
      </MailPhoneShell>
    );
  }
  return (
    <div
      ref={mailSurfaceRef}
      // The window's height in the app's own pixels — see use-ui-scale.
      // `h-dvh` is not scaled by zoom, so at any size but 100% it was
      // taller than the window it sat in.
      className="mail-shell flex h-[var(--mail-viewport-h,100dvh)] min-h-0 flex-1 flex-col overflow-hidden bg-[var(--mail-chrome)]"
      data-theme={colorMode}
      style={
        {
          "--mail-list-controls-left": `${listControlsLeft}px`,
          // How long anything following that column takes to catch up
          // with it — see railSlideDuration in use-mail-pane-geometry.
          "--mail-rail-slide": railSlideDuration,
        } as React.CSSProperties
      }
    >
      <MailTitleBar m={m} layoutMenu={layoutMenu} />

      {/* The rail stands outside the pane row rather than inside it: the
          pane may be laid out top-to-bottom (list over reader), and the
          folders run down the side of both however that is set. */}
      <div
        ref={paneRowRef}
        // `relative`: the sliding columns stand absolute against this row,
        // and its overflow-hidden is what cuts them off at the window's
        // edge as they travel.
        className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
      >
      {/* The folders travel with the list: they are its heading, so they
          leave with it rather than blinking out from beside a list that is
          still going. Mounted for as long as the list is, and closing to
          the same width of nothing on the way. */}
      {listMounted ? (
        <div
          style={{
            order: railOnRight ? 3 : 1,
            /*
              Two lives. At rest, a box in the flow whose width the rail's
              own 200ms toggle still animates — that toggle moves one thin
              strip and one title bar, and is cheap enough to stay as it
              was. While the list slides, absolute over the pane row at
              full width, travelling by transform with the list — see the
              note over `listSlideOverlay`.
            */
            ...(listSlideOverlay
              ? {
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  ...(railOnRight ? { right: 0 } : { left: 0 }),
                  width: railInset,
                  zIndex: 10,
                  transform: railSlideTransform,
                  willChange: "transform",
                  transitionDuration: `${LIST_SLIDE_MS}ms`,
                  transitionTimingFunction: LIST_SLIDE_EASE,
                }
              : { width: railShowing ? shownRailWidth : 0 }),
          }}
          className={cn(
            "relative shrink-0 overflow-hidden",
            // Closed and finished closing: out of the tab order, rather
            // than a strip of nothing that can still be tabbed into.
            railHidden && "invisible",
            // Not while it is being dragged. The rail's own toggle and the
            // drag animate the same property, so a rail being resized
            // would trail the pointer by the length of the opening.
            //
            // Transform while the list is moving; its own width toggle
            // when the reader is only asking for the folders. Both stay
            // classes so `motion-reduce` turns the whole thing off.
            !railResizing &&
              (listSlideOverlay
                ? "transition-transform motion-reduce:transition-none"
                : "transition-[width] duration-200 ease-out motion-reduce:transition-none")
          )}
        >
          {/*
            Its own width, held against the right edge of the box whose
            width is changing.

            Its own width, because a rail laid out again at every width on
            the way would re-wrap every folder name sixty times per slide.
            Held to the right, because that is what makes it a slide: the
            box's right edge is where the thread list starts, so the rail
            travels left with it and is cut off against the pane's own left
            edge, the way a drawer goes back into a cabinet.

            One property moving, and not two. This used to also translate
            the rail left as the box narrowed, so the content left the
            screen at twice the rate the gap closed — gone halfway through,
            with an empty gap still shutting after it. That is what made
            hiding feel abrupt when showing did not.

            Held to the other edge when the rail is on the right, for the
            same reason: the cabinet is on that side now, so the drawer has
            to go back into it that way.
          */}
          <div
            className={cn(
              "absolute inset-y-0",
              railOnRight ? "left-0" : "right-0"
            )}
            style={{ width: shownRailWidth }}
          >
            {folderRail}
          </div>
        </div>
      ) : null}
      {/* Between the rail and the pane, like the one between the list and
          the reader. Only while the rail is all the way out and standing
          in the flow: half way through a slide there is no edge to take
          hold of, and a grab strip left behind by a rail that is out of
          the flow would stand over nothing. */}
      {railShowing && !hideList && listMounted && !listSliding ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t("resizeFolders")}
          aria-valuenow={Math.round(railWidth)}
          aria-valuemin={FOLDER_RAIL_MIN_WIDTH}
          aria-valuemax={FOLDER_RAIL_MAX_WIDTH}
          title={t("dragToResizeFolders")}
          // On the right, the rail grows as the pointer goes left.
          onPointerDown={(e) => startRailResize(e, { invertDrag: railOnRight })}
          /*
            It takes hold of the seam without taking any of it.

            Four pixels of column between the rail and the list is four
            pixels the list cannot paint, and the bar down the side of the
            open thread stopped short of the rail because of it. The strip
            lies over the list's first four pixels instead — negative margin
            to give the width back, `relative` so it stays above the list and
            keeps the drag, and transparent so what it lies over shows
            through.
          */
          className={cn(
            "relative z-10 w-1 shrink-0 cursor-col-resize touch-none bg-transparent transition-colors hover:bg-[var(--mail-chrome-border)] active:bg-[var(--mail-chrome-border)]",
            railOnRight ? "-ml-1" : "-mr-1"
          )}
          style={{ order: 2 }}
        />
      ) : null}
      <div
        className={cn(
          /*
            What shows through the transparent resize gutter, so it has to
            be what is on both sides of it — the chrome, which is what the
            list is painted in and what the reader's own frame is.
            
            It has been wrong twice in the same way: white while the reader
            was white, then the reading surface once that stepped away from
            the chrome, which on the dark theme is lighter than either
            neighbour and read as a lit strip down the join. The list's own
            border-r is what separates the two; this is only the colour
            behind a 4px gap.
          */
          // `relative`: the sliding list anchors to this box — the same
          // geometry as the pane row while a slide runs, since the rail is
          // out of the flow then, and the right frame for the expand sweep,
          // which covers the pane but never the rail.
          "relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-[var(--mail-thread-chrome)]",
          listVertical ? "flex-col" : "flex-row"
        )}
        // Before the rail when the rail is on the right; after it otherwise.
        style={{ order: railOnRight ? 1 : 3 }}
      >
      <ListPaneFrame m={m} filterButton={filterButton} foldersButton={foldersButton} foldersMenu={foldersMenu} listTabsOrFolder={listTabsOrFolder} threadListColumn={threadListColumn} />

      <ListResizeHandle m={m} />

      <ReadingPaneFrame m={m} readingPaneContent={readingPaneContent} />
      </div>
      </div>

      {autoReplyDialog}
      {crmProposalHost}
      <FloatingCards m={m} />
      {contactDialogs}
    </div>
  );
}


