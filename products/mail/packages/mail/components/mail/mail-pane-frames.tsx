"use client";

/*
 * Part of MailPage's markup, moved out of MailPage.tsx.
 *
 * Each component takes the page's model (`m`, from useMailPage) and reads
 * the names it needs from it. Markup it shares with the rest of the page
 * comes in as props. The JSX is MailPage's own, word for word.
 */

import * as React from "react";
import { isInteractiveDoubleClickTarget, MAX_CONTROLS_WIDTH, MAX_LIST_ARIA, MIN_CONTROLS_WIDTH, MIN_LIST_HEIGHT, NARROW_LIST_WIDTH } from "@/components/mail/use-mail-layout";
import { ArrowLeft, Moon, PanelLeftClose, PanelRightClose, Pin } from "lucide-react";
import { autoReplyActive } from "@/components/mail/AutoReplyDialog";
import { formatAccountChipLabel } from "@/lib/mail/account-labels";
import { currentMailLocale } from "@/lib/mail/i18n";
import { AutoReplyMark } from "@/components/mail/AutoReplyMark";
import { cn } from "@/lib/utils";
import { SyncIcon } from "@/components/mail/MailListControls";
import type { MailPageModel } from "@/components/mail/use-mail-page";
import { listBoxStyle, listInnerStyle } from "@/components/mail/list-box-style";
import { pinListInPlace, type ListPeek } from "@/components/mail/use-list-peek";

/** The reading pane's frame: it holds the pane through the expand sweep. */
export function ReadingPaneFrame({
  m,
  peek,
  readingPaneContent,
}: {
  m: MailPageModel;
  peek: ListPeek;
  readingPaneContent: React.ReactNode;
}) {
  const {
    listExpandSliding,
    listExpanded,
    listFirst,
    listSliding,
    listWidth,
    railInset,
  } = m;
  /*
    The list shown from the edge pushes the reader over rather than lying
    on it, so the message nearest the list stays in view beside it. The
    reader is made narrower, not moved: moved whole, anything wider than
    the room left, such as the resting picture, was cut off at the far
    edge.
  */
  const pushedBy = peek.on && !listSliding ? railInset + listWidth : 0;
  return (
    <>
      {/* ------------------------------------------------ reading pane */}
      {/* Held through the expand sweep: what the clip edge covers or
          uncovers has to be the pane itself, not its absence. */}
      {!listExpanded || listExpandSliding ? (
      <div
        // No overflow clip here — the action band must paint over the resize
        // gutter to the list border. Message scrolling is on ThreadPane.
        // `relative z-0` keeps that paint inside this pane so the handle
        // above it still takes the drag from the title bar down.
        //
        /*
          The chrome, which is what the mailbox list beside it is painted in.
        
          Only three states ever show this: the resting picture, the wait for
          a first inbox, and the note that no mailbox is connected. Anything
          that draws a message — the thread, the composer — paints the
          reading surface over the top of it. So what this colour is for is
          the app at rest, and at rest the two halves of the window should
          be the one colour, which is what light has always done.
        */
        className="relative z-0 flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--mail-thread-chrome)]"
        style={{
          order: listFirst ? 3 : 1,
          ...(pushedBy ? (listFirst ? { marginLeft: pushedBy } : { marginRight: pushedBy }) : {}),
        }}
      >
        {readingPaneContent}
      </div>
      ) : null}
    </>
  );
}

