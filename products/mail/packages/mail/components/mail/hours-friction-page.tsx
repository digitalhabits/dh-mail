"use client";

/**
 * "To show it early" and "To get new mail early", as pages of the account
 * menu (account-hours-menu.tsx), as in Ulrik's design of 2026-10-20.
 *
 * - One account: what the words are for, in a sentence; how many; and, for
 *   showing it, "Hide again after". Each account can have its own.
 * - All: each account's, a row each, which opens that account's page; then
 *   the same two settings, which apply to every account.
 *
 * While an account is hidden (or paused) with words set, fewer words or a
 * longer "Hide again after" waits for the words, as a looser schedule does.
 */

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { AccountMark } from "@/components/mail/AccountMark";
import { UnlockBox } from "@/components/mail/hours-editor-parts";
import type { PauseControls } from "@/components/mail/account-hours-menu";
import { MenuSelect } from "@/components/mail/menu-select";
import { hideAgainLabel } from "@/components/mail/pause-panels";
import type { MailboxHideControls } from "@/components/mail/use-mailbox-hide";
import type { HoursTab } from "@/components/mail/use-hours-answers";
import { useAccountMarks } from "@/lib/mail/account-mark";
import { formatAccountChipLabel, type AccountChipLabel } from "@/lib/mail/account-labels";
import { useMailT } from "@/lib/mail/i18n";
import { HIDE_AGAIN_OPTIONS } from "@/lib/mail/mailbox-hide";
import { mailPauseVerdictForAccount, unpauseWordsFor } from "@/lib/mail/quiet-hours";
import { MAX_UNPAUSE_WORDS, unpauseMinutes } from "@/lib/mail/unpause-friction";
import { mailProviderFor } from "@/lib/mail/use-outlook-accounts";

/** The two settings of one account, or of every account (null). */
export function useFriction(tab: HoursTab, hide: MailboxHideControls, pause: PauseControls) {
  const t = useMailT();
  const hiding = tab === "shown";
  const words = (email: string | null) =>
    hiding ? (email ? hide.showWordsOf(email) : hide.showWords) : unpauseWordsFor(pause.state, email);
  const again = (email: string | null) => (email ? hide.hideAgainOf(email) : hide.hideAgainMinutes);
  /** "Type 20 words · hidden again after 15 minutes", "Nothing to type". */
  const summary = (email: string | null) => {
    const n = words(email);
    if (n <= 0) return t("hoursMenuNothingToType");
    const parts = [t("hoursMenuTypeWords", { count: n })];
    if (hiding && again(email) > 0) parts.push(t("hoursMenuHiddenAgain", { time: hideAgainLabel(again(email), t) }));
    return parts.join(" · ");
  };
  /** Hidden or paused now, with words: a looser setting waits for them. */
  const locked = (email: string) => {
    if (words(email) <= 0) return false;
    if (hiding) {
      const status = hide.statusOf(email);
      return status.hidden && !status.byHand;
    }
    return mailPauseVerdictForAccount(pause.state, email, pause.now).paused;
  };
  return {
    hiding,
    words,
    again,
    summary,
    locked,
    /** Every account's summary, or "Differs per account" when they differ. */
    summaryOfAll: (accounts: string[]) => {
      const all = new Set(accounts.map(summary));
      return all.size <= 1 ? (all.values().next().value ?? summary(null)) : t("hoursMenuDiffers");
    },
    setWords: (email: string | null, count: number) =>
      hiding ? hide.setShowWordsFor(email, count) : pause.setUnpauseWords(count, email),
    setAgain: (email: string | null, minutes: number) => hide.setHideAgainFor(email, minutes),
  };
}

