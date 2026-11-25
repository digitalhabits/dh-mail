"use client";

/**
 * The hours menu while a mailbox is hidden or its new mail is paused
 * (mockup 9b, "Sentence plus quiet rows", Ulrik 2026-11-24).
 *
 * A sentence says what is so and who did it: "New mail paused until 14:30",
 * "By your schedule · Custom hours". Then two rows: end it early ("Get new
 * mail for 15 minutes…", the words first), and make it longer ("Pause for
 * longer", the times in a submenu beside it). Under them, two links: the
 * schedule, and what ending early takes.
 *
 * Before this, the menu showed the times to pause for first. Under hours
 * that paused it already, they only put a pause on top, and a KU tester
 * could not find the way round (2026-11-24).
 */

import * as React from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Eye, EyeOff, Lock, RefreshCw } from "lucide-react";

import type { PauseControls } from "@/components/mail/account-hours-menu";
import { hiddenUntilLabel } from "@/components/mail/hidden-status";
import { hideAgainLabel } from "@/components/mail/pause-panels";
import { formatSnoozeClock, formatSnoozeDayTime, formatSnoozeWakeLabel } from "@/components/mail/SnoozeMenu";
import type { HoursTab } from "@/components/mail/use-hours-answers";
import type { MailboxHideControls } from "@/components/mail/use-mailbox-hide";
import { useMailT } from "@/lib/mail/i18n";
import { scheduleWindowEnd } from "@/lib/mail/mailbox-hide";
import { readPauseOptions } from "@/lib/mail/pause-options";
import {
  FETCH_EARLY_MINUTES,
  accountPauseRow,
  fetchEarlyEnd,
  fetchEarlyWindow,
  mailPauseOptions,
  mailPauseVerdictForAccount,
  unpauseWordsFor,
} from "@/lib/mail/quiet-hours";
import { useMailColorMode } from "@/lib/mail/theme";
import { cn } from "@/lib/utils";

type T = ReturnType<typeof useMailT>;

/** What this view needs from the menu around it. */
export type HoursStatusProps = {
  tab: HoursTab;
  account: string;
  hide: MailboxHideControls;
  pause: PauseControls;
  /** The schedule's name: "Working hours", "Custom hours". */
  scheduleName: string;
  onPickTime: () => void;
  onEditSchedule: () => void;
  onChangeFriction: () => void;
  onDone: () => void;
};

/** Hidden (Shown tab) or paused (New mail tab) now: then the menu is this view. */
export function hoursTabIsOff(tab: HoursTab, account: string, hide: MailboxHideControls, pause: PauseControls): boolean {
  if (tab === "shown") return hide.statusOf(account).hidden;
  return mailPauseVerdictForAccount(pause.state, account, pause.now).paused;
}

/**
 * Shown, or getting new mail, early: the 15 minutes after the words. When
 * it ends, and what the schedule does then. Null when it is not.
 */
export function hoursEarlyWindow(
  tab: HoursTab,
  account: string,
  hide: MailboxHideControls,
  pause: PauseControls
): { endsAt: Date; thenUntil: string | null } | null {
  if (tab === "shown") {
    const early = hide.statusOf(account).shownEarly;
    if (!early) return null;
    const then = early.then.hidden ? (early.then.until ?? early.then.endsAt ?? null) : null;
    return { endsAt: early.endsAt, thenUntil: then ? formatSnoozeWakeLabel(then.toISOString()) : (early.then.hidden ? early.then.untilClock : null) };
  }
  const early = fetchEarlyWindow(pause.state, account, pause.now);
  if (!early) return null;
  const then = early.then.paused ? (early.then.until ?? early.then.endsAt ?? null) : null;
  return { endsAt: early.endsAt, thenUntil: then ? formatSnoozeWakeLabel(then.toISOString()) : (early.then.paused ? early.then.untilClock : null) };
}

/**
 * Whole minutes left until `endsAt`, at least 1. Rounded down: the clock
 * the menu reads moves every 30 seconds, so rounding up said "16 min left"
 * of 15.
 */
export function minutesLeft(endsAt: Date, now: Date): number {
  return Math.max(1, Math.floor((endsAt.getTime() - now.getTime()) / 60_000));
}

