"use client";

/*
 * The compose concern of the mail page: the composer and its seed, the
 * floating reply and new message, the drafts, the auto-reply dialog, and
 * the requests that open a composer from elsewhere.
 *
 * Each `use…` here is one part of useMailPage, called where its hooks always
 * ran, so the effects keep their order. `usePageComposeSlice` makes the slice
 * that components read with `usePageCompose` (mail-page-slices.tsx). See
 * docs/mail-ui-structure.md.
 */

import * as React from "react";
import { flushPendingDiscards } from "@/lib/mail/pending-discard";
import { onMailComposeTo } from "@/lib/mail/compose-to";
import { useAutoReply } from "@/components/mail/use-auto-reply";
import { useMemoObject } from "@/components/mail/use-memo-object";
import { useEditAsNew } from "@/components/mail/use-edit-as-new";
import { useWindowRequests } from "@/components/mail/use-window-requests";
import { useDraftsInbox } from "@/components/mail/use-drafts-inbox";
import { useComposeHome } from "@/components/mail/use-compose-home";
import { pruneExpiredMailDrafts } from "@/lib/mail/local-drafts";
import { useMailDrafts } from "@/components/mail/use-mail-drafts";
import { preloadRichTextEditor } from "@/components/ui/RichTextEditor";
import { useThreadDraftKeys } from "@/components/mail/ThreadListRow";
import { draftsScope } from "@/components/mail/draft-opening";
import { isMailboxScopeAll } from "@/components/mail/mail-list-state";
import type { useListQuery, useListTabsAndPins } from "@/components/mail/use-mail-list";
import type { useAccountsState } from "@/components/mail/use-mail-accounts";
import type { usePageSetup } from "@/components/mail/use-page-setup";
import type { useReaderState } from "@/components/mail/use-mail-reader";
import type { useListSpace } from "@/components/mail/use-mail-page-layout";
import type { MailPageProps } from "@/components/mail/use-mail-page";

export function useComposeWarmup() {
  // Fetch the Quill chunk right away, so the first Reply doesn't flash a
  // composer without its editor while the chunk downloads.
  React.useEffect(() => {
    preloadRichTextEditor();
  }, []);
  // Drop local drafts idle for ~90 days (also refreshes Draft badges).
  React.useEffect(() => {
    pruneExpiredMailDrafts();
  }, []);
}

export function useDraftsList() {
  const { drafts, loading: draftsLoading, refresh: refreshDrafts } =
    useMailDrafts();
  return { drafts, draftsLoading, refreshDrafts };
}

export function useDraftsView({
  accountEmails,
  activeFolder,
  mailboxScopeEmails,
  tab,
}: Pick<ReturnType<typeof useListTabsAndPins>, "tab"> &
  Pick<ReturnType<typeof useAccountsState>, "accountEmails" | "mailboxScopeEmails"> &
  Pick<ReturnType<typeof useListQuery>, "activeFolder">) {
  /**
   * The drafts view, at the head of the rail or under one account.
   *
   * Gmail keeps drafts as a label that cannot be listed by name, so the row
   * under an account is this same view with one mailbox left in it. Outlook
   * has a real folder and reaches it the ordinary way.
   */
  const draftsView =
    tab === "drafts" || (activeFolder?.virtual && activeFolder.role === "drafts");
  const draftsAccount = draftsScope(activeFolder, isMailboxScopeAll(mailboxScopeEmails, accountEmails) ? null : mailboxScopeEmails);
  return { draftsAccount, draftsView };
}

export function useAutoReplyPart({
  t,
}: Pick<ReturnType<typeof usePageSetup>, "t">) {
  const autoReply = useAutoReply({ t });
  const {
    autoReplyOpen,
    autoReplyAccount,
    openAutoReply,
    closeAutoReply,
    backFromAutoReply,
    storeAutoReply,
  } = autoReply;
  return { autoReply, autoReplyAccount, autoReplyOpen, backFromAutoReply, closeAutoReply, openAutoReply, storeAutoReply };
}

