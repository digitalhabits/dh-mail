"use client";

/**
 * The menu on a mailbox's tab (right-click, or a second press): hiding it
 * from Mail for a while, on a schedule or until shown, and its picture.
 *
 * On a shown mailbox: Hide from Mail…, then the picture. "Hide" opens the
 * times the pause offers (Settings → Snooze & schedule), Until I show it,
 * Until a time…, the schedule, and the friction to show it early. On a
 * hidden (greyed) one: how it is hidden and until when, Show in Mail now
 * (asking for the words when it is hidden by a time and there is friction),
 * its schedule, and the picture. On one shown early inside its schedule:
 * Hide again until the window ends, above Hide from Mail…. See
 * use-mailbox-hide.
 */

import * as React from "react";
import { Check, ChevronLeft, ChevronRight, Eye, EyeOff, Image as ImageIcon, RotateCcw } from "lucide-react";

import { POINTER_MENU_ICON, POINTER_MENU_ITEM, PointerMenu } from "@/components/mail/PointerMenu";
import { formatSnoozeClock, formatSnoozeDayTime } from "@/components/mail/SnoozeMenu";
import { FrictionPanel, QuietHoursPanel, frictionSummary } from "@/components/mail/pause-panels";
import type { MailboxHideControls } from "@/components/mail/use-mailbox-hide";
import { SCHEDULE_DAY_LABELS } from "@/lib/mail/custom-lists";
import { useMailT } from "@/lib/mail/i18n";
import { readPauseOptions } from "@/lib/mail/pause-options";
import type { PauseLock } from "@/lib/mail/pause-lock";
import { mailPauseOptions, quietHoursSummary } from "@/lib/mail/quiet-hours";

type Panel = "main" | "hide" | "schedule" | "friction";

