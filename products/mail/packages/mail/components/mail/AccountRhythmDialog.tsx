"use client";

/**
 * "How should this account fit your week?" — asked once, right after a
 * mailbox is connected (mailbox-connected.ts).
 *
 * Four named rhythms, one tap each, and hours of one's own for the rest.
 * Each sets both of a mailbox's settings at once: when it is shown in Mail
 * (its hiding schedule) and when new mail is fetched (its own quiet hours).
 * The rules and the turning of "on" into "off" are lib/mail/account-rhythm.
 *
 * Nothing is saved until Done. Shut any other way, the mailbox stays as
 * every new mailbox is: shown, and fetching on All's hours.
 */

import * as React from "react";
import { Check, ChevronLeft, Plus, X } from "lucide-react";

import { FetchTile, ShownTile, WEEK_FILL } from "@/components/mail/hours-icons";
import { DayCircles, quietTimeClass, useOnHoursWords } from "@/components/mail/pause-panels";
import { SettingsDialog, settingsPrimaryButton } from "@/components/mail/settings-ui";
import { setMailboxHiddenHours } from "@/components/mail/use-mailbox-hide";
import { setAccountQuietHours } from "@/components/mail/use-mail-pause";
import {
  RHYTHM_PRESET_ORDER,
  RHYTHM_PRESETS,
  rhythmPreset,
  rhythmSegments,
  rhythmToSettings,
  isAllDay,
  isOvernight,
  type AccountRhythm,
  type RhythmPreset,
} from "@/lib/mail/account-rhythm";
import { SCHEDULE_DAY_LABELS, type MailScheduleDay } from "@/lib/mail/custom-lists";
import { useMailT, type MailStringKey } from "@/lib/mail/i18n";
import { MAILBOX_CONNECTED_EVENT, takeConnectedMailbox } from "@/lib/mail/mailbox-connected";
import type { MailQuietWindow } from "@/lib/mail/quiet-hours";
import { cn } from "@/lib/utils";

const PRESET_WORDS: Record<RhythmPreset, { name: MailStringKey; what: MailStringKey }> = {
  always: { name: "rhythmAlways", what: "rhythmAlwaysWhat" },
  quietWeekends: { name: "rhythmQuietWeekends", what: "rhythmQuietWeekendsWhat" },
  offWeekends: { name: "rhythmOffWeekends", what: "rhythmOffWeekendsWhat" },
  workHours: { name: "rhythmWorkHours", what: "rhythmWorkHoursWhat" },
};


/**
 * The dialog, when a mailbox has just been connected: the address waiting
 * from before the page was there, or the next one announced.
 */
export function ConnectedMailboxRhythm() {
  const [email, setEmail] = React.useState<string | null>(null);
  React.useEffect(() => {
    const waiting = takeConnectedMailbox();
    if (waiting) setEmail(waiting);
    const onConnected = () => {
      const next = takeConnectedMailbox();
      if (next) setEmail(next);
    };
    window.addEventListener(MAILBOX_CONNECTED_EVENT, onConnected);
    return () => window.removeEventListener(MAILBOX_CONNECTED_EVENT, onConnected);
  }, []);
  if (!email) return null;
  return <AccountRhythmDialog email={email} onClose={() => setEmail(null)} />;
}

