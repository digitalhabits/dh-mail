"use client";

import { sendFromAccounts } from "@/lib/mail/account-scope";
import * as React from "react";
import { TeamLayerHost } from "@/components/mail/team-layer";
import { Moon, Pause } from "lucide-react";
import { AutoReplyDialog } from "@/components/mail/AutoReplyDialog";
import { FOLDER_RAIL_MAX_WIDTH, FOLDER_RAIL_MIN_WIDTH } from "@/lib/mail/folder-rail";
import { CONTACTS_CHANGED_EVENT, ContactSourcesDialogHost } from "@/components/mail/ContactSourcesDialog";
import { MacContactsAskCard } from "@/components/mail/MacContactsAskCard";
import { UnpauseChallengeHost } from "@/components/mail/UnpauseChallenge";
import { useListPeek } from "@/components/mail/use-list-peek";
import { railBoxStyle } from "@/components/mail/list-box-style";
import { useMailPage, type MailPageProps } from "@/components/mail/use-mail-page";
import { MailPageSlices } from "@/components/mail/mail-page-slices";
import { useMailT } from "@/lib/mail/i18n";
import { MissedScheduledDialog } from "@/components/mail/MissedScheduledDialog";
import { ReadingPaneFrame, ListResizeHandle, ListPaneFrame, ListHideButton } from "@/components/mail/mail-pane-frames";
import { MailTitleBar } from "@/components/mail/mail-title-bar";
import { FloatingCards } from "@/components/mail/mail-floating-cards";
import { ReadingPaneContent } from "@/components/mail/mail-reading-pane";
import { ThreadListColumn } from "@/components/mail/mail-thread-list";
import { FoldersMenu, FolderRail, FoldersButton, FilterChips, FilterRow, AccountTabs, ListTabsOrFolder, LayoutMenu } from "@/components/mail/mail-list-chrome";
import { MailPauseMenu } from "@/components/mail/MailPauseMenu";
import { openMailAccountsMenu } from "@/lib/mail/open-mail-accounts-menu";
import { MailPhoneShell, type MailPhoneDetail } from "@/components/mail/MailPhoneShell";
import type { MailThreadSummary } from "@/lib/mail/types";
import { cn } from "@/lib/utils";
import { ConnectedMailboxRhythm } from "@/components/mail/AccountRhythmDialog";
import { mailBuiltinTabLabels, mailSearchPlaceholder } from "@/components/mail/mail-list-state";
export { openMailAccountsMenu };


export type MailPageSnapshot = {
  /** The local owner id. */
  ownerId: string;
  accounts: string[];
  /** Last-painted thread list (any folder/filter). */
  threads: MailThreadSummary[];
  listCacheKey: string;
  listCursor: string | null;
};



/**
 * Which row the way to the folders stands on: the start of the mailbox
 * tabs when they show, the end of the filter row when they do not. The
 * expanded list has it on its toolbar, so it is passed to neither row.
 */
function placeFolders(
  button: React.ReactNode,
  accountTabsShowing: boolean
): { tabRow: React.ReactNode; filterRow: React.ReactNode } {
  // Before the mailbox tabs, the expanded list too: its own row above
  // them holds nothing else, because New email is in the title bar.
  if (accountTabsShowing) return { tabRow: button, filterRow: null };
  return { tabRow: null, filterRow: button };
}


/**
 * Where the list column's controls start, for the title bar's row: the
 * list kept out, or the list out on hover (not while it slides), which
 * the row follows as well.
 */