export function useComposeState() {
  const {
    composing,
    setComposing,
    floatingReply,
    setFloatingReply,
    floatingCompose,
    setFloatingCompose,
    composeSeed,
    setComposeSeed,
    phoneDockedDraft,
    setPhoneDockedDraft,
  } = useComposeHome();
  const closeCompose = React.useCallback(() => {
    setComposing(false);
    setComposeSeed(null);
  }, [setComposing, setComposeSeed]);
  return { closeCompose, composeSeed, composing, floatingCompose, floatingReply, phoneDockedDraft, setComposeSeed, setComposing, setFloatingCompose, setFloatingReply, setPhoneDockedDraft };
}

export function useMacContactsOffer({
  accounts,
}: Pick<MailPageProps, "accounts">) {
  /**
   * When to offer the Mac address book.
   *
   * Once a mailbox exists, because completing an address means nothing before
   * there is mail to write. Then once more when a composer opens, which is the
   * moment it would have helped. `mac-contacts-ask` counts the offers and
   * stops at two.
   */
  const [macAskTrigger, setMacAskTrigger] = React.useState(0);
  const offerMacContacts = React.useCallback(() => {
    setMacAskTrigger((n) => n + 1);
  }, []);
  React.useEffect(() => {
    if (accounts.length) offerMacContacts();
  }, [accounts.length, offerMacContacts]);
  return { macAskTrigger, offerMacContacts };
}

export function useComposeStart({
  offerMacContacts,
  setComposeSeed,
  setComposing,
  setListExpanded,
  setSelected,
  setSelectedPersonKey,
}: Pick<ReturnType<typeof useReaderState>, "setSelected" | "setSelectedPersonKey"> &
  Pick<ReturnType<typeof useComposeState>, "setComposeSeed" | "setComposing"> &
  Pick<ReturnType<typeof useListSpace>, "setListExpanded"> &
  Pick<ReturnType<typeof useMacContactsOffer>, "offerMacContacts">) {
  const startCompose = React.useCallback(
    (seed?: {
      to: string[];
      subject: string;
      continuedFromLabel: string;
      draftKey?: string;
      keepFocus?: boolean;
    }) => {
      setSelected(null);
      setSelectedPersonKey(null);
      setListExpanded(false);
      setComposeSeed(seed ?? null);
      setComposing(true);
      // The second and last offer of the Mac address book, at the point it
      // would have helped. It shows nothing if the first one settled it.
      offerMacContacts();
    },
    // The setters are useState setters, which do not change.
    [offerMacContacts, setComposing, setComposeSeed, setListExpanded, setSelected, setSelectedPersonKey]
  );
  // An address clicked in a message body — in the plain-text view, or inside
  // the frame that renders HTML. Both ask through the same event.
  React.useEffect(
    () =>
      onMailComposeTo((address) =>
        startCompose({ to: [address], subject: "", continuedFromLabel: "" })
      ),
    [startCompose]
  );
  return { startCompose };
}

