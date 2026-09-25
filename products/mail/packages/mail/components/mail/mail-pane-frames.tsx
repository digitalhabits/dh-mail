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
import { ArrowLeft, Maximize2, Minimize2, Moon, SquarePen } from "lucide-react";
import { beginNativeWindowDragOnMove } from "@/lib/native-shell";
import { autoReplyActive } from "@/components/mail/AutoReplyDialog";
import { formatAccountChipLabel } from "@/lib/mail/account-labels";
import { Button } from "@/components/ui/button";
import { currentMailLocale } from "@/lib/mail/i18n";
import { formatShortcut } from "@/lib/mail/shortcuts";
import { AutoReplyMark } from "@/components/mail/AutoReplyMark";
import { cn } from "@/lib/utils";
import { SyncIcon } from "@/components/mail/MailListControls";
import type { MailPageModel } from "@/components/mail/use-mail-page";
import { listBoxStyle, listInnerStyle } from "@/components/mail/list-box-style";

/** The reading pane's frame: it holds the pane through the expand sweep. */
export function ReadingPaneFrame({
  m,
  readingPaneContent,
}: {
  m: MailPageModel;
  readingPaneContent: React.ReactNode;
}) {
  const {
    listExpandSliding,
    listExpanded,
    listFirst,
  } = m;
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
        style={{ order: listFirst ? 3 : 1 }}
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
  filterButton,
  foldersButton,
  foldersMenu,
  listTabsOrFolder,
  threadListColumn,
}: {
  m: MailPageModel;
  filterButton: React.ReactNode;
  foldersButton: React.ReactNode;
  foldersMenu: (iconOnly: boolean) => React.ReactNode;
  listTabsOrFolder: React.ReactNode;
  threadListColumn: React.ReactNode;
}) {
  const {
    accountLabels,
    autoReplies,
    chromeDark,
    chromeIconBtn,
    controlsWidth,
    expandClip,
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
    listSlideOverlay,
    listSlideTransform,
    listSplit,
    listVertical,
    listWidth,
    noneFetching,
    openAutoReply,
    pausedLabel,
    railInset,
    refreshing,
    resumeFetching,
    shortcuts,
    shownListWidth,
    startCompose,
    startControlsResize,
    syncNow,
    syncTurn,
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
  return (
    <>
      {/* ------------------------------------------------ thread list */}
      {listMounted ? (
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
        className={cn(
          "relative overflow-hidden",
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
          ...listBoxStyle(box),
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
          ...listInnerStyle(box),
          opacity: listNearSnap ? 0.45 : 1,
          transition: listNearSnap ? undefined : "opacity 120ms ease",
        }}
      >
        {listNarrow ? (
          <NarrowListControls m={m} foldersMenu={foldersMenu} />
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
          <div className="-ml-[4px] flex h-11 items-center gap-1">
            {listChromeOnToolbar ? foldersButton : null}
            {listChromeOnToolbar ? filterButton : null}
            <Button
              type="button"
              title={t("newEmail")}
              aria-label={t("newEmail")}
              variant={chromeDark ? "default" : "outline"}
              className={cn(
                // flex overrides Button's inline-flex so it sits flush in the row.
                // h-9 matches ThreadAction; keep padding inside that height.
                // A pill, and the same one the thread's Reply is.
                "flex h-9 max-w-[9rem] flex-1 gap-1.5 rounded-full px-3 py-0 text-sm font-semibold shadow-none",
                /*
                  Not `bg-white text-stone-800`, which is what this asked
                  for and never got: the shell rewrites both of those for
                  the dark theme, so the one button meant to be the thing
                  you press came out the same navy as the page behind it.

                  A lifted slate rather than white or cream: on a dark page
                  those are too big a jump to make with a button, and the
                  eye reads a hole rather than a surface. The same three
                  the thread's Reply and Forward use — see --mail-action.
                */
                chromeDark &&
                  "border border-[var(--mail-action-border)] bg-[var(--mail-action)] text-[var(--mail-action-fg)] hover:bg-[var(--mail-action-hover)]"
              )}
              onPointerDown={beginNativeWindowDragOnMove}
              onClick={() => startCompose()}
            >
              <SquarePen className="h-4 w-4" />
              {listChromeOnToolbar || listWidth >= 250
                ? t("newEmail")
                : t("newShort")}
            </Button>
            <button
              type="button"
              title={noneFetching ? pausedLabel : t("syncInbox")}
              aria-label={noneFetching ? t("mailResume") : t("syncInbox")}
              onPointerDown={beginNativeWindowDragOnMove}
              /* Paused, this is the way out of it: the one control that
                 would have fetched is the one that says why nothing is. */
              onClick={noneFetching ? resumeFetching : syncNow}
              className={cn(
                "flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 text-sm font-medium",
                noneFetching && "text-indigo-600 hover:text-indigo-700",
                chromeDark
                  ? "text-[var(--mail-chrome-muted)] hover:bg-[var(--mail-chrome-hover)] hover:text-[var(--mail-chrome-fg)]"
                  : "text-stone-500 hover:bg-stone-200/70 hover:text-stone-800"
              )}
            >
              {noneFetching ? (
                <Moon className="h-4 w-4" />
              ) : (
                <SyncIcon className="h-4 w-4" spinning={refreshing || syncTurn} />
              )}
              {/* Quiet, this is the moon and nothing else: the badge beside
                  the search says until when, and the same words twice in
                  one corner is one of them saying nothing. The hover still
                  carries them, and so does the label a screen reader reads. */}
              {noneFetching ? null : t("sync")}
            </button>
            <button
              type="button"
              title={`${t(listExpanded ? "restoreListSize" : "expandList")} (${formatShortcut(
                shortcuts.expandList
              )})`}
              aria-label={`${t(listExpanded ? "restoreListSize" : "expandList")} (${formatShortcut(
                shortcuts.expandList
              )})`}
              aria-pressed={listExpanded}
              className={cn(
                chromeIconBtn,
                // Beside Sync, not out at the far edge: it belongs with the
                // controls it sits among, and a button alone across the row
                // reads as belonging to nothing.
                "flex h-8 w-8 shrink-0 items-center justify-center p-0"
              )}
              onClick={toggleListExpanded}
              onDoubleClick={(e) => {
                if (isInteractiveDoubleClickTarget(e.target)) return;
                toggleListExpanded();
              }}
            >
              {listExpanded ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </button>
          </div>

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
                  className="shrink-0 font-semibold text-teal-700 hover:underline"
                  onClick={() => openAutoReply(on[0].account)}
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
    </>
  );
}

/**
 * The head of the list at its least width: New email, Sync, the folders,
 * and the way back to the inbox, as icons in a column.
 */
function NarrowListControls({
  m,
  foldersMenu,
}: {
  m: MailPageModel;
  foldersMenu: (iconOnly: boolean) => React.ReactNode;
}) {
  const {
    activeFolder,
    chromeIconBtn,
    noneFetching,
    pausedLabel,
    refreshing,
    resumeFetching,
    setActiveFolder,
    startCompose,
    syncNow,
    syncTurn,
    t,
  } = m;
  return (
    <div className="flex shrink-0 flex-col items-center gap-0.5 border-b border-[var(--mail-chrome-border)] px-1 py-2">
      <button
        type="button"
        title={t("newEmail")}
        aria-label={t("newEmail")}
        className={chromeIconBtn}
        onClick={() => startCompose()}
      >
        <SquarePen className="h-4 w-4" />
      </button>
      <div
        className="my-1 h-px w-6 bg-[var(--mail-chrome-border)]"
        aria-hidden
      />
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
    </div>
  );
}
