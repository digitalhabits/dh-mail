"use client";

/*
 * The layout concern of the mail page: how the list, the reader and the
 * folders share the window, how dense the rows are, the zoom and the text
 * size, the colour mode, and whether this is the phone layout.
 *
 * Two hooks, because the parts are made at different points of
 * useMailPage, each where its effects always ran:
 *
 * - `useMailDisplay` holds the density, the colour mode, the phone
 *   question and the text size. useMailPage calls it near its top.
 * - `useLayoutSlice` puts that together with the rail, the list's place
 *   and size (use-list-layout), the zoom and the list's collapse into one
 *   memoised object, after the last of them.
 *
 * Components read the slice with `usePageLayout` (mail-page-slices.tsx).
 */

import * as React from "react";

import { useMemoObject } from "@/components/mail/use-memo-object";
import { useMailListDensity } from "@/components/mail/mail-list-state";
import { useListLayout } from "@/components/mail/use-list-layout";
import { useMailZoom } from "@/components/mail/use-mail-layout";
import { useFolderRailOpen, useFolderRailWidth } from "@/lib/mail/folder-rail";
import { useMailColorMode } from "@/lib/mail/theme";
import { useApplyUiScale, useUiScale } from "@/lib/mail/use-ui-scale";
import { usePhoneLayout } from "@/lib/mail/use-phone-layout";
import { cn } from "@/lib/utils";
import { useListHiddenUnlessSearching } from "@/components/mail/use-list-peek";
import type { useListQuery, useListView } from "@/components/mail/use-mail-list";
import type { useReaderState } from "@/components/mail/use-mail-reader";
import type { useComposeState } from "@/components/mail/use-mail-compose";

export function useMailDisplay() {
  const [listDensity, setListDensity] = useMailListDensity();
  const colorMode = useMailColorMode();
  const chromeDark = colorMode === "dark";
  /**
   * The phone layout: one list, the reader over it. The pieces below are
   * built once and stand in whichever frame the window asks for — see the
   * phone branch before the desktop return, and MailPhoneShell.
   */
  const phone = usePhoneLayout();
  // The reader's own size for the whole app — see use-ui-scale.
  const [uiScale, setUiScale] = useUiScale();
  useApplyUiScale(uiScale);
  const chromeIconBtn = cn(
    "rounded-inner p-1.5",
    chromeDark
      ? "text-[var(--mail-chrome-muted)] hover:bg-[var(--mail-chrome-hover)] hover:text-[var(--mail-chrome-fg)]"
      : "text-stone-500 hover:bg-[var(--mail-sidebar-hover)] hover:text-stone-800"
  );
  return {
    listDensity,
    setListDensity,
    colorMode,
    chromeDark,
    phone,
    uiScale,
    setUiScale,
    chromeIconBtn,
  };
}

type Display = ReturnType<typeof useMailDisplay>;
type Geometry = ReturnType<typeof useListLayout>;
type RailWidth = ReturnType<typeof useFolderRailWidth>;
type Zoom = ReturnType<typeof useMailZoom>;

