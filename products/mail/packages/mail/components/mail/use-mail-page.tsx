"use client";

/*
 * Everything MailPage knows and does, apart from what it draws.
 *
 * MailPage calls this once, at its top. It calls the page's concern hooks
 * in a fixed order and returns one slice per concern: accounts, sync,
 * layout, list, compose, actions, reader. MailPage puts the slices in
 * contexts (mail-page-slices.tsx), and each part of the page reads the
 * slices it needs.
 *
 * The order of the calls is the order in which the hooks always ran, so
 * the effects run in the same order. Each call takes the results of the
 * earlier calls that it reads. Keep it that way: new logic goes in a
 * concern hook, at the place where its effects must run. See
 * docs/mail-ui-structure.md.
 */

import { usePageSetup, usePageKeys } from "@/components/mail/use-page-setup";
import { useListTabsAndPins, useListQuery, useListFolders, useListView, useListData, useVisibleRows, useSelectionPart, useOutbox, useListRowsPart, useListPeople, useListPlace, usePageListSlice } from "@/components/mail/use-mail-list";
import { useComposeWarmup, useDraftsList, useDraftsView, useAutoReplyPart, useComposeState, useMacContactsOffer, useComposeStart, useComposeRequests, useDraftBadges, usePageComposeSlice } from "@/components/mail/use-mail-compose";
import { useAccountsState, usePausing, useConnection, useReconnectRequests, useHiding, usePageAccountsSlice } from "@/components/mail/use-mail-accounts";
import { useDisplaySettings, useRail, useListSpace, useListGeometry, usePageLayoutSlice } from "@/components/mail/use-mail-page-layout";
import { useReaderState, usePopoutWatch, useReaderOpening, usePageReaderSlice } from "@/components/mail/use-mail-reader";
import { useActionsCore, useActionsMore, useRowActions, usePageActionsSlice } from "@/components/mail/use-mail-actions";
import { useSyncPress, useFirstReadState, usePageSyncSlice } from "@/components/mail/use-mail-sync";
import { type MailListCacheEntry } from "@/lib/mail/list-cache";

export type MailPageProps = {
  accounts: string[];
  /** The local owner id — scopes paint caches. */
  viewerId: string;
  /** From InstantTabPaint snapshot — paints threads before the fetch returns. */
  initialList?: MailListCacheEntry & { key: string };
  /**
   * The reader's own mailboxes.
   *
   * **Not the connected list.** A connected mailbox is not necessarily the
   * reader's: a team shares `team@`, and replies to it must still reach the
   * colleagues who read it. Only a host knows which of its mailboxes are one
   * person's, so only a host says.
   */
  ownAddresses?: string[];
  /**
   * Domains whose every address is a colleague. Only for a host that has an
   * organization; left unset, nobody is a colleague, which is right for one
   * person with a personal mailbox.
   */
  ownDomains?: string[];
  /**
   * Faces the host knows: `own` for every one of the reader's own mailboxes,
   * `byAddress` for anyone else. Without it, everyone gets hashed initials.
   */
  avatars?: { own?: string; byAddress?: Record<string, string> };
  /**
   * Aliases and colleague domains as the host stores them, without the
   * connected mailboxes. Only for a host that keeps identity at runtime; one
   * that reads it from server environment leaves both of these out and the
   * settings fields stay hidden.
   */
  ownIdentity?: { addresses: string[]; domains: string[] };
  onOwnIdentityChange?: (next: {
    addresses: string[];
    domains: string[];
  }) => void;
};