export function MailboxMenu({
  email,
  x,
  y,
  hasOwnMark,
  onChoose,
  onReset,
  hide,
  onDismiss,
}: {
  email: string;
  x: number;
  y: number;
  hasOwnMark: boolean;
  onChoose: () => void;
  onReset: () => void;
  /** Hiding, where the host offers it. */
  hide?: MailboxHideControls;
  onDismiss: () => void;
}) {
  const t = useMailT();
  const [panel, setPanel] = React.useState<Panel>("main");
  /** Where Back from the schedule goes: the panel it was opened from. */
  const [scheduleFrom, setScheduleFrom] = React.useState<Panel>("main");
  const openSchedule = (from: Panel) => {
    setScheduleFrom(from);
    setPanel("schedule");
  };
  const [custom, setCustom] = React.useState("");
  const status = hide?.statusOf(email);
  /*
    While a mailbox is hidden by a time or its schedule, with words set, a
    looser schedule or fewer words asks for the words first, as showing it
    early does. Hidden by hand asks nothing, so it locks nothing.
  */
  const showWords = hide?.showWords ?? 0;
  const lockWhen = (hidden: boolean): PauseLock | undefined =>
    hidden && showWords > 0
      ? { words: showWords }
      : undefined;
  const scheduleLock = lockWhen(Boolean(status?.hidden && !status.byHand));
  const frictionLock = lockWhen(
    Boolean(hide?.hidden.some((other) => !hide.statusOf(other).byHand))
  );
  const options = React.useMemo(
    () => mailPauseOptions(new Date(), (key) => t(key), formatSnoozeClock, formatSnoozeDayTime, readPauseOptions()),
    [t]
  );
  const hours = hide?.hoursOf(email) ?? [];
  const scheduleLine = hours.length ? quietHoursSummary(hours, (k) => t(k), SCHEDULE_DAY_LABELS) : t("quietHoursNone");
  const statusLine = !status?.hidden
    ? null
    : status.byHand
      ? t("hiddenByHand")
      : status.reason === "schedule"
        ? t("hiddenBySchedule", { time: status.untilClock ?? "" })
        : t("hiddenUntilTime", { time: status.until ? formatSnoozeDayTime(status.until) : (status.untilClock ?? "") });
  const done = (act: () => void) => () => {
    onDismiss();
    act();
  };
  const row = "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-stone-800 hover:bg-stone-100";

  const back = (to: Panel, title: React.ReactNode) => (
    <div className="flex items-center gap-1.5 px-3 pb-1 pt-2">
      <button
        type="button"
        aria-label={t("back")}
        className="rounded p-0.5 text-stone-500 hover:bg-stone-100 hover:text-stone-800"
        onClick={() => setPanel(to)}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <p className="min-w-0 break-words text-xs font-medium text-stone-500">{title}</p>
    </div>
  );

  if (panel === "schedule" && hide) {
    return (
      <PointerMenu x={x} y={y} onDismiss={onDismiss} className="w-[22rem] py-0">
        <QuietHoursPanel
          hiding
          title={t("hideScheduleTitle")}
          windows={hours}
          lock={scheduleLock}
          account={null}
          accountLabel={null}
          followAll={false}
          what={t("hideScheduleWhat")}
          onBack={() => setPanel(scheduleFrom)}
          onChange={(windows) => hide.setHours(email, windows)}
          onDone={onDismiss}
        />
      </PointerMenu>
    );
  }
  if (panel === "friction" && hide) {
    return (
      <PointerMenu x={x} y={y} onDismiss={onDismiss} className="w-[22rem] py-0">
        <FrictionPanel
          words={hide.showWords}
          lock={frictionLock}
          onChange={hide.setShowWords}
          onBack={() => setPanel("hide")}
          title={t("hideFrictionTitle")}
          explain={t("hideFrictionExplain")}
        />
      </PointerMenu>
    );
  }
  if (panel === "hide" && hide) {
    const heading = t("hideMailboxHeading", { email: "{email}" });
    const at = heading.indexOf("{email}");
    return (
      <PointerMenu x={x} y={y} onDismiss={onDismiss} className="w-[22rem] pt-0">
        {back(
          "main",
          at < 0 ? (
            heading
          ) : (
            <>
              {heading.slice(0, at)}
              <strong className="font-semibold text-stone-800">{email}</strong>
              {heading.slice(at + "{email}".length)}
            </>
          )
        )}
        {options.map((option) => (
          <button key={option.id} type="button" role="menuitem" className={row} onClick={done(() => hide.hideUntil(email, option.until))}>
            <span>{option.label}</span>
            <span className="text-xs tabular-nums text-stone-500">{option.detail}</span>
          </button>
        ))}
        <button type="button" role="menuitem" className={row} onClick={done(() => hide.hideByHand(email))}>
          <span>{t("hideUntilShown")}</span>
        </button>
        <label className="flex items-center justify-between gap-2 border-t border-stone-100 px-3 py-2 text-sm text-stone-800">
          <span>{t("pauseUntilTime")}</span>
          <input
            type="datetime-local"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            className="h-7 w-[11.5rem] rounded-md border border-stone-300 bg-white px-1.5 text-xs text-stone-900 focus:border-teal-600 focus:outline-none"
          />
        </label>
        {custom ? (
          <button
            type="button"
            className="flex w-full items-center justify-end gap-1.5 px-3 py-1.5 text-xs font-semibold text-teal-700 hover:bg-stone-100"
            onClick={() => {
              const until = new Date(custom).getTime();
              if (!Number.isFinite(until) || until <= Date.now()) return;
              onDismiss();
              hide.hideUntil(email, until);
            }}
          >
            <Check className="h-3.5 w-3.5" />
            {t("pauseUntilThen")}
          </button>
        ) : null}
        <button type="button" className={`${row} border-t border-stone-100`} onClick={() => openSchedule("hide")}>
          <span className="min-w-0">
            <span className="block text-sm text-stone-800">{t("quietHours")}</span>
            <span className="block truncate text-xs text-stone-500">{scheduleLine}</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-stone-400" />
        </button>
        <button type="button" className={`${row} border-t border-stone-100`} onClick={() => setPanel("friction")}>
          <span className="min-w-0">
            <span className="block text-sm text-stone-800">{t("hideFrictionRow")}</span>
            <span className="block truncate text-xs text-stone-500">{frictionSummary(hide.showWords, t)}</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-stone-400" />
        </button>
      </PointerMenu>
    );
  }

  return (
    <PointerMenu x={x} y={y} onDismiss={onDismiss}>
      {hide && status?.hidden ? (
        <>
          {statusLine ? <p className="px-3 pb-1 pt-1 text-xs text-stone-500">{statusLine}</p> : null}
          <button type="button" role="menuitem" autoFocus className={POINTER_MENU_ITEM} onClick={done(() => hide.showNow(email))}>
            <Eye className={POINTER_MENU_ICON} aria-hidden />
            {t("showMailboxNow")}
          </button>
          <button type="button" role="menuitem" className={POINTER_MENU_ITEM} onClick={() => openSchedule("main")}>
            <ChevronRight className={POINTER_MENU_ICON} aria-hidden />
            {t("quietHours")}
          </button>
          <div className="my-1 h-px bg-stone-100" role="separator" />
        </>
      ) : hide ? (
        <>
          {/* Shown early inside its schedule: the schedule is still there,
              and this is the way back to it before its next window. */}
          {status?.shownEarlyUntil ? (
            <>
              <p className="px-3 pb-1 pt-1 text-xs text-stone-500">
                {t("shownEarlyBySchedule", { time: status.shownEarlyUntil })}
              </p>
              <button
                type="button"
                role="menuitem"
                autoFocus
                className={POINTER_MENU_ITEM}
                onClick={done(() => hide.resumeSchedule(email))}
              >
                <EyeOff className={POINTER_MENU_ICON} aria-hidden />
                {t("resumeMailboxSchedule", { time: status.shownEarlyUntil })}
              </button>
            </>
          ) : null}
          {/* One row: hiding, and when the schedule hides it. A row of its
              own for the schedule read as something apart from hiding, and
              left open whether those were hours shown or hidden. */}
          <button type="button" role="menuitem" autoFocus={!status?.shownEarlyUntil} className={POINTER_MENU_ITEM} onClick={() => setPanel("hide")}>
            <EyeOff className={POINTER_MENU_ICON} aria-hidden />
            <span className="min-w-0">
              <span className="block">{t("hideMailboxMenu")}</span>
              {hours.length ? (
                <span className="block truncate text-xs text-stone-500">{t("hiddenOnSchedule", { when: scheduleLine })}</span>
              ) : null}
            </span>
          </button>
          <div className="my-1 h-px bg-stone-100" role="separator" />
        </>
      ) : null}
      <button type="button" role="menuitem" autoFocus={!hide} className={POINTER_MENU_ITEM} onClick={onChoose}>
        <ImageIcon className={POINTER_MENU_ICON} aria-hidden />
        {t("chooseAPicture")}
      </button>
      {hasOwnMark ? (
        <button type="button" role="menuitem" className={POINTER_MENU_ITEM} onClick={onReset}>
          <RotateCcw className={POINTER_MENU_ICON} aria-hidden />
          {t("useProviderMark")}
        </button>
      ) : null}
    </PointerMenu>
  );
}