/**
 * During the 15 minutes (mockup 10a): "Getting new mail until 10:27",
 * "14 min left · then paused until 14:30", and "Pause now" with no words:
 * going back to the schedule should be easy.
 */
export function HoursEarlyView(props: Omit<HoursStatusProps, "scheduleName" | "onPickTime">) {
  const t = useMailT();
  const { tab, account, hide, pause, onEditSchedule, onChangeFriction, onDone } = props;
  const early = hoursEarlyWindow(tab, account, hide, pause);
  if (!early) return null;
  const hiding = tab === "shown";
  const time = formatSnoozeWakeLabel(early.endsAt.toISOString());
  const left = t("hoursEarlyLeft", { count: minutesLeft(early.endsAt, pause.now) });
  const then = early.thenUntil ? t(hiding ? "hoursEarlyThenHidden" : "hoursEarlyThenPaused", { time: early.thenUntil }) : null;
  const Icon = hiding ? Eye : RefreshCw;
  const link = "text-sm font-medium text-[var(--mail-hours-accent)] hover:underline";
  return (
    <div data-hours-early="">
      <div className="flex gap-3 px-4 pb-3.5 pt-4">
        <Icon className="mt-1 h-5 w-5 shrink-0 text-[var(--mail-hours-accent)]" aria-hidden />
        <div className="min-w-0">
          <p className="font-serif text-xl font-semibold leading-snug text-stone-900">
            {t(hiding ? "hoursEarlyShownUntil" : "hoursEarlyFetchUntil", { time })}
          </p>
          <p className="mt-0.5 text-sm text-stone-500">{then ? `${left} · ${then}` : left}</p>
        </div>
      </div>
      <button
        type="button"
        role="menuitem"
        className="flex w-full items-center gap-3 border-t border-stone-100 px-4 py-2.5 text-left hover:bg-stone-100"
        onClick={() => {
          onDone();
          if (hiding) hide.resumeSchedule(account);
          else pause.endEarly(account);
        }}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] text-stone-900">{t(hiding ? "hoursEarlyHideNow" : "hoursEarlyPauseNow")}</span>
          {early.thenUntil ? (
            <span className="block text-sm text-stone-500">{t("hoursEarlyBackOnSchedule", { time: early.thenUntil })}</span>
          ) : null}
        </span>
      </button>
      <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-stone-100 px-4 py-2.5">
        <button type="button" className={link} onClick={onEditSchedule}>
          {t("hoursStatusEditSchedule")}
        </button>
        <button type="button" className={link} onClick={onChangeFriction}>
          {t(hiding ? "hoursStatusShowEarlyTakes" : "hoursStatusGetEarlyTakes")}
        </button>
      </div>
    </div>
  );
}

export function HoursStatusView(props: HoursStatusProps) {
  const t = useMailT();
  const { tab, onEditSchedule, onChangeFriction } = props;
  const heading = statusHeading(props, t);
  const early = earlyAction(props, t);
  const link = "text-sm font-medium text-[var(--mail-hours-accent)] hover:underline";
  return (
    <div data-hours-status="">
      <div className="flex gap-3 px-4 pb-3.5 pt-4">
        {tab === "shown" ? (
          <EyeOff className="mt-1 h-5 w-5 shrink-0 text-stone-500" aria-hidden />
        ) : (
          <RefreshCw className="mt-1 h-5 w-5 shrink-0 text-stone-500" aria-hidden />
        )}
        <div className="min-w-0">
          <p className="font-serif text-xl font-semibold leading-snug text-stone-900">{heading.title}</p>
          <p className="mt-0.5 text-sm text-stone-500">{heading.by}</p>
        </div>
      </div>
      {early ? <EarlyRow {...early} onDone={props.onDone} /> : null}
      <LongerRow {...props} />
      <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-stone-100 px-4 py-2.5">
        <button type="button" className={link} onClick={onEditSchedule}>
          {t("hoursStatusEditSchedule")}
        </button>
        <button type="button" className={link} onClick={onChangeFriction}>
          {t(tab === "shown" ? "hoursStatusShowEarlyTakes" : "hoursStatusGetEarlyTakes")}
        </button>
      </div>
    </div>
  );
}