/** The drag handle that sizes the thread list. */
export function ListResizeHandle({
  m,

}: {
  m: MailPageModel;

}) {
  const {
    detailOpen,
    expandListFromNarrow,
    hideList,
    listExpandSliding,
    listExpanded,
    listHeight,
    listMounted,
    listNarrow,
    listSliding,
    listVertical,
    listWidth,
    startListHeightResize,
    startListResize,
    t,
  } = m;
  return (
    <>
      {/* Drag handle for resizing the thread list. Not while the list is
          sliding: it is out of the flow then, and a handle in the flow
          would stand a sliver of reader off its edge until it lands. */}
      {listMounted && !hideList && !listExpanded && !listSliding &&
      !listExpandSliding ? (
      <div
        role="separator"
        aria-orientation={listVertical ? "horizontal" : "vertical"}
        aria-valuenow={Math.round(listVertical ? listHeight : listWidth)}
        aria-valuemin={
          detailOpen
            ? 0
            : listVertical
              ? MIN_LIST_HEIGHT
              : NARROW_LIST_WIDTH
        }
        aria-valuemax={MAX_LIST_ARIA}
        title={
          listNarrow
            ? "Drag out or double-click to expand list"
            : listVertical
              ? detailOpen
                ? "Drag to resize — pull small to hide"
                : t("dragToResize")
              : detailOpen
                ? "Drag to resize — narrow for avatars, smaller to hide"
                : "Drag to resize — narrow for avatar rail"
        }
        onPointerDown={listVertical ? startListHeightResize : startListResize}
        onDoubleClick={(e) => {
          if (listVertical || !listNarrow) return;
          e.preventDefault();
          expandListFromNarrow();
        }}
        className={cn(
          // Transparent: parent chrome cream shows through, so the action
          // band meets the list without a white notch. List keeps border-r.
          //
          // Above the reader: ThreadPane pulls its action strip and subject
          // left over this gutter so cream meets the list. Those bands used
          // to sit on top and steal the drag below the title bar.
          "relative z-20 shrink-0 touch-none bg-transparent transition-colors hover:bg-[var(--mail-chrome-hover)] active:bg-white/20",
          listVertical
            ? "h-2 w-full cursor-row-resize"
            : "w-2 cursor-col-resize"
        )}
        style={{ order: 2 }}
      />
      ) : null}
    </>
  );
}

