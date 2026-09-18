"use client";

import * as React from "react";
import { CalendarPlus, Loader2 } from "lucide-react";
import { toast } from "@/lib/mail/toast";

import {
  SettingsDialog,
  settingsPrimaryButton,
  settingsSecondaryButton,
} from "@/components/mail/settings-ui";
import { currentMailLocale, useMailT } from "@/lib/mail/i18n";
import { mailApiFetch } from "@/lib/mail/api";
import { cn } from "@/lib/utils";

/** One thing the thread fixes to a date and a place. Mirrors the server's DiaryEntry. */
export type DiaryEntry = {
  title: string;
  /** Local time, "YYYY-MM-DDTHH:MM", read on `timeZone`. */
  start: string;
  end: string;
  timeZone?: string;
  location?: string | null;
  description?: string | null;
};

export type DiaryProposal = {
  entries: DiaryEntry[];
  target: {
    accountEmail: string;
    calendarName: string;
    calendars: string[];
    timeZone: string;
  } | null;
};

/** The calendar the reader last sent entries to, so the choice sticks. */
const CALENDAR_KEY = "redd-mail-diary-calendar";

/**
 * When and where, as the reader would read it back.
 *
 * The times are local to the entry, not to this machine — a flight leaving
 * København at 15:55 leaves at 15:55 wherever the reader is reading. So the
 * string is built from the parts as written rather than passed through a
 * Date, which would helpfully shift them.
 */
function whenLabel(entry: DiaryEntry, locale: string | undefined): string {
  const [date = "", from = ""] = entry.start.split("T");
  const [endDate = "", to = ""] = entry.end.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const day = Number.isFinite(y)
    ? new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(locale, {
        weekday: "short",
        day: "numeric",
        month: "short",
      })
    : date;
  return endDate === date
    ? `${day}, ${from}–${to}`
    : `${day}, ${from} → ${endDate}, ${to}`;
}

/**
 * What the AI found, before any of it is written.
 *
 * Everything starts ticked, because the reader asked for this and the common
 * answer is "yes, all of them". Untick what is wrong; nothing is written
 * until Add is pressed, and no entry carries an attendee, so nobody is sent
 * an invitation for the reader's own flight.
 */
export function DiaryEntriesDialog({
  proposal,
  onClose,
}: {
  proposal: DiaryProposal;
  onClose: () => void;
}) {
  const t = useMailT();
  const locale = currentMailLocale();
  const [keep, setKeep] = React.useState<boolean[]>(() =>
    proposal.entries.map(() => true)
  );
  const [calendar, setCalendar] = React.useState<string>(() => {
    const stored = (() => {
      try {
        return localStorage.getItem(CALENDAR_KEY) ?? "";
      } catch {
        return "";
      }
    })();
    const known = proposal.target?.calendars ?? [];
    if (stored && known.includes(stored)) return stored;
    return proposal.target?.calendarName ?? "";
  });
  const [saving, setSaving] = React.useState(false);

  const chosen = proposal.entries.filter((_, i) => keep[i]);
  const writable = Boolean(proposal.target);

  const add = async () => {
    if (!chosen.length) return;
    setSaving(true);
    try {
      const res = await mailApiFetch("/api/mail/diary-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: chosen, calendarName: calendar }),
      });
      const json = (await res.json()) as {
        created?: { title: string }[];
        failed?: { title: string; error: string }[];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || t("couldNotReadDiary"));
      try {
        localStorage.setItem(CALENDAR_KEY, calendar);
      } catch {
        /* private mode */
      }
      const made = json.created?.length ?? 0;
      const failed = json.failed?.length ?? 0;
      if (made) toast.success(t("diaryAdded", { count: made }));
      // Named rather than counted: which one did not go in is the thing the
      // reader has to act on.
      if (failed) {
        toast.error(
          `${t("diarySomeFailed", { count: failed })} — ${json.failed
            ?.map((f) => f.title)
            .join(", ")}`
        );
      }
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("couldNotReadDiary"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsDialog
      title={t("diaryDialogTitle")}
      width="w-[560px]"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className={settingsSecondaryButton}
            onClick={onClose}
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            disabled={!chosen.length || !writable || saving}
            className={cn(settingsPrimaryButton, "inline-flex items-center gap-1.5")}
            onClick={() => void add()}
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                {t("diaryAdding")}
              </>
            ) : (
              <>
                <CalendarPlus className="h-4 w-4" aria-hidden />
                {t("diaryAdd", { count: chosen.length })}
              </>
            )}
          </button>
        </>
      }
    >
      {!proposal.entries.length ? (
        <p className="py-8 text-sm text-muted-foreground">
          {t("diaryNothingFound")}
        </p>
      ) : (
        <div className="space-y-2 py-1">
          {proposal.entries.map((entry, index) => (
            <label
              key={`${entry.title}-${entry.start}`}
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-stone-200 p-3 hover:bg-stone-50"
            >
              <input
                type="checkbox"
                className="mt-0.5 shrink-0"
                checked={keep[index]}
                onChange={(e) =>
                  setKeep((list) =>
                    list.map((on, i) => (i === index ? e.target.checked : on))
                  )
                }
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-stone-900">
                  {entry.title}
                </span>
                <span className="mt-0.5 block text-xs text-stone-500">
                  {whenLabel(entry, locale)}
                  {entry.timeZone ? ` · ${entry.timeZone}` : ""}
                </span>
                {entry.location ? (
                  <span className="mt-0.5 block text-xs text-stone-500">
                    {entry.location}
                  </span>
                ) : null}
                {entry.description ? (
                  <span className="mt-1 block whitespace-pre-wrap text-xs text-stone-400">
                    {entry.description}
                  </span>
                ) : null}
              </span>
            </label>
          ))}

          {writable ? (
            <label className="flex items-center gap-2 pt-1 text-xs text-stone-600">
              <span className="shrink-0 font-medium">
                {t("diaryCalendarLabel")}
              </span>
              <select
                value={calendar}
                onChange={(e) => setCalendar(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs outline-none"
              >
                {(proposal.target?.calendars ?? []).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="pt-1 text-xs text-amber-800">{t("diaryNoCalendar")}</p>
          )}
        </div>
      )}
    </SettingsDialog>
  );
}
