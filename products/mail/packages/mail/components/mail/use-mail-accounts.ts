"use client";

/*
 * The accounts concern of the mail page: which mailboxes there are, in the
 * reader's order, their labels, which of them the list shows, and the
 * controls that hide, pause and answer for each one.
 *
 * Two hooks, because the state and the slice are made at different points
 * of useMailPage:
 *
 * - `useMailAccountsState` holds the mailbox list, its order, its labels and
 *   the mailbox scope. useMailPage calls it before any hook that reads them.
 * - `useAccountsSlice` puts that together with the pause controls
 *   (use-pause-chip), the auto-replies (use-auto-reply) and the hide
 *   controls (use-mailbox-hide) into one memoised object. Those three have
 *   effects, so they stay where useMailPage always called them, and the
 *   slice is made after the last of them.
 *
 * Components read the slice with `usePageAccounts` (mail-page-slices.tsx).
 */

import * as React from "react";

import { accountChipLabels } from "@/lib/mail/account-labels";
import { useMemoObject } from "@/components/mail/use-memo-object";
import { MAIL_ACCOUNT_ORDER_EVENT, moveAccountBefore, readAccountOrder, sortAccountsByOrder, writeAccountOrder } from "@/lib/mail/account-order";
import type { MailboxHideControls } from "@/components/mail/use-mailbox-hide";
import { usePauseChip } from "@/components/mail/use-pause-chip";
import type { useAutoReply } from "@/components/mail/use-auto-reply";
import { useMailConnect } from "@/components/mail/use-mail-connect";
import type { MailPageProps } from "@/components/mail/use-mail-page";
import { MAIL_RECONNECT_REQUEST, type MailReconnectRequest } from "@/lib/mail/toast";
import { mailProviderFor } from "@/lib/mail/use-outlook-accounts";
import { useMailboxHide } from "@/components/mail/use-mailbox-hide";
import type { usePageSetup } from "@/components/mail/use-page-setup";
import type { useActionsCore } from "@/components/mail/use-mail-actions";
import type { useAutoReplyPart } from "@/components/mail/use-mail-compose";

export function useMailAccountsState(accounts: string[]) {
  // Local copy so hide/show in the accounts menu updates chips + list immediately
  // (InstantTabPaint snapshots / router.refresh otherwise lag a full remount).
  const [accountEmails, setAccountEmails] = React.useState(() =>
    sortAccountsByOrder(accounts, readAccountOrder())
  );
  React.useEffect(() => {
    const follow = () =>
      setAccountEmails(sortAccountsByOrder(accounts, readAccountOrder()));
    follow();
    // The settings panel arranges them too, and it is a different tree.
    window.addEventListener(MAIL_ACCOUNT_ORDER_EVENT, follow);
    return () => window.removeEventListener(MAIL_ACCOUNT_ORDER_EVENT, follow);
  }, [accounts]);
  const accountLabels = React.useMemo(
    () => accountChipLabels(accountEmails),
    [accountEmails]
  );
  /**
   * Mailboxes in the list and in search. Empty = all connected accounts.
   * Search always covers every folder on a selected mailbox.
   */
  const [mailboxScopeEmails, setMailboxScopeEmails] = React.useState<string[]>(
    []
  );
  // Drop scope picks that are no longer connected.
  React.useEffect(() => {
    const known = new Set(accountEmails.map((e) => e.toLowerCase()));
    setMailboxScopeEmails((prev) => {
      const next = prev.filter((e) => known.has(e.toLowerCase()));
      return next.length === prev.length ? prev : next;
    });
  }, [accountEmails]);
  const onMailboxVisibilityChange = React.useCallback(
    (email: string, inMailTab: boolean) => {
      const key = email.toLowerCase();
      setAccountEmails((prev) => {
        if (!inMailTab) {
          return prev.filter((e) => e.toLowerCase() !== key);
        }
        if (prev.some((e) => e.toLowerCase() === key)) return prev;
        return [...prev, email];
      });
      if (!inMailTab) {
        setMailboxScopeEmails((prev) =>
          prev.filter((e) => e.toLowerCase() !== key)
        );
      }
    },
    []
  );
  /**
   * Put one mailbox in front of another, from the folder rail.
   *
   * The whole arrangement is written down, not the one move: it is the
   * reader's own order of their mailboxes, and it belongs to them rather than
   * to Gmail or to Outlook — see `@/lib/mail/account-order` for why neither
   * provider can hold it. `before` is null for the end of the list.
   */
  const onReorderAccount = React.useCallback(
    (moved: string, before: string | null) => {
      setAccountEmails((prev) => {
        const next = moveAccountBefore(prev, moved, before);
        writeAccountOrder(next);
        return next;
      });
    },
    []
  );
  return {
    accountEmails,
    setAccountEmails,
    accountLabels,
    mailboxScopeEmails,
    setMailboxScopeEmails,
    onMailboxVisibilityChange,
    onReorderAccount,
  };
}