export function useLayoutSlice({
  display,
  geometry,
  setRailOpen,
  rail,
  zoom,
  listExpanded,
  setListExpanded,
  listCollapsed,
  setListCollapsed,
  listOutForSearch,
  mailSurfaceRef,
}: {
  display: Display;
  geometry: Geometry;
  setRailOpen: ReturnType<typeof useFolderRailOpen>[1];
  rail: RailWidth;
  zoom: Zoom;
  listExpanded: boolean;
  setListExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  listCollapsed: boolean;
  setListCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  /** The list is out over the reader for a search (use-list-peek). */
  listOutForSearch: boolean;
  /** The page's outer box. */
  mailSurfaceRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { listDensity, setListDensity, colorMode, chromeDark, phone, chromeIconBtn } = display;
  return useMemoObject({
    ...geometry,
    listDensity,
    setListDensity,
    colorMode,
    chromeDark,
    chromeIconBtn,
    phone,
    zoom: zoom[0],
    adjustZoom: zoom[1],
    setRailOpen,
    railWidth: rail.width,
    railResizing: rail.resizing,
    startRailResize: rail.startResize,
    listExpanded,
    setListExpanded,
    listCollapsed,
    setListCollapsed,
    listOutForSearch,
    mailSurfaceRef,
  });
}

export type MailLayoutSlice = ReturnType<typeof useLayoutSlice>;

export function useDisplaySettings() {
  // Density, colour mode, the phone question and the text size.
  const display = useMailDisplay();
  const { uiScale, setUiScale } = display;
  return { display, setUiScale, uiScale };
}

export function useRail() {
  const [railOpen, setRailOpen] = useFolderRailOpen();
  const railWidthControls = useFolderRailWidth();
  const {
    width: railWidth,
    resizing: railResizing,
  } = railWidthControls;
  return { railOpen, railResizing, railWidth, railWidthControls, setRailOpen };
}

export function useListSpace({
  search,
}: Pick<ReturnType<typeof useListQuery>, "search">) {
  /**
   * The mail list put away, so the thread or the message being written
   * gets the pane. Kept from one thread to the next, and with nothing open.
   * See use-list-peek.
   */
  const [listCollapsed, setListCollapsed, listOutForSearch] = useListHiddenUnlessSearching(search);
  /** List fills the shell; reading pane is hidden until restored. */
  const [listExpanded, setListExpanded] = React.useState(false);
  const zoomControls = useMailZoom();
  const [zoom, adjustZoom] = zoomControls;
  return { adjustZoom, listCollapsed, listExpanded, listOutForSearch, setListCollapsed, setListExpanded, zoom, zoomControls };
}

export function useListGeometry({
  composing,
  listCollapsed,
  listExpanded,
  railOpen,
  railResizing,
  railWidth,
  selected,
  setListCollapsed,
  setListExpanded,
}: Pick<ReturnType<typeof useReaderState>, "selected"> &
  Pick<ReturnType<typeof useRail>, "railOpen" | "railResizing" | "railWidth"> &
  Pick<ReturnType<typeof useComposeState>, "composing"> &
  Pick<ReturnType<typeof useListSpace>, "listCollapsed" | "listExpanded" | "setListCollapsed" | "setListExpanded">) {
  const geometry = useListLayout({
    listExpanded,
    setListExpanded,
    listCollapsed,
    setListCollapsed,
    composing,
    selected,
    railOpen,
    railWidth,
    railResizing,
  });
  const {
    detailOpen,
    toggleListExpanded,
  } = geometry;
  return { detailOpen, geometry, toggleListExpanded };
}

export function usePageLayoutSlice({
  display,
  geometry,
  listCollapsed,
  listExpanded,
  listOutForSearch,
  mailSurfaceRef,
  railWidthControls,
  setListCollapsed,
  setListExpanded,
  setRailOpen,
  zoomControls,
}: Pick<ReturnType<typeof useDisplaySettings>, "display"> &
  Pick<ReturnType<typeof useRail>, "railWidthControls" | "setRailOpen"> &
  Pick<ReturnType<typeof useListView>, "mailSurfaceRef"> &
  Pick<ReturnType<typeof useListSpace>, "listCollapsed" | "listExpanded" | "listOutForSearch" | "setListCollapsed" | "setListExpanded" | "zoomControls"> &
  Pick<ReturnType<typeof useListGeometry>, "geometry">) {
  const layout = useLayoutSlice({
    display,
    geometry,
    setRailOpen,
    rail: railWidthControls,
    zoom: zoomControls,
    listExpanded,
    setListExpanded,
    listCollapsed,
    setListCollapsed,
    listOutForSearch,
    mailSurfaceRef,
  });
  return layout;
}