export function AccountRhythmDialog({ email, onClose }: { email: string; onClose: () => void }) {
  const t = useMailT();
  const [rhythm, setRhythm] = React.useState<AccountRhythm>(RHYTHM_PRESETS.always);
  const [ownHours, setOwnHours] = React.useState(false);
  const preset = ownHours ? null : rhythmPreset(rhythm);

  const done = () => {
    const { hiddenHours, quietHours } = rhythmToSettings(rhythm);
    setMailboxHiddenHours(email, hiddenHours);
    setAccountQuietHours(email, quietHours);
    onClose();
  };

  return (
    <SettingsDialog
      title={t("rhythmTitle")}
      subtitle={
        <span className="flex flex-col gap-2">
          <span className="flex items-center gap-2 text-stone-600">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-teal-700 text-white">
              <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
            </span>
            <span>
              <span className="font-semibold text-stone-800">{email}</span> {t("rhythmIsConnected")}
            </span>
          </span>
          <span>{t("rhythmLead")}</span>
        </span>
      }
      onClose={onClose}
      closeLabel={t("close")}
      width="w-[560px]"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="text-xs text-stone-500">{t("rhythmLater")}</span>
          <button type="button" className={settingsPrimaryButton} onClick={done}>
            {t("done")}
          </button>
        </div>
      }
    >
      <div role="radiogroup" aria-label={t("rhythmTitle")} className="flex flex-col gap-2">
        {RHYTHM_PRESET_ORDER.map((name) => {
          const chosen = preset === name;
          return (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={chosen}
              onClick={() => {
                setOwnHours(false);
                setRhythm(RHYTHM_PRESETS[name]);
              }}
              className={cn(
                "flex items-center gap-4 rounded-xl border px-4 py-3 text-left transition-colors",
                chosen
                  ? "border-teal-600/70 bg-teal-600/10"
                  : "border-stone-200 hover:bg-stone-50"
              )}
            >
              <WeekBars rhythm={RHYTHM_PRESETS[name]} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold text-stone-900">{t(PRESET_WORDS[name].name)}</span>
                  {name === "always" ? <span className="text-xs text-teal-700">{t("rhythmDefault")}</span> : null}
                </span>
                <span className="block text-xs leading-relaxed text-stone-500">{t(PRESET_WORDS[name].what)}</span>
              </span>
              <span
                aria-hidden
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
                  chosen ? "border-teal-600" : "border-stone-300"
                )}
              >
                {chosen ? <span className="h-2.5 w-2.5 rounded-full bg-teal-600" /> : null}
              </span>
            </button>
          );
        })}

        {ownHours ? (
          <OwnHours rhythm={rhythm} onChange={setRhythm} onBack={() => {
            setOwnHours(false);
            if (!rhythmPreset(rhythm)) setRhythm(RHYTHM_PRESETS.always);
          }} />
        ) : (
          <button
            type="button"
            onClick={() => setOwnHours(true)}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-stone-300 px-4 py-2.5 text-sm text-teal-700 hover:bg-stone-50"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t("rhythmOwnHours")}
          </button>
        )}
      </div>
    </SettingsDialog>
  );
}

/** The week as seven small bars, Monday to Sunday, midnight at the top. */
function WeekBars({ rhythm }: { rhythm: AccountRhythm }) {
  const days = rhythmSegments(rhythm);
  return (
    <span aria-hidden className="flex h-11 shrink-0 gap-[3px]">
      {days.map((runs, day) => (
        <span key={day} className="relative h-full w-2 overflow-hidden rounded-[2px]">
          {runs.map((run) => (
            <span
              key={run.from}
              className={cn("absolute inset-x-0", WEEK_FILL[run.state])}
              style={{ top: `${(run.from / 1440) * 100}%`, height: `${((run.to - run.from) / 1440) * 100}%` }}
            />
          ))}
        </span>
      ))}
    </span>
  );
}

function OwnHours({
  rhythm,
  onChange,
  onBack,
}: {
  rhythm: AccountRhythm;
  onChange: (next: AccountRhythm) => void;
  onBack: () => void;
}) {
  const t = useMailT();
  return (
    <div className="rounded-xl border border-teal-600/50 bg-teal-600/5 p-4">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 text-sm font-semibold text-stone-900 hover:text-teal-800"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        {t("rhythmOwnTitle")}
      </button>

      <HoursSection
        icon={<ShownTile className="h-6 w-6" />}
        title={t("rhythmShown")}
        what={t("rhythmShownWhat")}
        windows={rhythm.shown}
        onChange={(shown) => onChange({ ...rhythm, shown })}
      />
      <HoursSection
        icon={<FetchTile className="h-6 w-6" />}
        title={t("rhythmFetching")}
        what={t("rhythmFetchingWhat")}
        windows={rhythm.fetching}
        onChange={(fetching) => onChange({ ...rhythm, fetching })}
      />

      <WeekChart rhythm={rhythm} />
    </div>
  );
}

