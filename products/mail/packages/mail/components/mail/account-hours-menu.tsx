"use client";

/**
 * One menu for hiding and pausing, opened from the account tabs: a second
 * press on the chosen tab, or a right-click (Ulrik's design, 2026-10-20).
 *
 * Two tabs at the top name the two schedules, Shown in Mail and New mail
 * arrives. Each has:
 *
 * - Schedule: the week, as a row that opens the same question as when the
 *   mailbox was connected (hours-schedule-page.tsx). On the All tab, a row
 *   an account, and "Use the same hours for all…".
 * - To show it early / To get new mail early: the words to type.
 * - For a while: hide or pause for a time when it is shown or fetching;
 *   show it or get new mail now when it is not.
 *
 * The pause menu that hung off Sync is gone: this is where pausing is now.
 * The words to type are still one setting for every account (hence "The
 * same for all accounts" under them); a setting per account comes next.
 */

import * as React from "react";
import { ChevronRight, Eye, EyeOff, Lock, Pause, RefreshCw } from "lucide-react";

import { AccountMark } from "@/components/mail/AccountMark";
import { HoursSchedulePage } from "@/components/mail/hours-schedule-page";
import { CalendarTimePicker, MenuHeading } from "@/components/mail/date-time-pick";
import { hiddenStatusText, useHoursLine } from "@/components/mail/hidden-status";
import { HoursFrictionPage, useFriction } from "@/components/mail/hours-friction-page";
import { PointerMenu } from "@/components/mail/PointerMenu";
import { formatSnoozeClock, formatSnoozeDayTime, formatSnoozeWakeLabel } from "@/components/mail/SnoozeMenu";
import { hideAgainLabel } from "@/components/mail/pause-panels";
import { useHoursAnswers, type HoursTab } from "@/components/mail/use-hours-answers";
import type { MailboxHideControls } from "@/components/mail/use-mailbox-hide";
import { useAccountMarks } from "@/lib/mail/account-mark";
import { formatAccountChipLabel, type AccountChipLabel } from "@/lib/mail/account-labels";
import { scheduleWindowEnd } from "@/lib/mail/mailbox-hide";
import { useMailT } from "@/lib/mail/i18n";
import { readPauseOptions } from "@/lib/mail/pause-options";
import {
  accountPauseRow,
  mailPauseOptions,
  mailPauseVerdictForAccount,
  quietHoursForAccount,
  unpauseWordsFor,
  type MailPauseState,
  type MailQuietWindow,
} from "@/lib/mail/quiet-hours";
import { mailProviderFor } from "@/lib/mail/use-outlook-accounts";
import { cn } from "@/lib/utils";

/** Pausing, as the page model offers it (use-pause-chip.ts). */
export type PauseControls = {
  state: MailPauseState;
  now: Date;
  pauseUntil: (until: number, account?: string | null) => void;
  /** Asks for the words first, when there are any. */
  resume: (account?: string | null) => void;
  setQuietHours: (windows: MailQuietWindow[], account?: string | null) => void;
  setFollowAllHours: (account: string, follow: boolean) => void;
  /** With an account, its own; without, every account's. */
  setUnpauseWords: (count: number, account?: string | null) => void;
};

type Page =
  | { kind: "main" }
  | { kind: "schedule"; account: string | null }
  /** One account's words, or every account's (null). */
  | { kind: "friction"; account: string | null }
  | { kind: "until" };