export function HoursFrictionPage({
  tab,
  account,
  accounts,
  labels,
  isOutlookAccount,
  hide,
  pause,
  onBack,
  onOpenAccount,
}: {
  tab: HoursTab;
  /** One account, or null for every account. */
  account: string | null;
  accounts: string[];
  labels: Map<string, AccountChipLabel>;
  isOutlookAccount: (email: string) => boolean;
  hide: MailboxHideControls;
  pause: PauseControls;
  onBack: () => void;
  onOpenAccount: (email: string) => void;
}) {
  const t = useMailT();
  const marks = useAccountMarks();
  const f = useFriction(tab, hide, pause);
  // Every account: the value they share, or every account's own default.
  const same = (read: (email: string | null) => number) => {
    const values = new Set(accounts.map((email) => read(email)));
    return values.size === 1 ? (values.values().next().value as number) : read(null);
  };
  const words = account ? f.words(account) : same(f.words);
  const again = account ? f.again(account) : same(f.again);
  const locked = account ? f.locked(account) : accounts.some(f.locked);
  /** A looser change, held until the words are typed. */
  const [waiting, setWaiting] = React.useState<(() => void) | null>(null);
  const attempt = (looser: boolean, apply: () => void) => {
    if (locked && looser) setWaiting(() => apply);
    else apply();
  };

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-stone-100 px-4 py-2.5">
        <button
          type="button"
          aria-label={t("back")}
          className="rounded p-0.5 text-stone-500 hover:bg-stone-100 hover:text-stone-800"
          onClick={onBack}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-700">
          {t(f.hiding ? "hoursMenuToShowEarly" : "hoursMenuToGetEarly")}
        </p>
        <span className="min-w-0 flex-1 truncate text-xs text-stone-500">
          {account ? formatAccountChipLabel(account, labels) : t("pauseAllAccounts")}
        </span>
      </div>

      <p className="px-4 pt-3 text-xs leading-relaxed text-stone-600">
        {account ? t(f.hiding ? "frictionShownWhat" : "frictionFetchWhat") : t("frictionAllWhat")}
      </p>

      {account ? null : (
        <div className="border-b border-stone-100 pb-2 pt-1">
          <p className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
            {t("frictionEachAccount")}
          </p>
          <div className="max-h-[13.5rem] overflow-y-auto overscroll-contain">
            {accounts.map((email) => (
              <button
                key={email}
                type="button"
                role="menuitem"
                onClick={() => onOpenAccount(email)}
                className="flex w-full items-center gap-3 px-4 py-1.5 text-left hover:bg-stone-100"
              >
                <AccountMark
                  mark={marks[email.trim().toLowerCase()]}
                  provider={mailProviderFor(email, isOutlookAccount)}
                  className="h-5 w-5"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-stone-900">{formatAccountChipLabel(email, labels)}</span>
                  <span className="block truncate text-xs text-stone-500">{f.summary(email)}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="px-4 py-3">
        <label className="block">
          <span className="flex items-baseline justify-between gap-2 text-sm text-stone-800">
            <span>{t("pauseFrictionHowMany")}</span>
            <span className="text-xs tabular-nums text-teal-700">
              {words ? `${words} · ~${unpauseMinutes(words)} min` : t("pauseFrictionOff")}
            </span>
          </span>
          <input
            type="range"
            min={0}
            max={MAX_UNPAUSE_WORDS}
            step={1}
            value={words}
            onChange={(e) => {
              const next = Number(e.target.value);
              attempt(next < words, () => f.setWords(account, next));
            }}
            className="mt-2 w-full accent-teal-700"
          />
        </label>
        {f.hiding ? (
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-sm text-stone-800">{t("hideAgainAfter")}</span>
            <MenuSelect
              ariaLabel={t("hideAgainAfter")}
              value={again}
              options={HIDE_AGAIN_OPTIONS.map((minutes) => ({ value: minutes, label: hideAgainLabel(minutes, t) }))}
              onChange={(next) => attempt(next === 0 ? again !== 0 : again !== 0 && next > again, () => f.setAgain(account, next))}
              className="shrink-0"
            />
          </div>
        ) : null}
        {waiting ? (
          <UnlockBox
            words={account ? f.words(account) : Math.max(...accounts.map(f.words))}
            onUnlocked={() => {
              waiting();
              setWaiting(null);
            }}
            onCancel={() => setWaiting(null)}
          />
        ) : null}
      </div>
    </div>
  );
}