/** The thread list's frame: its size, its slide, and the controls over it. */
export function ListPaneFrame({
  m,
  peek,
  filterButton,
  foldersButton,
  foldersMenu,
  listTabsOrFolder,
  threadListColumn,
}: {
  m: MailPageModel;
  peek: ListPeek;
  filterButton: React.ReactNode;
  foldersButton: React.ReactNode;
  foldersMenu: (iconOnly: boolean) => React.ReactNode;
  listTabsOrFolder: React.ReactNode;
  threadListColumn: React.ReactNode;
}) {
  const {
    accountLabels,
    autoReplies,
    controlsWidth,
    expandClip,
    hideList,
    listBorderClass,
    listChromeOnToolbar,
    listExpandSliding,
    listExpanded,
    listFirst,
    listHeight,
    listMounted,
    listNarrow,
    listNearSnap,
    listOpen,
    listRowsOnPane,
    listSliding,
    listSlideOverlay,
    listSlideTransform,
    listSplit,
    listVertical,
    listWidth,
    openAutoReply,
    phone,
    railInset,
    shownListWidth,
    startControlsResize,
    startListResize,
    t,
    toggleListExpanded,
  } = m;
  const box = {
    listExpandSliding,
    listSlideOverlay,
    listExpanded,
    listOpen,
    listVertical,
    listFirst,
    expandClip,
    listSlideTransform,
    railInset,
    listHeight,
    shownListWidth,
  };
  /* Put away and at rest: the list comes out over the reader while the
     pointer is on it, at the width it was dragged to. */
  const peeking = peek.on && !listSliding;
  const peekBox = { ...box, listOpen: true, listSlideOverlay: false, listExpandSliding: false, shownListWidth: listWidth };
  const hideButton = <ListHideButton m={m} peek={peek} />;
  return (
    <>
      {/* The edge the list went into: the pointer on it brings it out.
          20px wide: at 8px the pointer had to be all but on the window's
          edge, and reaching for the list became aiming at a line. It lies
          over the reader's left margin, so keep it narrow. */}
      {hideList && !listSliding && !listVertical && !listExpanded && !peeking && !phone ? (
        <div
          aria-hidden
          data-mail-list-edge=""
          className={cn("absolute inset-y-0 z-30 w-5", listFirst ? "left-0" : "right-0")}
          onPointerEnter={peek.peek}
        />
      ) : null}
      {/* ------------------------------------------------ thread list */}
      {listMounted || peeking ? (
      /*
        The box the list stands in, and the thing that slides.

        At rest it holds the list's place in the flow at the width the
        reader dragged. While a slide runs it steps out of the flow —
        absolute against the pane row, at that same size and place — and
        travels by transform toward the edge the list lives against,
        where the pane row's own overflow cuts it off: a drawer going
        back into a cabinet. The reader behind it is laid out once, at
        its final width, under cover of the column — see the note over
        the three slide states.

        The inner element keeps the list at its own fixed size, pinned to
        the reader's edge, so the rows are never re-wrapped by anything
        the box does — that matters to the rail's 200ms toggle and to the
        squeeze a composer asks for, which still move the box's width.
      */
      <div
        data-mail-peek={peeking ? "" : undefined}
        // Whether the list has taken the pane (⌥⌘L), for tests and styles:
        // the button that showed it is gone.
        data-list-expanded={listExpanded ? "true" : "false"}
        className={cn(
          "relative overflow-hidden",
          peeking && "shadow-xl",
          listExpanded && listOpen ? "min-h-0 min-w-0 flex-1" : "shrink-0",
          listSlideOverlay &&
            "transition-transform motion-reduce:transition-none",
          listExpandSliding &&
            "transition-[clip-path] motion-reduce:transition-none"
        )}
        style={{
          order: listFirst ? 1 : 3,
          /*
            The expand sweep — see the note over `listGrown`. Absolute over
            the pane at full size, laid out once in its expanded shape, and
            a clip edge travels between the list's resting strip and the
            whole of the pane.
          */
          ...(peeking
            ? ({
                position: "absolute",
                top: 0,
                bottom: 0,
                width: listWidth,
                zIndex: 30,
                // Beside the folders, which come out with it.
                ...(listFirst ? { left: railInset } : { right: railInset }),
              } as React.CSSProperties)
            : listBoxStyle(box)),
        }}
      >
      <div
        className={cn(
          // Explicit border colour + side (listBorderClass) so the divider
          // between list and reader stays visible against cream chrome.
          "flex overflow-hidden border-[var(--mail-chrome-border)]",
          // Pane behind the rows when they are the reading surface —
          // stacked above/below, or expanded — so chrome cannot bleed
          // into the table.
          listRowsOnPane ? "bg-[var(--mail-pane)]" : "bg-[var(--mail-chrome)]",
          listBorderClass,
          // Top/bottom: controls | thread list side-by-side.
          listSplit ? "min-h-0 w-full flex-row" : "min-w-0 flex-col"
        )}
        style={{
          // Expanded shape during the sweep as well: the clip above is what
          // meters how much of it shows.
          ...listInnerStyle(peeking ? peekBox : box),
          opacity: listNearSnap ? 0.45 : 1,
          transition: listNearSnap ? undefined : "opacity 120ms ease",
        }}
      >
        {listNarrow ? (
          <NarrowListControls m={m} foldersMenu={foldersMenu} hideButton={hideButton} />
        ) : (
        <div
          className={cn(
            // Always a column flex so the New email control is a flex item
            // (avoids a ~3px inline-flex whitespace offset in block layout).
            "mail-chrome-strip flex flex-col px-5",
            listSplit
              ? "shrink-0 overflow-y-auto border-r border-[var(--mail-chrome-border)] bg-[var(--mail-chrome)] pb-3 pt-2"
              : cn(
                  "bg-[var(--mail-chrome)] pb-1 pt-2",
                  listChromeOnToolbar &&
                    "border-b border-[var(--mail-chrome-border)] pb-1"
                )
          )}
          style={listSplit ? { width: controlsWidth } : undefined}
          /* The whole head of the list, not the first row of it.

             A double click on a bar of controls is how a window is opened
             out on a Mac, and the reader aims at whatever empty chrome is
             nearest — the space under the mailbox tabs as readily as the
             space beside Sync. With only the top row listening, most of
             what looks like the same bar did nothing.

             Not on a control: a double click on the expand button is two
             presses of it, and that is already an answer. */
          onDoubleClick={(e) => {
            if (isInteractiveDoubleClickTarget(e.target)) return;
            toggleListExpanded();
          }}
        >
          {/* h-11 + pt-2 on the column match ThreadPane's action strip so
              New email / Sync share a midline with Reply / Archive / ….
              Settings + density live in the title bar. */}
          {/* No margin under this row: what follows brings its own, and two
              stacked read as a gap twice over. */}
          {/* New email is in the title bar, and the hide button at the end
              of the mailbox tabs; what is left here are the folder and
              filter buttons of the expanded list. Nothing else stands
              above the tabs, so their top is level with the top of the
              folder rail's first row beside them. */}
          {listChromeOnToolbar ? (
            <div className="-ml-[4px] flex h-11 items-center gap-1">
              {foldersButton}
              {filterButton}
            </div>
          ) : null}

          {(() => {
            /*
              A line, not a band.

              An amber block the width of the pane was more weight than the
              news deserves — the auto-reply is a thing the reader turned on
              themselves, and the tabs already carry a mark on each mailbox
              it is on for. So this says how many and until when, and offers
              the way in to change it.

              One end date is only named when every mailbox shares it.
              Otherwise the count stands alone and the dialog has the
              detail, which the hover carries too.
            */
            const on = autoReplies.filter((a) => autoReplyActive(a));
            if (!on.length) return null;
            const day = (at: number) =>
              new Date(at - 1).toLocaleDateString(currentMailLocale(), {
                day: "numeric",
                month: "short",
              });
            const ends = on.map((a) => a.endTime);
            const shared =
              ends[0] !== null && ends.every((end) => end === ends[0])
                ? day(ends[0])
                : null;
            const who =
              on.length === 1
                ? formatAccountChipLabel(on[0].account, accountLabels)
                : t("autoReplyAccounts", { count: on.length });
            return (
              <div
                className="mt-2 flex items-center gap-1.5 px-0.5 text-xs text-[var(--mail-chrome-muted)]"
                title={on
                  .map(
                    (a) =>
                      formatAccountChipLabel(a.account, accountLabels) +
                      (a.endTime !== null
                        ? ` ${t("outOfOfficeUntil", { date: day(a.endTime) })}`
                        : "")
                  )
                  .join(", ")}
              >
                <AutoReplyMark className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  {t("autoReplyOnFor", { who })}
                  {shared ? ` ${t("outOfOfficeUntil", { date: shared })}` : ""}
                </span>
                <span aria-hidden>·</span>
                <button
                  type="button"
                  // The same ink as the line it ends: a way in, not a status.
                  className="shrink-0 font-semibold hover:underline"
                  // Several on: the All tab, where they are managed together.
                  onClick={() => openAutoReply(on.length > 1 ? null : on[0].account)}
                >
                  {t("manage")}
                </button>
              </div>
            );
          })()}

          {!listVertical ? listTabsOrFolder : null}
        </div>
        )}

        {listSplit ? (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t("resizeControls")}
            aria-valuenow={Math.round(controlsWidth)}
            aria-valuemin={MIN_CONTROLS_WIDTH}
            aria-valuemax={MAX_CONTROLS_WIDTH}
            title={t("dragToResize")}
            onPointerDown={startControlsResize}
            // Sit on the pane side of the border (no -ml overlap) so chrome
            // never paints past the controls column edge.
            className="w-2 shrink-0 cursor-col-resize touch-none bg-transparent transition-colors hover:bg-stone-200/50 active:bg-stone-200/70"
          />
        ) : null}

        {threadListColumn}
      </div>
      </div>
      ) : null}
      {/* Shown from the edge, the list can be sized there too: its edge
          is a handle, as it is when the list is kept out. Marked as part
          of what came out, so the pointer on it keeps the list out. Beside
          the box, not in it: the drag measures the pane from the handle's
          parent. */}
      {peeking ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-valuenow={Math.round(listWidth)}
          data-mail-peek=""
          title={t("dragToResize")}
          onPointerDown={startListResize}
          className="absolute inset-y-0 z-30 w-3 cursor-col-resize touch-none bg-transparent transition-colors hover:bg-[var(--mail-chrome-hover)] active:bg-white/20"
          style={listFirst ? { left: railInset + listWidth } : { right: railInset + listWidth }}
        />
      ) : null}
    </>
  );
}