export function useMailPage(props: MailPageProps) {
  const pageSetup = usePageSetup(props);
  const listTabsAndPins = useListTabsAndPins();
  useComposeWarmup();
  const accountsState = useAccountsState(props);
  const displaySettings = useDisplaySettings();
  const draftsList = useDraftsList();
  const readerState = useReaderState();
  const listQuery = useListQuery();
  const draftsView = useDraftsView({ ...listTabsAndPins, ...accountsState, ...listQuery });
  const listFolders = useListFolders(props);
  const rail = useRail();
  const listView = useListView({ ...listTabsAndPins, ...accountsState, ...listQuery });
  const pausing = usePausing({ ...pageSetup, ...accountsState });
  const listData = useListData({ ...pageSetup, ...accountsState, ...readerState, ...listQuery, ...listView, ...pausing, ...props });
  const autoReplyPart = useAutoReplyPart({ ...pageSetup });
  const composeState = useComposeState();
  const listSpace = useListSpace({ ...listQuery });
  const macContactsOffer = useMacContactsOffer(props);
  const listGeometry = useListGeometry({ ...readerState, ...rail, ...composeState, ...listSpace });
  const visibleRows = useVisibleRows({ ...listTabsAndPins, ...accountsState, ...listQuery, ...listData });
  const actionsCore = useActionsCore({ ...listTabsAndPins, ...readerState, ...listQuery, ...listView, ...listData, ...visibleRows, ...props });
  const selectionPart = useSelectionPart({ ...listTabsAndPins, ...listData, ...visibleRows });
  const actionsMore = useActionsMore({ ...pageSetup, ...listTabsAndPins, ...readerState, ...listView, ...listData, ...visibleRows, ...actionsCore, ...selectionPart });
  const composeStart = useComposeStart({ ...readerState, ...composeState, ...listSpace, ...macContactsOffer });
  usePopoutWatch();
  usePageKeys({ ...pageSetup, ...listTabsAndPins, ...displaySettings, ...readerState, ...listQuery, ...draftsView, ...listView, ...listSpace, ...listGeometry, ...visibleRows, ...actionsCore, ...composeStart });
  const syncPress = useSyncPress({ ...readerState, ...listData });
  const outbox = useOutbox({ ...listTabsAndPins, ...listData });
  const composeRequests = useComposeRequests({ ...pageSetup, ...listTabsAndPins, ...accountsState, ...draftsList, ...readerState, ...listQuery, ...composeState, ...composeStart, ownerId: props.viewerId });
  const listRowsPart = useListRowsPart({ ...listTabsAndPins, ...accountsState, ...listQuery, ...listData, ...visibleRows });
  const connection = useConnection();
  const firstReadState = useFirstReadState(props);
  useReconnectRequests({ ...actionsCore, ...connection });
  const listPeople = useListPeople({ ...pageSetup, ...listTabsAndPins, ...accountsState, ...listQuery, ...listData, ...visibleRows, ...listRowsPart, ...firstReadState });
  const draftBadges = useDraftBadges();
  const readerOpening = useReaderOpening({ ...listTabsAndPins, ...readerState, ...listData, ...composeState, ...listSpace, ...visibleRows, ...selectionPart, ...listPeople, ...props });
  const listPlace = useListPlace({ ...listTabsAndPins, ...accountsState, ...listQuery });
  const rowActions = useRowActions({ ...readerState, ...listFolders, ...listView, ...listData, ...actionsCore, ...actionsMore, ...composeRequests, ...readerOpening, ...listPlace, ...props });
  const hiding = useHiding({ ...accountsState });
  const layout = usePageLayoutSlice({ ...displaySettings, ...rail, ...listView, ...listSpace, ...listGeometry });
  const accounts = usePageAccountsSlice({ ...accountsState, ...pausing, ...autoReplyPart, ...actionsCore, ...connection, ...hiding, ...props });
  const sync = usePageSyncSlice({ ...pausing, ...listData, ...syncPress, ...firstReadState });
  const list = usePageListSlice({ ...listTabsAndPins, ...listQuery, ...listFolders, ...listView, ...listData, ...visibleRows, ...selectionPart, ...outbox, ...listRowsPart, ...listPeople, ...listPlace, ...props });
  const compose = usePageComposeSlice({ ...draftsList, ...draftsView, ...autoReplyPart, ...composeState, ...macContactsOffer, ...composeStart, ...composeRequests, ...draftBadges });
  const actions = usePageActionsSlice({ ...actionsCore, ...actionsMore, ...outbox, ...rowActions });
  const reader = usePageReaderSlice({ ...readerState, ...readerOpening });
  return { accounts, sync, layout, list, compose, actions, reader };
}

export type MailPageModel = ReturnType<typeof useMailPage>;