/** "Hidden from Mail until 14:30" and "By your schedule · Custom hours". */
export function statusHeading(
  { tab, account, hide, pause, scheduleName }: Pick<HoursStatusProps, "tab" | "account" | "hide" | "pause" | "scheduleName">,
  t: T
): { title: string; by: string } {
  const bySchedule = t("hoursStatusBySchedule", { name: scheduleName });
  if (tab === "fetch") {
    const verdict = mailPauseVerdictForAccount(pause.state, account, pause.now);
    const at = verdict.until ?? verdict.endsAt;
    const time = at ? formatSnoozeWakeLabel(at.toISOString()) : (verdict.untilClock ?? "");
    return { title: t("hoursMenuNewMailPausedUntil", { time }), by: verdict.reason === "pause" ? t("hoursStatusByYou") : bySchedule };
  }
  const status = hide.statusOf(account);
  if (status.byHand && status.reason === "hand" && status.until) {
    return {
      title: t("hoursStatusHiddenUntil", { time: formatSnoozeWakeLabel(status.until.toISOString()) }),
      by: t("hoursStatusByYouThenSchedule"),
    };
  }
  const time = hiddenUntilLabel(status);
  if (status.byHand || !time) return { title: t("hoursStatusHiddenNoEnd"), by: t("hoursStatusByYou") };
  return { title: t("hoursStatusHiddenUntil", { time }), by: status.reason === "until" ? t("hoursStatusByYou") : bySchedule };
}

type Early = { label: string; words: number; run: () => void };

/** The way round: show it for a while, end a pause, or new mail for 15 minutes. */
export function earlyAction(
  { tab, account, hide, pause }: Pick<HoursStatusProps, "tab" | "account" | "hide" | "pause">,
  t: T
): Early | null {
  const now = pause.now;
  if (tab === "shown") {
    const status = hide.statusOf(account);
    const minutes = hide.hideAgainOf(account);
    const ownEnd = status.reason === "until" ? (status.until?.getTime() ?? null) : scheduleWindowEnd(hide.hoursOf(account), now);
    const soon = status.byHand || minutes <= 0 || (ownEnd != null && ownEnd <= now.getTime() + minutes * 60_000);
    return {
      label: soon ? t("hoursStatusShowNow") : t("hoursStatusShowFor", { duration: hideAgainLabel(minutes, t) }),
      words: status.byHand ? 0 : hide.showWordsOf(account),
      run: () => hide.showNow(account),
    };
  }
  const verdict = mailPauseVerdictForAccount(pause.state, account, now);
  const words = unpauseWordsFor(pause.state, account);
  const own = (accountPauseRow(pause.state, account)?.pausedUntil ?? 0) > now.getTime();
  if (verdict.reason === "pause") {
    // All's pause covers this one too: ending it ends All's.
    return { label: t("hoursMenuGetMailNow"), words, run: () => pause.resume(own ? account : null) };
  }
  const soon = verdict.endsAt != null && verdict.endsAt.getTime() <= fetchEarlyEnd(now);
  return {
    label: soon ? t("hoursMenuGetMailNow") : t("hoursMenuGetMailFor", { duration: hideAgainLabel(FETCH_EARLY_MINUTES, t) }),
    words,
    run: () => pause.getEarly(account),
  };
}

function EarlyRow({ label, words, run, onDone }: Early & { onDone: () => void }) {
  const t = useMailT();
  return (
    <button
      type="button"
      role="menuitem"
      className="flex w-full items-center gap-3 border-t border-stone-100 px-4 py-2.5 text-left hover:bg-stone-100"
      onClick={() => {
        onDone();
        run();
      }}
    >
      <span className="min-w-0 flex-1">
        {/* The dots say something follows: the words to type. */}
        <span className="block text-[15px] text-stone-900">{words > 0 ? `${label}…` : label}</span>
        {words > 0 ? <span className="block text-sm text-stone-500">{t("hoursMenuTypeFirst", { count: words })}</span> : null}
      </span>
      {words > 0 ? <Lock className="h-4 w-4 shrink-0 text-stone-400" aria-hidden /> : null}
    </button>
  );
}

/** When it ends now: the time the longer times have to be after. */
function currentEnd({ tab, account, hide, pause }: Pick<HoursStatusProps, "tab" | "account" | "hide" | "pause">): number | null {
  if (tab === "shown") {
    const status = hide.statusOf(account);
    return status.until?.getTime() ?? scheduleWindowEnd(hide.hoursOf(account), pause.now);
  }
  const verdict = mailPauseVerdictForAccount(pause.state, account, pause.now);
  return (verdict.until ?? verdict.endsAt)?.getTime() ?? null;
}