export function AccountHoursMenu({
  account,
  accounts,
  labels,
  isOutlookAccount,
  x,
  y,
  hide,
  pause,
  onDismiss,
}: {
  /** The account whose tab was pressed, or null for All. */
  account: string | null;
  /** Every account, the hidden ones too. */
  accounts: string[];
  labels: Map<string, AccountChipLabel>;
  isOutlookAccount: (email: string) => boolean;
  x: number;
  y: number;
  hide: MailboxHideControls;
  pause: PauseControls;
  onDismiss: () => void;
}) {
  const t = useMailT();
  const [tab, setTab] = React.useState<HoursTab>("shown");
  const [page, setPage] = React.useState<Page>({ kind: "main" });
  const answers = useHoursAnswers({ accounts, labels, hide, pause });
  const who = (email: string | null) => (email ? formatAccountChipLabel(email, labels) : t("pauseAllAccounts"));
  const toMain = () => setPage({ kind: "main" });

  if (page.kind === "schedule") {
    const target = page.account;
    const spec = answers.page(tab, target);
    return (
      <PointerMenu key={`schedule-${tab}`} x={x} y={y} onDismiss={onDismiss} backdrop className="w-[58rem] max-w-[calc(100vw-16px)] py-0">
        <HoursSchedulePage
          hiding={tab === "shown"}
          heading={t(tab === "shown" ? "hoursShownTitle" : "hoursNewMailTitle")}
          who={who(target)}
          question={t(
            target
              ? tab === "shown" ? "rhythmShownQuestion" : "rhythmFetchQuestion"
              : tab === "shown" ? "hoursMenuAllShownQuestion" : "hoursMenuAllFetchQuestion"
          )}
          lead={t(
            target
              ? tab === "shown" ? "hoursMenuShownLead" : "hoursMenuFetchLead"
              : tab === "shown" ? "hoursMenuAllShownLead" : "hoursMenuAllFetchLead"
          )}
          previewHint={t(tab === "shown" ? "rhythmShownPreviewHint" : "rhythmFetchPreviewHint")}
          answers={spec.answers}
          kept={spec.kept}
          current={spec.current}
          shown={spec.shown}
          lock={spec.lock}
          onBack={toMain}
          onSave={(save) => {
            spec.save(save);
            toMain();
          }}
        />
      </PointerMenu>
    );
  }

  if (page.kind === "friction") {
    return (
      <PointerMenu key={`friction-${page.account ?? "all"}`} x={x} y={y} onDismiss={onDismiss} backdrop className="w-[24rem] max-w-[calc(100vw-16px)] py-0">
        <HoursFrictionPage
          tab={tab}
          account={page.account}
          accounts={accounts}
          labels={labels}
          isOutlookAccount={isOutlookAccount}
          hide={hide}
          pause={pause}
          // From an account's row on All's page, back is All's page.
          onBack={() => (page.account && !account ? setPage({ kind: "friction", account: null }) : toMain())}
          onOpenAccount={(email) => setPage({ kind: "friction", account: email })}
        />
      </PointerMenu>
    );
  }

  if (page.kind === "until") {
    return (
      <PointerMenu key="until" x={x} y={y} onDismiss={onDismiss} backdrop className="w-[34rem] max-w-[calc(100vw-16px)]">
        <UntilTimePage
          tab={tab}
          onBack={toMain}
          onPick={(until) => {
            onDismiss();
            if (tab === "shown") for (const email of account ? [account] : accounts) hide.hideUntil(email, until);
            else pause.pauseUntil(until, account);
          }}
        />
      </PointerMenu>
    );
  }

  return (
    <PointerMenu key="main" x={x} y={y} onDismiss={onDismiss} backdrop className="w-[24rem] max-w-[calc(100vw-16px)] py-0">
      <ScheduleTabs tab={tab} onTab={setTab} />
      <Section title={forAWhileTitle(tab, account, hide, pause, t)}>
        <ForAWhile
          tab={tab}
          account={account}
          accounts={accounts}
          hide={hide}
          pause={pause}
          onPickTime={() => setPage({ kind: "until" })}
          onDone={onDismiss}
        />
      </Section>
      {/* The words to type, between the times and the schedule: they guard
          both (Ulrik, 2026-10-21). */}
      <div className="border-t border-stone-100 py-1">
        <EarlyRow
          tab={tab}
          account={account}
          accounts={accounts}
          hide={hide}
          pause={pause}
          onOpen={() => setPage({ kind: "friction", account })}
        />
      </div>
      {/* The schedule under the times (Ulrik, 2026-10-21): what is done now
          first, the standing week below it. */}
      <Section
        divided
        title={t("hoursMenuSchedule")}
        action={
          account
            ? undefined
            : { label: t("hoursMenuSameHoursLink"), onClick: () => setPage({ kind: "schedule", account: null }) }
        }
      >
        {account ? (
          <ScheduleRow tab={tab} email={account} hide={hide} pause={pause} name={answers.currentName(tab, account)} onOpen={() => setPage({ kind: "schedule", account })} />
        ) : (
          // About four and a half rows, then it scrolls: the half row says
          // there is more.
          <div className="max-h-[13.5rem] overflow-y-auto overscroll-contain">
            {accounts.map((email) => (
              <ScheduleRow
                key={email}
                tab={tab}
                email={email}
                hide={hide}
                pause={pause}
                name={who(email)}
                mark={{ isOutlook: isOutlookAccount(email) }}
                onOpen={() => setPage({ kind: "schedule", account: email })}
              />
            ))}
          </div>
        )}
      </Section>
    </PointerMenu>
  );
}