export function useComposeRequests({
  accountEmails,
  closeCompose,
  refreshDrafts,
  setActiveFolder,
  setComposing,
  setSelected,
  setSelectedPersonKey,
  setTab,
  startCompose,
  t,
}: Pick<ReturnType<typeof usePageSetup>, "t"> &
  Pick<ReturnType<typeof useListTabsAndPins>, "setTab"> &
  Pick<ReturnType<typeof useAccountsState>, "accountEmails"> &
  Pick<ReturnType<typeof useDraftsList>, "refreshDrafts"> &
  Pick<ReturnType<typeof useReaderState>, "setSelected" | "setSelectedPersonKey"> &
  Pick<ReturnType<typeof useListQuery>, "setActiveFolder"> &
  Pick<ReturnType<typeof useComposeState>, "closeCompose" | "setComposing"> &
  Pick<ReturnType<typeof useComposeStart>, "startCompose">) {
  const { editAsNewFromSource, editAsNewMessage, editAsNewMessageRef } =
    useEditAsNew({ startCompose, t });
  /**
   * A discard still inside its undo window when the window closes.
   *
   * Sending it beats losing it: the reader has had their chance to take it
   * back, and dropping the request would leave a draft in Gmail that this app
   * said it had thrown away. Best effort — a request started this late is not
   * guaranteed to finish, and if it does not, the draft simply stays.
   */
  React.useEffect(() => {
    const onHide = () => flushPendingDiscards();
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);
  // Drafts another program left in the drafts folder (use-drafts-inbox).
  // The toast's button opens Drafts, and the draft itself when it was one.
  useDraftsInbox(accountEmails, (made) => {
    setActiveFolder(null);
    setSelectedPersonKey(null);
    setTab("drafts");
    refreshDrafts();
    if (!made) {
      closeCompose();
      setSelected(null);
    } else if (made.kind === "thread") {
      closeCompose();
      setSelected({ account: made.account, threadId: made.threadId, inPeople: false });
    } else {
      setSelected(null);
      startCompose({ to: made.to, subject: made.subject, continuedFromLabel: "", draftKey: made.key });
    }
  });
  const { pendingForward, forwardStarted } = useWindowRequests({
    setComposing,
    setSelectedPersonKey,
    setSelected,
    startCompose,
    editAsNewMessageRef,
  });
  return { editAsNewFromSource, editAsNewMessage, forwardStarted, pendingForward };
}

export function useDraftBadges() {
  const draftKeys = useThreadDraftKeys();
  return { draftKeys };
}

export function usePageComposeSlice({
  autoReply,
  autoReplyAccount,
  autoReplyOpen,
  backFromAutoReply,
  closeAutoReply,
  closeCompose,
  composeSeed,
  composing,
  draftKeys,
  drafts,
  draftsAccount,
  draftsLoading,
  draftsView,
  editAsNewFromSource,
  floatingCompose,
  floatingReply,
  forwardStarted,
  macAskTrigger,
  openAutoReply,
  pendingForward,
  phoneDockedDraft,
  refreshDrafts,
  setFloatingCompose,
  setFloatingReply,
  setPhoneDockedDraft,
  startCompose,
  storeAutoReply,
}: Pick<ReturnType<typeof useDraftsList>, "drafts" | "draftsLoading" | "refreshDrafts"> &
  Pick<ReturnType<typeof useDraftsView>, "draftsAccount" | "draftsView"> &
  Pick<ReturnType<typeof useAutoReplyPart>, "autoReply" | "autoReplyAccount" | "autoReplyOpen" | "backFromAutoReply" | "closeAutoReply" | "openAutoReply" | "storeAutoReply"> &
  Pick<ReturnType<typeof useComposeState>, "closeCompose" | "composeSeed" | "composing" | "floatingCompose" | "floatingReply" | "phoneDockedDraft" | "setFloatingCompose" | "setFloatingReply" | "setPhoneDockedDraft"> &
  Pick<ReturnType<typeof useMacContactsOffer>, "macAskTrigger"> &
  Pick<ReturnType<typeof useComposeStart>, "startCompose"> &
  Pick<ReturnType<typeof useComposeRequests>, "editAsNewFromSource" | "forwardStarted" | "pendingForward"> &
  Pick<ReturnType<typeof useDraftBadges>, "draftKeys">) {
  const compose = useMemoObject({
    autoReplyAccount, autoReplyOpen, closeAutoReply, backFromAutoReply, openAutoReply,
    storeAutoReply, closeCompose, composeSeed, composing, draftKeys, drafts, draftsAccount,
    draftsLoading, draftsView, editAsNewFromSource, floatingCompose, floatingReply, forwardStarted,
    macAskTrigger, pendingForward, phoneDockedDraft, refreshDrafts, setFloatingCompose,
    setFloatingReply, setPhoneDockedDraft, startCompose, endAutoReply: autoReply.endAutoReply,
  });
  return compose;
}