/**
 * "Hide for longer" / "Pause for longer", and its times beside it. Only the
 * times after it ends now: an earlier one would not be longer. When it has
 * no end (hidden until the reader shows it, hours that never let go),
 * nothing is longer, so no row.
 */
function LongerRow(props: HoursStatusProps) {
  const t = useMailT();
  const { tab, account, hide, pause, onPickTime, onDone } = props;
  // The row, once pressed or hovered: the submenu is placed beside it.
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const open = anchor != null;
  const hiding = tab === "shown";
  const end = currentEnd(props);
  if (end == null) return null;
  const times = mailPauseOptions(pause.now, (key) => t(key), formatSnoozeClock, formatSnoozeDayTime, readPauseOptions()).filter(
    (option) => option.until > end
  );
  const pick = (until: number, from: string) => {
    onDone();
    if (hiding) hide.hideUntil(account, until, from);
    else pause.pauseUntil(until, account, from);
  };
  return (
    <>
      <button
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn("flex w-full items-center gap-3 border-t border-stone-100 px-4 py-2.5 text-left hover:bg-stone-100", open && "bg-stone-100")}
        onClick={(event) => {
          const row = event.currentTarget;
          setAnchor((was) => (was ? null : row));
        }}
        onMouseEnter={(event) => setAnchor(event.currentTarget)}
      >
        <span className="min-w-0 flex-1 text-[15px] text-stone-900">{t(hiding ? "hoursStatusHideLonger" : "hoursStatusPauseLonger")}</span>
        <ChevronRight className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />
      </button>
      {anchor ? (
        <LongerFlyout anchor={anchor}>
          {times.map((option) => (
            <FlyoutRow key={option.id} onClick={() => pick(option.until, `menu longer: ${option.id}`)} detail={option.detail}>
              {option.label}
            </FlyoutRow>
          ))}
          {hiding ? (
            <FlyoutRow
              onClick={() => {
                onDone();
                hide.hideByHand(account);
              }}
            >
              {t("hideUntilShown")}
            </FlyoutRow>
          ) : null}
          <div className="my-1 border-t border-stone-100" />
          <FlyoutRow onClick={onPickTime}>{t("hoursStatusPickTime")}</FlyoutRow>
        </LongerFlyout>
      ) : null}
    </>
  );
}

function FlyoutRow({ onClick, detail, children }: { onClick: () => void; detail?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      className="flex w-full items-center justify-between gap-6 px-3.5 py-2 text-left text-[15px] text-stone-900 hover:bg-stone-100"
      onClick={onClick}
    >
      <span>{children}</span>
      {detail ? <span className="text-sm tabular-nums text-stone-500">{detail}</span> : null}
    </button>
  );
}

/**
 * Beside the row, outside the menu: the menu scrolls inside, so a submenu
 * in it would be cut off. PointerMenu counts a press in it as a press in
 * the menu (`data-pointer-menu-flyout`). On the left when there is no room
 * on the right.
 */
function LongerFlyout({ anchor, children }: { anchor: HTMLElement; children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const colorMode = useMailColorMode();
  const [place, setPlace] = React.useState<{ left: number; top: number } | null>(null);
  React.useLayoutEffect(() => {
    const row = anchor.getBoundingClientRect();
    const menu = anchor.closest(".mail-popover")?.getBoundingClientRect() ?? row;
    const width = ref.current?.offsetWidth ?? 240;
    const height = ref.current?.offsetHeight ?? 200;
    const right = menu.right - 8;
    const left = right + width + 8 <= window.innerWidth ? right : Math.max(8, menu.left - width + 8);
    setPlace({ left, top: Math.max(8, Math.min(row.top, window.innerHeight - height - 8)) });
  }, [anchor]);
  return createPortal(
    <div
      ref={ref}
      role="menu"
      data-pointer-menu-flyout=""
      data-theme={colorMode}
      style={place ?? { left: -9999, top: -9999 }}
      className="mail-shell mail-popover fixed z-[71] w-max min-w-[15rem] rounded-surface border border-stone-200 bg-white py-1 shadow-lg"
    >
      {children}
    </div>,
    document.body
  );
}