function titlebarFollowsList(
  peek: { on: boolean },
  m: { listSliding: boolean; listControlsLeft: number; peekListControlsLeft: number }
): { listOut: boolean; controlsLeft: number } {
  const listOut = peek.on && !m.listSliding;
  return { listOut, controlsLeft: listOut ? m.peekListControlsLeft : m.listControlsLeft };
}
export function MailPage(props: MailPageProps) {
  const m = useMailPage(props);
  const {
    accountEmails,
    accountLabels,
    isOutlookAccount,
    pauseChip,
    pauseMailUntil,
    pauseNow,
    pauseState,
    pausedLabel,
    resumeMail,
    setFollowAllHours,
    setUnpauseWords,
    setMailQuietHours,
  } = m.accounts;
  const {
    activeCustomList,
    activeFolder,
    clearMultiSelection,
    filterIsOn,
    multiSelectedCount,
    railSystemView,
    searchInputRef,
    setActiveFolder,
    setSearch,
    tab,
    viewMode,
  } = m.list;
  const {
    archive,
    markThreadInPeople,
  } = m.actions;
  const {
    autoReplyAccount,
    autoReplyOpen,
    closeAutoReply,
    backFromAutoReply,
    closeCompose,
    composeSeed,
    composing,
    macAskTrigger,
    phoneDockedDraft,
    setPhoneDockedDraft,
    startCompose,
    storeAutoReply,
  } = m.compose;
  const {
    colorMode,
    hideList,
    listMounted,
    listSlideOverlay,
    listSliding,
    listVertical,
    mailSurfaceRef,
    paneRowRef,
    phone,
    railHidden,
    railInset,
    railOnRight,
    railResizing,
    railShowing,
    railSlideDuration,
    railSlideTransform,
    railWidth,
    shownRailWidth,
    startRailResize,
  } = m.layout;
  const {
    selected,
    selectedPerson,
    setSelected,
    setSelectedPersonKey,
  } = m.reader;
  const t = useMailT();

  const foldersMenu = (iconOnly: boolean) => (
    <FoldersMenu iconOnly={iconOnly} />
  );
  const folderRail = <FolderRail />;
  /**
   * The way to the folders.
   *
   * On the expanded toolbar it stands before New email, because it says
   * which mail this is. Unexpanded it stands at the start of the mailbox
   * row, or at the end of the filter row when there is no mailbox row.
   *
   * It stays while the rail is open, lit the way the funnel is lit while
   * the filters are showing. Pressing it again puts the rail away: it is
   * the only way out, and a control that vanished once it had worked
   * would leave a gap in the row and the rail with no way to close it.
   */
  const foldersButton = <FoldersButton />;
  /** The filter chips: the built-in lists, the reader's own, and New list. */
  const filterChips = <FilterChips />;
  /** The mailbox row: All, then one tab per mailbox. */
  // Hiding mailboxes for a while (use-mailbox-hide, called in useMailPage).
  const mailboxHide = m.accounts.hide;
  const accountTabs = <AccountTabs />;
  /*
    The mailbox row shows when more than one mailbox is connected, the
    hidden ones counted. If it goes by the shown ones alone, hiding all but
    one takes the row away, and with it the tab that shows the others again.
  */
  const connectedMailboxes = new Set(
    [...m.accounts.accountEmails, ...mailboxHide.hidden].map((email) => email.toLowerCase())
  );
  const accountTabsShowing = connectedMailboxes.size > 1 && !m.list.activeFolder;
  const folders = placeFolders(foldersButton, accountTabsShowing);
  const filterRow = <FilterRow filterChips={filterChips} foldersButton={folders.filterRow} />;
  // The list put away comes out over the reader from its edge, side by side only.
  const listPeek = useListPeek(m.layout.hideList && !m.layout.listVertical && !m.layout.listExpanded);
  // The folders come out with it when they are shown.
  const railPeeking = listPeek.on && !m.layout.listSliding && m.layout.railShowing;
  const { listOut, controlsLeft } = titlebarFollowsList(listPeek, m.layout);
  const listTabsOrFolder = (
    <ListTabsOrFolder accountTabs={accountTabs} filterRow={filterRow} foldersButton={folders.tabRow} accountTabsShowing={accountTabsShowing} />
  );
  /** Display & accounts, with Settings, shortcuts and contact sources in it. */
  const layoutMenu = <LayoutMenu />;
  /** The rows, with the banners over them and the load-more under them. */
  const threadListColumn = <ThreadListColumn listTabsOrFolder={listTabsOrFolder} hide={mailboxHide} />;
  /** What the reading pane holds: a composer, a thread, a person, or the rest picture. */
  // From offers every mailbox: hiding one takes its mail away, not its address.
  const sendFrom = sendFromAccounts(m.accounts.accountEmails, mailboxHide.hidden);
  const readingPaneContent = <ReadingPaneContent hide={mailboxHide} sendFrom={sendFrom} />;
  /* The team layer's host, for whichever pane asked. Here and not in the
     pane: the pane is made again for every thread. The public app's host
     draws nothing. */
  const teamLayerHostNode = (
    <TeamLayerHost
      onRecordsChanged={markThreadInPeople}
      onArchive={(origin) => void archive(origin)}
    />
  );
  const autoReplyDialog = (
      <AutoReplyDialog
        open={autoReplyOpen}
        initialAccount={autoReplyAccount}
        onClose={closeAutoReply}
        onBack={backFromAutoReply}
        onSaved={storeAutoReply}
      />
  );
  const contactDialogs = (
    <>
      <ContactSourcesDialogHost />
      {/* The words to type before ending a pause early. */}
      <UnpauseChallengeHost />
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
      <MailPageSlices slices={m}>
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
          exceptHidden: m.list.hiddenSearch.leftOut,
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
            onUnpauseWordsChange={setUnpauseWords}
            trigger={
              <button
                type="button"
                title={pauseChip.paused ? pausedLabel : t("pauseInboxTitle")}
                aria-label={pauseChip.paused ? pausedLabel : t("pauseInbox")}
                className={cn(
                  "mail-phone-live flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                  pauseChip.paused ? "text-indigo-600" : "text-teal-700"
                )}
              >
                {pauseChip.paused ? (
                  <Moon className="h-4 w-4" aria-hidden />
                ) : (
                  <Pause className="h-4 w-4" aria-hidden />
                )}
              </button>
            }
          />
        }
        list={threadListColumn}
        folderRail={folderRail}
        folderKey={`${activeFolder?.account ?? ""}|${activeFolder?.name ?? ""}|${railSystemView}`}
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
        {teamLayerHostNode}
        {contactDialogs}
        <ConnectedMailboxRhythm />
      </MailPhoneShell>
      </MailPageSlices>
    );
  }
  return (
    <MailPageSlices slices={m}>
    <div
      ref={mailSurfaceRef}
      // The window's height in the app's own pixels — see use-ui-scale.
      // `h-dvh` is not scaled by zoom, so at any size but 100% it is
      // taller than the window it sits in.
      className="mail-shell flex h-[var(--mail-viewport-h,100dvh)] min-h-0 flex-1 flex-col overflow-hidden bg-[var(--mail-chrome)]"
      data-theme={colorMode}
      style={
        {
          "--mail-list-controls-left": `${controlsLeft}px`,
          // How long anything following that column takes to catch up
          // with it — see railSlideDuration in use-mail-pane-geometry.
          "--mail-rail-slide": railSlideDuration,
        } as React.CSSProperties
      }
    >
      <MailTitleBar layoutMenu={layoutMenu} listOut={listOut} listToggle={<ListHideButton peek={listPeek} />} />
      {/* Scheduled mail that missed its hour: asked about once. */}
      <MissedScheduledDialog />

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
      {listMounted || railPeeking ? (
        <div
          data-mail-peek={railPeeking ? "" : undefined}
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
            ...railBoxStyle({
              peeking: railPeeking,
              sliding: listSlideOverlay,
              onRight: railOnRight,
              showing: railShowing,
              width: shownRailWidth,
              inset: railInset,
              transform: railSlideTransform,
            }),
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

            One property moving, and not two. If the rail also moves left
            as the box narrows, the content leaves the screen at twice the
            rate that the gap closes. It is gone halfway through, with an
            empty gap still shutting after it, and hiding feels abrupt when
            showing does not.

            Held to the other edge when the rail is on the right, for the
            same reason: the cabinet is on that side, so the drawer has
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
            
            Not white, and not the reading surface. Neither is always the
            chrome. On the dark theme the reading surface is lighter than
            either neighbour and reads as a lit strip down the join. The
            list's own border-r is what separates the two. This is only the
            colour behind a 4px gap.
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
      <ListPaneFrame peek={listPeek} foldersButton={foldersButton} foldersMenu={foldersMenu} listTabsOrFolder={listTabsOrFolder} threadListColumn={threadListColumn} />

      <ListResizeHandle />

      <ReadingPaneFrame peek={listPeek} readingPaneContent={readingPaneContent} />
      </div>
      </div>

      {autoReplyDialog}
      {teamLayerHostNode}
      <FloatingCards sendFrom={sendFrom} />
      {contactDialogs}
      <ConnectedMailboxRhythm />
    </div>
    </MailPageSlices>
  );
}