function HoursSection({
  icon,
  title,
  what,
  windows,
  onChange,
}: {
  icon: React.ReactNode;
  title: string;
  what: string;
  windows: MailQuietWindow[];
  onChange: (next: MailQuietWindow[]) => void;
}) {
  const t = useMailT();
  const words = useOnHoursWords();
  const patch = (index: number, change: Partial<MailQuietWindow>) =>
    onChange(windows.map((window, i) => (i === index ? { ...window, ...change } : window)));
  const toggleDay = (index: number, day: MailScheduleDay) => {
    const days = windows[index].days;
    patch(index, {
      days: days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort((a, b) => a - b),
    });
  };
  return (
    <div className="mt-4">
      <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-600">
        {icon}
        {title}
      </p>
      <p className="mt-1 text-xs text-stone-500">{what}</p>
      <div className="mt-2 flex flex-col gap-2">
        {windows.map((window, index) => (
          <div key={index} className="flex flex-wrap items-center gap-2 rounded-lg bg-stone-50 p-2">
            <DayCircles days={window.days} onToggle={(day) => toggleDay(index, day)} />
            <span className="ml-auto flex items-center gap-1.5">
              <span className="text-xs text-stone-500">
                {isAllDay(window) ? words.allDay : isOvernight(window) ? words.nextDay : ""}
              </span>
              <input
                type="time"
                aria-label={t("rhythmFrom")}
                value={window.start}
                onChange={(e) => patch(index, { start: e.target.value })}
                className={quietTimeClass}
              />
              <span className="text-stone-400">–</span>
              <input
                type="time"
                aria-label={t("rhythmTo")}
                value={window.end}
                onChange={(e) => patch(index, { end: e.target.value })}
                className={quietTimeClass}
              />
              <button
                type="button"
                aria-label={t("rhythmRemoveHours")}
                title={t("rhythmRemoveHours")}
                className="rounded p-0.5 text-stone-400 hover:bg-stone-200/70 hover:text-stone-700"
                onClick={() => onChange(windows.filter((_, i) => i !== index))}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="mt-2 flex items-center gap-1 text-sm text-teal-700 hover:text-teal-800"
        onClick={() => onChange([...windows, { start: "09:00", end: "17:00", days: [0, 1, 2, 3, 4] }])}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        {t("rhythmAddHours")}
      </button>
    </div>
  );
}

/** The week as a chart: one row a day, midnight to midnight, with a key. */
function WeekChart({ rhythm }: { rhythm: AccountRhythm }) {
  const t = useMailT();
  const days = rhythmSegments(rhythm);
  return (
    <div className="mt-5 border-t border-stone-200 pt-4">
      <div className="ml-10 flex justify-between text-[10px] tabular-nums text-stone-400">
        {["00", "06", "12", "18", "24"].map((hour) => (
          <span key={hour}>{hour}</span>
        ))}
      </div>
      <div className="mt-1 flex flex-col gap-1">
        {days.map((runs, day) => (
          <div key={day} className="flex items-center gap-2">
            <span className="w-8 text-xs text-stone-500">{SCHEDULE_DAY_LABELS[day].label}</span>
            <span className="relative h-4 flex-1 overflow-hidden rounded bg-stone-400/10">
              {runs.map((run) => (
                <span
                  key={run.from}
                  className={cn("absolute inset-y-0", WEEK_FILL[run.state])}
                  style={{ left: `${(run.from / 1440) * 100}%`, width: `${((run.to - run.from) / 1440) * 100}%` }}
                />
              ))}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600">
        {(
          [
            ["shown", t("rhythmLegendShown")],
            ["fetching", t("rhythmLegendFetching")],
            ["hidden", t("rhythmLegendHidden")],
          ] as const
        ).map(([state, label]) => (
          <span key={state} className="flex items-center gap-1.5">
            {state === "shown" ? (
              <ShownTile className="h-5 w-5" />
            ) : state === "fetching" ? (
              <FetchTile className="h-5 w-5" />
            ) : (
              <span aria-hidden className={cn("h-5 w-5 rounded-md", WEEK_FILL.hidden)} />
            )}
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