/**
 * What the section under the schedule does: "Hide for a while" while the
 * account (or every account) is shown; "Show for a while" while it is
 * hidden. New mail's: "Pause for a while", or "Get new mail" while a pause
 * of the reader's own runs.
 */
function forAWhileTitle(
  tab: HoursTab,
  account: string | null,
  hide: MailboxHideControls,
  pause: PauseControls,
  t: ReturnType<typeof useMailT>
): string {
  if (tab === "shown") return t(account && hide.statusOf(account).hidden ? "hoursMenuShowForAWhile" : "hoursMenuHideForAWhile");
  const own = account ? accountPauseRow(pause.state, account)?.pausedUntil : pause.state.pausedUntil;
  return t(own && own > pause.now.getTime() ? "hoursMenuGetMailTitle" : "hoursMenuPauseForAWhile");
}

/** Shown in Mail | New mail arrives. */
function ScheduleTabs({ tab, onTab }: { tab: HoursTab; onTab: (tab: HoursTab) => void }) {
  const t = useMailT();
  const option = (id: HoursTab, icon: React.ReactNode, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => onTab(id)}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-control px-3 py-1.5 text-sm transition-colors",
        tab === id
          ? "bg-[var(--mail-segment-active)] font-semibold text-[var(--mail-segment-active-fg)] shadow-sm"
          : "text-[var(--mail-segment-fg)] hover:text-[var(--mail-segment-active-fg)]"
      )}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <div className="p-2 pb-0">
      <div role="tablist" className="flex gap-1 rounded-surface bg-[var(--mail-segment-track,rgba(0,0,0,0.05))] p-1">
        {option("shown", <Eye className="h-3.5 w-3.5" aria-hidden />, t("hoursShownTitle"))}
        {option("fetch", <RefreshCw className="h-3.5 w-3.5" aria-hidden />, t("hoursNewMailTitle"))}
      </div>
    </div>
  );
}

