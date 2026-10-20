"use client";

/**
 * One question about a mailbox's week: "When do you want to see this
 * account in your inbox?" or "When should new mail come in?".
 *
 * The answers on the left: hours to take as they are (Always, Working
 * hours, the hours of All or of another account), and Custom hours…. The
 * week on the right, which can be dragged (hours-week-editor.tsx), and under
 * it, for any answer but the first, the time editor of the menus
 * (hours-rule-cards.tsx).
 *
 * Asked when a mailbox is connected (AccountRhythmDialog.tsx) and from the
 * account menu (account-hours-menu.tsx). The caller keeps the hours and the
 * answer chosen; nothing here is saved.
 */

import { Lock } from "lucide-react";

import { HoursRuleCards } from "@/components/mail/hours-rule-cards";
import { HoursWeekEditor } from "@/components/mail/hours-week-editor";
import { sameWeek } from "@/lib/mail/account-rhythm";
import { useMailT } from "@/lib/mail/i18n";
import type { MailQuietWindow } from "@/lib/mail/quiet-hours";
import { cn } from "@/lib/utils";

export type HoursAnswer = {
  id: string;
  name: string;
  what: string;
  rows: MailQuietWindow[];
  /** "Default", "Current". */
  badge?: string | null;
  /**
   * Hours borrowed from elsewhere (All, another account): chosen only by a
   * press, never because an edit happens to match them.
   */
  borrowed?: boolean;
};

/** The answer some hours are: the first plain answer with the same week, or null. */
export function answerFor(answers: HoursAnswer[], rows: MailQuietWindow[]): string | null {
  return answers.find((answer) => !answer.borrowed && sameWeek(answer.rows, rows))?.id ?? null;
}

export function HoursQuestion({
  question,
  lead,
  answers,
  customWords,
  choice,
  onChoose,
  rows,
  onRows,
  shown,
  previewHint,
  lock,
  editorAlways = false,
}: {
  question: string;
  lead: string;
  /** The first is the one that shows no editor (Always, or All's hours). */
  answers: HoursAnswer[];
  customWords: { name: string; what: string; badge?: string | null };
  /** The answer chosen: an id, or null for Custom hours…. */
  choice: string | null;
  onChoose: (id: string | null, rows: MailQuietWindow[]) => void;
  rows: MailQuietWindow[];
  onRows: (rows: MailQuietWindow[]) => void;
  /** The hours shown, when the question is about new mail. */
  shown?: MailQuietWindow[];
  previewHint: string;
  /** The switch for the words to type before going round these hours. */
  lock?: { on: boolean; set: (on: boolean) => void; title: string; what: string };
  /** Show the editor for every answer, the first too. */
  editorAlways?: boolean;
}) {
  const t = useMailT();
  const first = answers[0]?.id ?? null;
  const editing = editorAlways || choice !== first;
  /** An edit by hand: the answer is read again from the hours. */
  const edit = (next: MailQuietWindow[]) => {
    onRows(next);
    onChoose(answerFor(answers, next), next);
  };

  return (
    <div className="pb-2">
      <h2 className="font-serif text-[1.65rem] font-bold leading-tight text-stone-900">{question}</h2>
      <p className="mt-2 text-sm leading-relaxed text-stone-600">{lead}</p>

      <div className="mt-5 grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div role="radiogroup" aria-label={question} className="flex flex-col gap-2">
          {answers.map((answer) => (
            <AnswerRow
              key={answer.id}
              chosen={choice === answer.id}
              name={answer.name}
              what={answer.what}
              badge={answer.badge ?? null}
              onPick={() => {
                onRows(answer.rows);
                onChoose(answer.id, answer.rows);
              }}
            />
          ))}
          <AnswerRow
            chosen={choice === null}
            name={customWords.name}
            what={customWords.what}
            badge={customWords.badge ?? null}
            onPick={() => onChoose(null, rows)}
          />
          {lock ? <LockRow {...lock} /> : null}
        </div>

        <div className="min-w-0 self-start rounded-xl bg-[var(--mail-hours-card)] p-4">
          <p className="text-xs leading-relaxed text-stone-500">
            <span className="mr-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
              {t("rhythmPreview")}
            </span>
            {previewHint}
          </p>
          <div className="mt-3">
            <HoursWeekEditor rows={rows} onRows={edit} shown={shown} />
          </div>
          {editing ? (
            <HoursRuleCards className="mt-4" rows={rows} onRows={edit} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AnswerRow({
  chosen,
  name,
  what,
  badge,
  onPick,
}: {
  chosen: boolean;
  name: string;
  what: string;
  badge: string | null;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={chosen}
      onClick={onPick}
      className={cn(
        "flex items-center gap-3.5 rounded-xl border px-4 py-3 text-left transition-colors",
        chosen ? "border-teal-600/70 bg-teal-600/10" : "border-stone-200 hover:bg-stone-50"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
          chosen ? "border-teal-600" : "border-stone-300"
        )}
      >
        {chosen ? <span className="h-2.5 w-2.5 rounded-full bg-teal-600" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-stone-900">{name}</span>
          {badge ? <span className="text-xs text-teal-700">{badge}</span> : null}
        </span>
        <span className="block text-xs leading-relaxed text-stone-500">{what}</span>
      </span>
    </button>
  );
}

/** The words to type before going round these hours, as a switch. */
function LockRow({ on, set, title, what }: { on: boolean; set: (on: boolean) => void; title: string; what: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-stone-200 px-4 py-3">
      <Lock className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-stone-900">{title}</span>
        <span className="block text-xs leading-relaxed text-stone-500">{what}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={title}
        onClick={() => set(!on)}
        className={cn(
          "relative block h-5 w-9 shrink-0 rounded-full transition-colors",
          on ? "bg-[var(--mail-switch-on)]" : "bg-stone-300"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-[left]",
            on ? "left-[18px]" : "left-0.5"
          )}
        />
      </button>
    </div>
  );
}
