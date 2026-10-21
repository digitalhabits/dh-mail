"use client";

/*
 * The mail page's concerns, as React contexts.
 *
 * useMailPage makes one memoised object per concern (a "slice"). MailPage
 * puts them here, around everything it draws, and a component reads only
 * the slices it needs. A component that reads one slice draws again when
 * that slice changes, not on every change to the page.
 *
 * Each `usePage…` hook throws outside MailPage: a component that reads a
 * slice is a part of the page, and has no meaning without it.
 *
 * See docs/mail-ui-structure.md for which hook owns which state.
 */

import * as React from "react";

import type { MailAccountsSlice } from "@/components/mail/use-mail-accounts";
import type { MailSyncSlice } from "@/components/mail/use-mail-sync";
import type { MailLayoutSlice } from "@/components/mail/use-mail-page-layout";
import type { MailPageModel } from "@/components/mail/use-mail-page";

export type MailListSlice = MailPageModel["list"];
export type MailComposeSlice = MailPageModel["compose"];
export type MailActionsSlice = MailPageModel["actions"];
export type MailReaderSlice = MailPageModel["reader"];

const AccountsContext = React.createContext<MailAccountsSlice | null>(null);
const SyncContext = React.createContext<MailSyncSlice | null>(null);
const LayoutContext = React.createContext<MailLayoutSlice | null>(null);
const ListContext = React.createContext<MailListSlice | null>(null);
const ComposeContext = React.createContext<MailComposeSlice | null>(null);
const ActionsContext = React.createContext<MailActionsSlice | null>(null);
const ReaderContext = React.createContext<MailReaderSlice | null>(null);

function need<T>(value: T | null, name: string): T {
  if (value == null) throw new Error(`${name} is read outside MailPage`);
  return value;
}

/** The mailboxes: order, labels, scope, hiding, pausing, auto-replies. */
export function usePageAccounts(): MailAccountsSlice {
  return need(React.useContext(AccountsContext), "usePageAccounts");
}

/** Sync now, the background read, and whether any mailbox is paused. */
export function usePageSync(): MailSyncSlice {
  return need(React.useContext(SyncContext), "usePageSync");
}

/** How the list, the reader and the folders share the window; density, zoom, colour. */
export function usePageLayout(): MailLayoutSlice {
  return need(React.useContext(LayoutContext), "usePageLayout");
}

/** The list: tabs, filters, search, folders, the rows and the selection. */
export function usePageList(): MailListSlice {
  return need(React.useContext(ListContext), "usePageList");
}

/** Writing: the composer, the drafts, the floating cards, the auto-reply dialog. */
export function usePageCompose(): MailComposeSlice {
  return need(React.useContext(ComposeContext), "usePageCompose");
}

/** What is done to mail: archive, move, snooze, undo, delete, pins. */
export function usePageActions(): MailActionsSlice {
  return need(React.useContext(ActionsContext), "usePageActions");
}

/** What is open: the thread or the person, and the ways to open one. */
export function usePageReader(): MailReaderSlice {
  return need(React.useContext(ReaderContext), "usePageReader");
}

type Slices = {
  accounts: MailAccountsSlice;
  sync: MailSyncSlice;
  layout: MailLayoutSlice;
  list: MailListSlice;
  compose: MailComposeSlice;
  actions: MailActionsSlice;
  reader: MailReaderSlice;
};

export function MailPageSlices({ slices, children }: { slices: Slices; children: React.ReactNode }) {
  return (
    <AccountsContext.Provider value={slices.accounts}>
      <SyncContext.Provider value={slices.sync}>
        <LayoutContext.Provider value={slices.layout}>
          <ListContext.Provider value={slices.list}>
            <ComposeContext.Provider value={slices.compose}>
              <ActionsContext.Provider value={slices.actions}>
                <ReaderContext.Provider value={slices.reader}>{children}</ReaderContext.Provider>
              </ActionsContext.Provider>
            </ComposeContext.Provider>
          </ListContext.Provider>
        </LayoutContext.Provider>
      </SyncContext.Provider>
    </AccountsContext.Provider>
  );
}