function Section({
  title,
  action,
  divided = false,
  children,
}: {
  title: string;
  /** A link at the right of the heading: "Same hours for all…". */
  action?: { label: string; onClick: () => void };
  divided?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("py-1", divided && "border-t border-stone-100")}>
      <div className="flex items-baseline justify-between gap-3 px-3.5 pb-0.5 pt-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">{title}</p>
        {action ? (
          <button
            type="button"
            className="text-xs font-semibold text-[var(--mail-hours-accent)] hover:underline"
            onClick={action.onClick}
          >
            {action.label}
          </button>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function MenuRow({
  icon,
  title,
  detail,
  locked = false,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  detail?: React.ReactNode;
  locked?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-3.5 py-1.5 text-left hover:bg-stone-100"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-stone-100 text-stone-500">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-stone-900">{title}</span>
        {detail ? <span className="flex min-w-0 items-center gap-1 text-xs text-stone-500">{detail}</span> : null}
      </span>
      {locked ? <Lock className="h-3.5 w-3.5 shrink-0 text-stone-400" aria-hidden /> : null}
      <ChevronRight className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />
    </button>
  );
}

/**
 * An account's schedule: its name (or, on its own menu, its answer) and its
 * hours, with a closed eye (or a pause) in front while it is hidden (or
 * paused) now. Not "Shown now" or "Shown again at …": the eye says it, and
 * the hours say the rest (Ulrik, 2026-10-20).
 */
function ScheduleRow({
  tab,
  email,
  hide,
  pause,
  name,
  mark,
  onOpen,
}: {
  tab: HoursTab;
  email: string;
  hide: MailboxHideControls;
  pause: PauseControls;
  name: string;
  /** On the All tab: the account's mark in place of the state's icon. */
  mark?: { isOutlook: boolean };
  onOpen: () => void;
}) {
  const t = useMailT();
  const marks = useAccountMarks();
  const line = useHoursLine();
  const hiding = tab === "shown";
  const status = hide.statusOf(email);
  const verdict = mailPauseVerdictForAccount(pause.state, email, pause.now);
  const off = hiding ? status.hidden : verdict.paused;
  const offIcon = hiding ? <EyeOff className="h-4 w-4" aria-hidden /> : <Pause className="h-4 w-4" aria-hidden />;
  const onIcon = hiding ? <Eye className="h-4 w-4" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />;
  const words = hiding ? hide.showWordsOf(email) : unpauseWordsFor(pause.state, email);
  const hours = line(hiding ? hide.hoursOf(email) : quietHoursForAccount(pause.state, email));
  const title = off ? (hiding ? hiddenStatusText(status, t) : t("hoursMenuPausedUntil", { time: pausedUntil(verdict) })) : undefined;
  return (
    <MenuRow
      icon={
        mark ? (
          <AccountMark
            mark={marks[email.trim().toLowerCase()]}
            provider={mailProviderFor(email, () => mark.isOutlook)}
            className="h-5 w-5"
          />
        ) : off ? (
          offIcon
        ) : (
          onIcon
        )
      }
      title={name}
      detail={
        <>
          {mark && off ? (
            <span className="shrink-0 text-stone-700" title={title}>
              {hiding ? <EyeOff className="h-3.5 w-3.5" aria-label={title} /> : <Pause className="h-3.5 w-3.5" aria-label={title} />}
            </span>
          ) : null}
          <span className="truncate" title={title}>{hours}</span>
        </>
      }
      locked={off && words > 0 && !(hiding && status.byHand)}
      onClick={onOpen}
    />
  );
}

function pausedUntil(verdict: ReturnType<typeof mailPauseVerdictForAccount>): string {
  if (verdict.until) return formatSnoozeWakeLabel(verdict.until.toISOString());
  if (verdict.endsAt) return formatSnoozeWakeLabel(verdict.endsAt.toISOString());
  return verdict.untilClock ?? "";
}

/** The words to type to go round the hours: this account's, or every account's. */
function EarlyRow({
  tab,
  account,
  accounts,
  hide,
  pause,
  onOpen,
}: {
  tab: HoursTab;
  account: string | null;
  accounts: string[];
  hide: MailboxHideControls;
  pause: PauseControls;
  onOpen: () => void;
}) {
  const t = useMailT();
  const f = useFriction(tab, hide, pause);
  const any = account ? f.words(account) > 0 : accounts.some((email) => f.words(email) > 0);
  return (
    <MenuRow
      icon={<Lock className={cn("h-4 w-4", any && "text-[var(--mail-hours-accent)]")} aria-hidden />}
      title={t(f.hiding ? "hoursMenuToShowEarly" : "hoursMenuToGetEarly")}
      detail={<span className="truncate">{account ? f.summary(account) : f.summaryOfAll(accounts)}</span>}
      onClick={onOpen}
    />
  );
}

/**
 * For a while: hide or pause for a time while it is shown or fetching;
 * show it, or get new mail, now while it is not.
 */
function ForAWhile({
  tab,
  account,
  accounts,
  hide,
  pause,
  onPickTime,
  onDone,
}: {
  tab: HoursTab;
  account: string | null;
  accounts: string[];
  hide: MailboxHideControls;
  pause: PauseControls;
  onPickTime: () => void;
  onDone: () => void;
}) {
  const t = useMailT();
  const options = React.useMemo(
    () => mailPauseOptions(new Date(), (key) => t(key), formatSnoozeClock, formatSnoozeDayTime, readPauseOptions()),
    [t]
  );
  const targets = account ? [account] : accounts;
  const act = (fn: () => void) => () => {
    onDone();
    fn();
  };
  const row = "flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left text-sm text-stone-900 hover:bg-stone-100";
  const timeRows = (onPick: (until: number) => void, byHand?: () => void) => (
    <>
      {options.map((option) => (
        <button key={option.id} type="button" role="menuitem" className={row} onClick={act(() => onPick(option.until))}>
          <span>{option.label}</span>
          <span className="text-xs tabular-nums text-stone-500">{option.detail}</span>
        </button>
      ))}
      {byHand ? (
        <button type="button" role="menuitem" className={row} onClick={act(byHand)}>
          <span>{t("hideUntilShown")}</span>
        </button>
      ) : null}
      <button type="button" role="menuitem" className={cn(row, "border-t border-stone-100")} onClick={onPickTime}>
        <span>{t("pauseUntilTime")}</span>
        <span className="flex items-center gap-0.5 text-xs text-stone-500">
          {t("hoursMenuPick")}
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </span>
      </button>
    </>
  );

  if (tab === "shown") {
    if (account) {
      const status = hide.statusOf(account);
      if (status.hidden) return <ShowEarly email={account} hide={hide} onDone={onDone} />;
      if (status.shownEarlyUntil) {
        return (
          <>
            <button type="button" role="menuitem" className={row} onClick={act(() => hide.resumeSchedule(account))}>
              <span>{t("resumeMailboxSchedule", { time: status.shownEarlyUntil })}</span>
            </button>
            {timeRows((until) => hide.hideUntil(account, until), () => hide.hideByHand(account))}
          </>
        );
      }
    }
    return timeRows(
      (until) => targets.forEach((email) => hide.hideUntil(email, until)),
      () => targets.forEach((email) => hide.hideByHand(email))
    );
  }

  // New mail: a pause the reader set can be ended; hours cannot, yet.
  const own = account ? accountPauseRow(pause.state, account)?.pausedUntil : pause.state.pausedUntil;
  if (own && own > pause.now.getTime()) {
    const words = unpauseWordsFor(pause.state, account);
    return (
      <button type="button" role="menuitem" className={row} onClick={act(() => pause.resume(account))}>
        <span className="min-w-0">
          <span className="block">{t("hoursMenuGetMailNow")}</span>
          {words > 0 ? <span className="block text-xs text-stone-500">{t("hoursMenuTypeFirst", { count: words })}</span> : null}
        </span>
      </button>
    );
  }
  const verdict = account ? mailPauseVerdictForAccount(pause.state, account, pause.now) : null;
  return (
    <>
      {verdict?.paused && verdict.untilClock ? (
        <p className="px-3.5 pb-1 text-xs text-stone-500">{t("hoursMenuArrivesAgain", { time: verdict.untilClock })}</p>
      ) : null}
      {timeRows((until) => pause.pauseUntil(until, account))}
    </>
  );
}

/** "Show in Mail for 15 minutes", and the words first when there are any. */
function ShowEarly({ email, hide, onDone }: { email: string; hide: MailboxHideControls; onDone: () => void }) {
  const t = useMailT();
  const status = hide.statusOf(email);
  const minutes = hide.hideAgainOf(email);
  const now = new Date();
  const ownEnd = status.reason === "until" ? (status.until?.getTime() ?? null) : scheduleWindowEnd(hide.hoursOf(email), now);
  const label =
    status.byHand || minutes <= 0 || (ownEnd != null && ownEnd <= now.getTime() + minutes * 60_000)
      ? t("showMailboxNow")
      : t("showMailboxFor", { duration: hideAgainLabel(minutes, t) });
  const words = !status.byHand ? hide.showWordsOf(email) : 0;
  return (
    <button
      type="button"
      role="menuitem"
      className="flex w-full items-center gap-3 px-3.5 py-2 text-left text-sm text-stone-900 hover:bg-stone-100"
      onClick={() => {
        onDone();
        hide.showNow(email);
      }}
    >
      <span className="min-w-0">
        <span className="block">{label}</span>
        {words > 0 ? (
          <span className="flex items-center gap-1 text-xs text-stone-500">
            <Lock className="h-3 w-3" aria-hidden />
            {t("hoursMenuTypeFirst", { count: words })}
          </span>
        ) : null}
      </span>
    </button>
  );
}

/**
 * Until a time…: Mail's own picker, the month and the clock side by side, as
 * in Send later and Snooze. Not the system's date field, which looked like
 * nothing else in Mail (Ulrik, 2026-10-21).
 */
function UntilTimePage({ tab, onBack, onPick }: { tab: HoursTab; onBack: () => void; onPick: (until: number) => void }) {
  const t = useMailT();
  const [initial] = React.useState(() => new Date(Date.now() + 60 * 60_000));
  return (
    <div className="p-1">
      <MenuHeading onBack={onBack}>{t("pauseUntilTime")}</MenuHeading>
      <CalendarTimePicker
        wide
        initial={initial}
        action={() => t(tab === "shown" ? "hoursMenuHideUntilThen" : "pauseUntilThen")}
        onPick={(at) => onPick(at.getTime())}
      />
    </div>
  );
}