/**
 * The list's own way to be put away, and back, as a sidebar can be: put
 * away, and pinned from the edge. At the end of the mailbox tabs
 * (or of the narrow list's column).
 */
export function ListHideButton({ m, peek }: { m: MailPageModel; peek: ListPeek }) {
  const { chromeIconBtn: iconBtn, listExpanded, listFirst, listOutForSearch, listSliding, listVertical, phone, setListCollapsed, t } = m;
  if (phone || listExpanded || listVertical) return null;
  /*
    The glyph's right edge, not the button's, is level with the times at the
    end of the rows below (their 18px from the pane's edge). The button's
    6px of padding and the 1px inside the icon's own box go past the strip's
    20px instead: 20 - 18 + 6 + 1 = 9.
  */
  const chromeIconBtn = cn(iconBtn, "-mr-[9px]");
  return (peek.on || listOutForSearch) && !listSliding ? (
    <button
      type="button"
      title={t("keepMailListShown")}
      aria-label={t("keepMailListShown")}
      className={chromeIconBtn}
      onClick={() => {
        // Out for a search, it is already in its place: no slide to skip.
        if (peek.on) pinListInPlace();
        setListCollapsed(false);
        peek.unpeek();
      }}
    >
      <Pin className="h-4 w-4" />
    </button>
  ) : (
    <button
      type="button"
      title={t("hideMailList")}
      aria-label={t("hideMailList")}
      className={chromeIconBtn}
      onClick={() => setListCollapsed(true)}
    >
      {listFirst ? <PanelLeftClose className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
    </button>
  );
}

/**
 * The head of the list at its least width: New email, Sync, the folders,
 * and the way back to the inbox, as icons in a column.
 */
function NarrowListControls({
  m,
  foldersMenu,
  hideButton,
}: {
  m: MailPageModel;
  foldersMenu: (iconOnly: boolean) => React.ReactNode;
  hideButton: React.ReactNode;
}) {
  const {
    activeFolder,
    chromeIconBtn,
    noneFetching,
    pausedLabel,
    refreshing,
    resumeFetching,
    setActiveFolder,
    syncNow,
    syncTurn,
    t,
  } = m;
  return (
    <div className="flex shrink-0 flex-col items-center gap-0.5 border-b border-[var(--mail-chrome-border)] px-1 py-2">
      <button
        type="button"
        title={noneFetching ? pausedLabel : t("syncInbox")}
        aria-label={noneFetching ? t("mailResume") : t("syncInbox")}
        className={cn(chromeIconBtn, noneFetching && "text-indigo-500")}
        onClick={noneFetching ? resumeFetching : syncNow}
      >
        {noneFetching ? (
          <Moon className="h-4 w-4" />
        ) : (
          <SyncIcon className="h-4 w-4" spinning={refreshing || syncTurn} />
        )}
      </button>
      {foldersMenu(true)}
      {activeFolder ? (
        <button
          type="button"
          title={`Back to inbox (from ${activeFolder.name})`}
          aria-label={`Back to inbox from ${activeFolder.name}`}
          className={chromeIconBtn}
          onClick={() => setActiveFolder(null)}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
      ) : null}
      {hideButton}
    </div>
  );
}
