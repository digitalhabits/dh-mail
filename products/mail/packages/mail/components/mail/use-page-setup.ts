"use client";

/*
 * The parts of the mail page that belong to no one concern: the words, the
 * shortcuts, the reader's own addresses, and the window's keys.
 *
 * useMailPage calls these where it always made them. See
 * docs/mail-ui-structure.md.
 */

import * as React from "react";
import { setOwnMailIdentity } from "@/lib/own-addresses";
import { useMailWindowKeys } from "@/components/mail/use-mail-window-keys";
import { mailPageCacheKey } from "@/lib/page-snapshot-cache";
import { useMailT } from "@/lib/mail/i18n";
import { useMailShortcuts } from "@/lib/mail/use-mail-shortcuts";
import { setMailAvatars } from "@/lib/mail/team-avatars";
import { scrubLegacySharedMailCaches } from "@/lib/mail/list-cache";
import type { useListQuery, useListTabsAndPins, useListView, useVisibleRows } from "@/components/mail/use-mail-list";
import type { useDisplaySettings, useListGeometry, useListSpace } from "@/components/mail/use-mail-page-layout";
import type { useReaderState } from "@/components/mail/use-mail-reader";
import type { useComposeStart, useDraftsView } from "@/components/mail/use-mail-compose";
import type { useActionsCore } from "@/components/mail/use-mail-actions";
import type { MailPageProps } from "@/components/mail/use-mail-page";

export function usePageSetup({
  avatars,
  ownAddresses,
  ownDomains,
  viewerId,
}: Pick<MailPageProps, "avatars" | "ownAddresses" | "ownDomains" | "viewerId">) {
  const t = useMailT();
  const shortcuts = useMailShortcuts();
  // Before anything renders: reply-stripping, the "You" label, and the
  // in-contacts split all ask whether an address is the reader's, and the
  // answer is nothing until it is set. useMemo, not useEffect — the first
  // render already asks.
  React.useMemo(() => {
    setOwnMailIdentity({
      addresses: ownAddresses ?? [],
      domains: ownDomains ?? [],
    });
    setMailAvatars({ own: avatars?.own, byAddress: avatars?.byAddress ?? {} });
  }, [ownAddresses, ownDomains, avatars]);
  const pageSnapKey = mailPageCacheKey(viewerId);
  React.useLayoutEffect(() => {
    scrubLegacySharedMailCaches();
  }, []);
  return { pageSnapKey, shortcuts, t };
}

export function usePageKeys({
  activeFolder,
  adjustZoom,
  detailOpen,
  draftsView,
  hasMailUndo,
  landOnPerson,
  openThreadRef,
  personRowOrderRef,
  screenThreadOrderRef,
  searchInputRef,
  selected,
  selectedPersonKey,
  setActiveFolder,
  setSelected,
  setSelectedPersonKey,
  setUiScale,
  shortcuts,
  startCompose,
  toggleListExpanded,
  uiScale,
  undoLastMailAction,
  viewMode,
  zoom,
}: Pick<ReturnType<typeof usePageSetup>, "shortcuts"> &
  Pick<ReturnType<typeof useListTabsAndPins>, "viewMode"> &
  Pick<ReturnType<typeof useDisplaySettings>, "setUiScale" | "uiScale"> &
  Pick<ReturnType<typeof useReaderState>, "landOnPerson" | "openThreadRef" | "selected" | "selectedPersonKey" | "setSelected" | "setSelectedPersonKey"> &
  Pick<ReturnType<typeof useListQuery>, "activeFolder" | "setActiveFolder"> &
  Pick<ReturnType<typeof useDraftsView>, "draftsView"> &
  Pick<ReturnType<typeof useListView>, "searchInputRef"> &
  Pick<ReturnType<typeof useListSpace>, "adjustZoom" | "zoom"> &
  Pick<ReturnType<typeof useListGeometry>, "detailOpen" | "toggleListExpanded"> &
  Pick<ReturnType<typeof useVisibleRows>, "personRowOrderRef" | "screenThreadOrderRef"> &
  Pick<ReturnType<typeof useActionsCore>, "hasMailUndo" | "undoLastMailAction"> &
  Pick<ReturnType<typeof useComposeStart>, "startCompose">) {
  useMailWindowKeys({
    undoLastMailAction,
    hasMailUndo,
    startCompose,
    selected,
    activeFolder,
    setActiveFolder,
    adjustZoom,
    shortcuts,
    toggleListExpanded,
    detailOpen,
    uiScale,
    setUiScale,
    zoom,
    viewMode,
    draftsView: Boolean(draftsView),
    selectedPersonKey,
    landOnPerson,
    personRowOrderRef,
    screenThreadOrderRef,
    openThreadRef,
    searchInputRef,
    closeThread: () => {
      setSelected(null);
      setSelectedPersonKey(null);
    },
  });
}
