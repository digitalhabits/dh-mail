"use client";

/**
 * A schedule, opened from the account menu (account-hours-menu.tsx): the
 * same question as when the mailbox was connected (hours-question.tsx), as a
 * page of the menu with a way back.
 *
 * The answer standing now carries "Current". Nothing is saved until Done.
 * While the account is locked (hidden or paused, with words set), a change
 * that gives it more time asks for the words first; a change that gives it
 * less is saved at once.
 */

import * as React from "react";
import { ChevronLeft } from "lucide-react";

import { LockedChip, LockedSaveBar } from "@/components/mail/hours-editor-parts";
import { HoursQuestion, type HoursAnswer } from "@/components/mail/hours-question";
import { ALWAYS_RULE, keptFromOnHours, onHoursFromKept, sameWeek } from "@/lib/mail/account-rhythm";
import { useMailT } from "@/lib/mail/i18n";
import { scheduleLoosened, type PauseLock } from "@/lib/mail/pause-lock";
import type { MailQuietWindow } from "@/lib/mail/quiet-hours";

export type ScheduleSave = {
  /** The answer chosen: an id, or null for Custom hours…. */
  choice: string | null;
  /** What the setting keeps: the hours off. */
  kept: MailQuietWindow[];
};

/** The hours on, from what a setting keeps: Always when nothing is kept. */
export function onRowsOf(kept: MailQuietWindow[]): MailQuietWindow[] {
  const on = onHoursFromKept(kept);
  return on.length ? on : [ALWAYS_RULE];
}

export function HoursSchedulePage({
  hiding,
  heading,
  who,
  question,
  lead,
  previewHint,
  answers,
  kept,
  current,
  shown,
  lock,
  onBack,
  onSave,
}: {
  /** About when the account is shown, not when new mail comes in. */
  hiding: boolean;
  /** "Shown in Mail", "New mail arrives". */
  heading: string;
  /** "robin.lane · outlook", "all accounts". */
  who: string;
  question: string;
  lead: string;
  previewHint: string;
  answers: HoursAnswer[];
  /** What the setting keeps now: the hours off. */
  kept: MailQuietWindow[];
  /** The answer standing now, or null for hours of its own. */
  current: string | null;
  /** The hours shown, when the page is about new mail. */
  shown?: MailQuietWindow[];
  lock?: PauseLock;
  onBack: () => void;
  onSave: (save: ScheduleSave) => void;
}) {
  const t = useMailT();
  const [rows, setRows] = React.useState(() => onRowsOf(kept));
  const [choice, setChoice] = React.useState<string | null>(current);
  const [confirming, setConfirming] = React.useState(false);
  const marked = answers.map((answer) => (answer.id === current ? { ...answer, badge: t("hoursMenuCurrent") } : answer));
  const nextKept = keptFromOnHours(rows);
  const changed = choice !== current || !sameWeek(nextKept, kept);
  const loosens = Boolean(lock) && changed && scheduleLoosened(kept, nextKept);
  const save = () => onSave({ choice, kept: nextKept });

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
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-700">{heading}</p>
        <span className="min-w-0 flex-1 truncate text-xs text-stone-500">{who}</span>
        {lock ? <LockedChip /> : null}
      </div>
      <div className="max-h-[min(70vh,44rem)] overflow-y-auto px-5 py-4">
        <HoursQuestion
          question={question}
          lead={lead}
          answers={marked}
          customWords={{
            name: t("rhythmAnswerCustom"),
            what: t("rhythmAnswerCustomWhat"),
            badge: current === null ? t("hoursMenuCurrent") : null,
          }}
          choice={choice}
          onChoose={(id) => {
            setChoice(id);
            setConfirming(false);
          }}
          rows={rows}
          onRows={(next) => {
            setRows(next);
            setConfirming(false);
          }}
          shown={shown}
          previewHint={previewHint}
        />
      </div>
      <div className="border-t border-stone-100 px-5 py-3">
        {loosens && confirming && lock ? (
          <LockedSaveBar words={lock.words} hiding={hiding} onCancel={() => setConfirming(false)} onSave={save} />
        ) : (
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-stone-500">{changed ? t("hoursMenuNotSaved") : t("hoursMenuNoChanges")}</span>
            <button
              type="button"
              className="rounded-control bg-[var(--mail-hours-accent)] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[var(--mail-hours-accent-hover)]"
              onClick={() => {
                if (!changed) onBack();
                else if (loosens) setConfirming(true);
                else save();
              }}
            >
              {t("done")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** An answer's name, for the row that leads to the page: "Working hours", "Same as team". */
export function answerName(answers: HoursAnswer[], id: string | null, custom: string): string {
  return answers.find((answer) => answer.id === id)?.name ?? custom;
}

/** Hours of other accounts, as answers: "Same as team", each week once. */
export function sameAsAnswers(
  sources: { email: string; name: string; kept: MailQuietWindow[] }[],
  taken: HoursAnswer[],
  t: ReturnType<typeof useMailT>,
  summary: (kept: MailQuietWindow[]) => string
): HoursAnswer[] {
  const out: HoursAnswer[] = [];
  for (const source of sources) {
    const rows = onRowsOf(source.kept);
    if ([...taken, ...out].some((answer) => sameWeek(answer.rows, rows))) continue;
    out.push({
      id: `same:${source.email}`,
      name: t("hoursMenuSameAs", { name: source.name }),
      what: summary(source.kept),
      rows,
      borrowed: true,
    });
  }
  return out;
}