type PauseChip = ReturnType<typeof usePauseChip>;
type AutoReply = ReturnType<typeof useAutoReply>;
type MailConnect = ReturnType<typeof useMailConnect>;

/** Everything a component needs to know and do about the mailboxes. */
export type MailAccountsSlice = ReturnType<typeof useMailAccountsState> &
  Pick<
    PauseChip,
    | "pauseState"
    | "pauseNow"
    | "pauseMailUntil"
    | "resumeMail"
    | "setMailQuietHours"
    | "setFollowAllHours"
    | "setUnpauseWords"
    | "pauseChip"
    | "noneFetching"
    | "pausedCount"
    | "pausedLabel"
    | "quietUntilByAccount"
    | "resumeFetching"
  > &
  Pick<AutoReply, "autoReplies" | "autoReplyByAccount"> & {
    /** Connect a mailbox, and which provider is being connected (use-mail-connect). */
    connect: MailConnect["connect"];
    connecting: MailConnect["connecting"];
    /** Whether a mailbox is an Outlook one (use-outlook-accounts). */
    isOutlookAccount: (email: string) => boolean;
    /** Hiding mailboxes for a while, and the greyed tabs. */
    hide: MailboxHideControls;
    ownIdentity: MailPageProps["ownIdentity"];
    onOwnIdentityChange: MailPageProps["onOwnIdentityChange"];
  };

export function useAccountsSlice({
  state,
  pause,
  autoReply,
  isOutlookAccount,
  hide,
  ownIdentity,
  onOwnIdentityChange,
  connect,
  connecting,
}: {
  state: ReturnType<typeof useMailAccountsState>;
  pause: PauseChip;
  autoReply: AutoReply;
  isOutlookAccount: (email: string) => boolean;
  hide: MailboxHideControls;
  ownIdentity: MailPageProps["ownIdentity"];
  onOwnIdentityChange: MailPageProps["onOwnIdentityChange"];
  connect: MailConnect["connect"];
  connecting: MailConnect["connecting"];
}): MailAccountsSlice {
  const {
    pauseState,
    pauseNow,
    pauseMailUntil,
    resumeMail,
    setMailQuietHours,
    setFollowAllHours,
    setUnpauseWords,
    pauseChip,
    noneFetching,
    pausedCount,
    pausedLabel,
    quietUntilByAccount,
    resumeFetching,
  } = pause;
  return useMemoObject({
    ...state,
    pauseState,
    pauseNow,
    pauseMailUntil,
    resumeMail,
    setMailQuietHours,
    setFollowAllHours,
    setUnpauseWords,
    pauseChip,
    noneFetching,
    pausedCount,
    pausedLabel,
    quietUntilByAccount,
    resumeFetching,
    autoReplies: autoReply.autoReplies,
    autoReplyByAccount: autoReply.autoReplyByAccount,
    isOutlookAccount,
    connect,
    connecting,
    hide,
    ownIdentity,
    onOwnIdentityChange,
  });
}

