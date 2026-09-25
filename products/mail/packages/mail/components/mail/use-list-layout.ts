"use client";

/*
 * How the list and the reading pane share the window, off useMailPage:
 * where the list stands (left, right, top or bottom), how wide or tall
 * it is, whether it is expanded, and the geometry measured from all of
 * that (use-mail-pane-geometry).
 *
 * Owns: those sizes and the one rule that ties them to what is open:
 * with nothing open, a hidden list comes back.
 *
 * Does not own: whether the list is collapsed or expanded. That state
 * stays in useMailPage, which other actions also set, and comes in here.
 *
 * The hooks inside (placement, width, height, controls width, geometry)
 * and the one effect run in the order they always ran; useMailPage calls
 * this hook where they stood.
 */

import * as React from "react";
import { useMailPaneGeometry } from "@/components/mail/use-mail-pane-geometry";
import { NARROW_LIST_WIDTH, useMailControlsWidth, useMailListHeight, useMailListPlacement, useMailListWidth } from "@/components/mail/use-mail-layout";

export function useListLayout({
  listExpanded,
  setListExpanded,
  listCollapsed,
  setListCollapsed,
  composing,
  selected,
  railOpen,
  railWidth,
  railResizing,
}: {
  listExpanded: boolean;
  setListExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  listCollapsed: boolean;
  setListCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  composing: boolean;
  /** The open thread; with a composer, what makes the reading pane full. */
  selected: unknown;
  railOpen: boolean;
  railWidth: number;
  railResizing: boolean;
}) {
  const listPlacement = useMailListPlacement();
  const listVertical =
    listPlacement === "top" || listPlacement === "bottom";
  /**
   * Side by side and expanded: one column, controls over the rows.
   *
   * Splitting here used to pin the controls at the list's old width and
   * send the rows right, which left a column of buttons and empty space.
   * Stacked (top / bottom) still splits, because the list is a strip and
   * the controls need a column of their own.
   */
  const listSplit = listVertical;
  /** Folder and filter name the mail, so they stand before New email. */
  const listChromeOnToolbar = listExpanded && !listVertical;
  /**
   * Expanded rows sit on the pane, not the chrome.
   *
   * The wide list is the thing being read, so it takes the same white
   * (or dark pane) the split list used. The toolbar stays on the chrome
   * above it.
   */
  const listRowsOnPane = listSplit || listExpanded;
  const detailOpen = composing || selected != null;
  const [listWidth, startListResize, expandListFromNarrow] =
    useMailListWidth({
      canCollapse: detailOpen && !listExpanded,
      onCollapse: () => setListCollapsed(true),
      invertDrag: listPlacement === "right",
    });
  const [listHeight, startListHeightResize] = useMailListHeight({
    canCollapse: detailOpen && !listExpanded,
    onCollapse: () => setListCollapsed(true),
    invertDrag: listPlacement === "bottom",
  });
  const [controlsWidth, startControlsResize] = useMailControlsWidth();
  /** Whether the list was hidden when Expand was pressed — the sweep then
      opens from the reader's edge rather than from a strip nobody saw. */
  const expandedFromHiddenRef = React.useRef(false);
  /*
    Where everything stands — the measured pane, the squeeze a composer
    asks of the list and the folders, the sweeps and their numbers, the
    title bar's left edge. All of it is derivation, and it lives together
    in use-mail-pane-geometry; what comes back is read, not steered.
  */
  const {
    paneRowRef,
    threadListRef,
    hideList,
    railShowing,
    railHidden,
    shownListWidth,
    shownRailWidth,
    listOpen,
    listSliding,
    listMounted,
    listExpandSliding,
    listSlideOverlay,
    expandClip,
    railInset,
    listSlideTransform,
    railSlideTransform,
    listNarrow,
    listRowWide,
    listNearSnap,
    listFirst,
    railOnRight,
    listControlsLeft,
    titlebarLeft,
    listBorderClass,
    railSlideDuration,
  } = useMailPaneGeometry({
    listPlacement,
    listVertical,
    listExpanded,
    listCollapsed,
    detailOpen,
    listWidth,
    listHeight,
    controlsWidth,
    railOpen,
    railWidth,
    railResizing,
    expandedFromHidden: expandedFromHiddenRef,
  });
  const toggleListExpanded = React.useCallback(() => {
    setListExpanded((v) => {
      if (!v) {
        // Where the sweep starts — see the slide states. Read before the
        // collapse below erases the answer.
        expandedFromHiddenRef.current = listCollapsed && detailOpen;
        setListCollapsed(false);
        // Don't carry a 56px rail into the expanded list.
        if (listWidth <= NARROW_LIST_WIDTH) expandListFromNarrow();
      }
      return !v;
    });
  }, [expandListFromNarrow, listWidth, listCollapsed, detailOpen, setListCollapsed, setListExpanded]);

  // Empty reading pane can't fill the space — always bring the list back.
  React.useEffect(() => {
    if (!detailOpen) setListCollapsed(false);
  }, [detailOpen, setListCollapsed]);

  return {
    listVertical,
    listSplit,
    listChromeOnToolbar,
    listRowsOnPane,
    detailOpen,
    listWidth,
    startListResize,
    expandListFromNarrow,
    listHeight,
    startListHeightResize,
    controlsWidth,
    startControlsResize,
    toggleListExpanded,
    paneRowRef,
    threadListRef,
    hideList,
    railShowing,
    railHidden,
    shownListWidth,
    shownRailWidth,
    listOpen,
    listSliding,
    listMounted,
    listExpandSliding,
    listSlideOverlay,
    expandClip,
    railInset,
    listSlideTransform,
    railSlideTransform,
    listNarrow,
    listRowWide,
    listNearSnap,
    listFirst,
    railOnRight,
    listControlsLeft,
    titlebarLeft,
    listBorderClass,
    railSlideDuration,
  };
}