export function useAccountsState({
  accounts,
}: Pick<MailPageProps, "accounts">) {
  /*
    The mailboxes, their order and labels, and which the list shows. The
    hook's two effects (follow the order, drop a scope pick that is gone)
    run together here. That is safe: neither reads anything that the
    effects further down set.
  */
  const accountsState = useMailAccountsState(accounts);
  const {
    accountEmails,
    accountLabels,
    mailboxScopeEmails,
    onMailboxVisibilityChange,
  } = accountsState;
  return { accountEmails, accountLabels, accountsState, mailboxScopeEmails, onMailboxVisibilityChange };
}

export function usePausing({
  accountEmails,
  accountLabels,
  t,
}: Pick<ReturnType<typeof usePageSetup>, "t"> &
  Pick<ReturnType<typeof useAccountsState>, "accountEmails" | "accountLabels">) {
  const pause = usePauseChip({ accountEmails, accountLabels, t });
  const {
    pauseState,
    noneFetching,
  } = pause;
  return { noneFetching, pause, pauseState };
}

export function useConnection() {
  // One row per correspondent for the People view.
  const { connecting, connect } = useMailConnect();
  return { connect, connecting };
}

export function useReconnectRequests({
  connect,
  isOutlookAccount,
}: Pick<ReturnType<typeof useActionsCore>, "isOutlookAccount"> &
  Pick<ReturnType<typeof useConnection>, "connect">) {
  // A toast's Reconnect button asks; this is the one place that can answer.
  React.useEffect(() => {
    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent<MailReconnectRequest>).detail;
      if (!detail?.email) return;
      // The provider is known here from the mailbox list; the toast that
      // asked only guessed it from its own words, and a Graph error that
      // never says "Outlook" landed an Outlook address on Google's screen.
      connect(detail.provider === "exchange" ? "exchange" : mailProviderFor(detail.email, isOutlookAccount), detail.email);
    };
    window.addEventListener(MAIL_RECONNECT_REQUEST, onRequest);
    return () => window.removeEventListener(MAIL_RECONNECT_REQUEST, onRequest);
  }, [connect, isOutlookAccount]);
}

export function useHiding({
  accountEmails,
  onMailboxVisibilityChange,
}: Pick<ReturnType<typeof useAccountsState>, "accountEmails" | "onMailboxVisibilityChange">) {
  /*
    Hiding mailboxes for a while. Its clock runs as long as the page does.
    MailPage called this right after this hook, so it is the last call here
    and its effects keep their place.
  */
  const mailboxHide = useMailboxHide({
    visible: accountEmails,
    onVisibilityChange: onMailboxVisibilityChange,
  });
  return { mailboxHide };
}

export function usePageAccountsSlice({
  accountsState,
  autoReply,
  connect,
  connecting,
  isOutlookAccount,
  mailboxHide,
  onOwnIdentityChange,
  ownIdentity,
  pause,
}: Pick<ReturnType<typeof useAccountsState>, "accountsState"> &
  Pick<ReturnType<typeof usePausing>, "pause"> &
  Pick<ReturnType<typeof useAutoReplyPart>, "autoReply"> &
  Pick<ReturnType<typeof useActionsCore>, "isOutlookAccount"> &
  Pick<ReturnType<typeof useConnection>, "connect" | "connecting"> &
  Pick<ReturnType<typeof useHiding>, "mailboxHide"> &
  Pick<MailPageProps, "onOwnIdentityChange" | "ownIdentity">) {
  const accountsSlice = useAccountsSlice({
    state: accountsState,
    pause,
    autoReply,
    isOutlookAccount,
    hide: mailboxHide,
    ownIdentity,
    onOwnIdentityChange,
    connect,
    connecting,
  });
  return accountsSlice;
}
