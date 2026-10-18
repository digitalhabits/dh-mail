"use client";

/**
 * Parts of the hours editors (pause-panels.tsx), drawn as in the design of
 * 2026-10-18:
 *
 * - `WeekChart`: the week at a glance, a row a day, the hours on as solid
 *   bars and the hours a change adds hatched.
 * - `LockedChip`: in the heading while a lock is on.
 * - `LockedSaveBar`: at the foot, while a change that adds hours waits —
 *   that it does (not how much: any hour not there before needs the
 *   words), Cancel, and Unlock to save, which asks for the words.
 * - `UnlockBox`: the words to type.
 */

import * as React from "react";
import { Lock } from "lucide-react";

import { ChallengeTyping } from "@/components/mail/UnpauseChallenge";
import { SCHEDULE_DAY_LABELS } from "@/lib/mail/custom-lists";
import { weekRuns } from "@/lib/mail/hours-week";
import { useMailT } from "@/lib/mail/i18n";
import type { MailQuietWindow } from "@/lib/mail/quiet-hours";
import { randomUnpauseWords } from "@/lib/mail/unpause-friction";
import { cn } from "@/lib/utils";

const DAY_MINUTES = 24 * 60;
const HATCH =
  "repeating-linear-gradient(135deg, rgb(69 123 112 / 0.6) 0 2px, rgb(69 123 112 / 0.14) 2px 5px)";

/**
 * `saved` and `draft` as the settings keep them, the hours off. `onLabel`
 * names the solid bars: "Shown", or "New mail".
 */
export function WeekChart({
  saved,
  draft,
  onLabel,
}: {
  saved: MailQuietWindow[];
  draft: MailQuietWindow[];
  onLabel: string;
}) {
  const t = useMailT();
  const days = React.useMemo(() => weekRuns(saved, draft), [saved, draft]);
  const anyAdded = days.some((runs) => runs.some((run) => run.kind === "added"));
  return (
    <div className="mt-2" aria-hidden>
      <div className="grid grid-cols-[1rem_1fr] items-center gap-x-2 gap-y-1">
        {days.map((runs, i) => (
          <React.Fragment key={i}>
            <span className="text-[10px] font-semibold text-stone-400">{SCHEDULE_DAY_LABELS[i].label.slice(0, 1)}</span>
            <span className="relative block h-2.5 overflow-hidden rounded-full bg-[var(--mail-hours-track)]">
              {runs.map((run) => (
                <span
                  key={`${run.from}-${run.kind}`}
                  className={cn("absolute inset-y-0", run.kind === "on" && "bg-[var(--mail-hours-accent)]")}
                  style={{
                    left: `${(run.from / DAY_MINUTES) * 100}%`,
                    width: `${((run.to - run.from) / DAY_MINUTES) * 100}%`,
                    backgroundImage: run.kind === "added" ? HATCH : undefined,
                  }}
                />
              ))}
            </span>
          </React.Fragment>
        ))}
        <span />
        <span className="flex justify-between text-[10px] tabular-nums text-stone-400">
          {["00", "06", "12", "18", "24"].map((hour) => (
            <span key={hour}>{hour}</span>
          ))}
        </span>
      </div>
      {/* A key only when there are two kinds of bar to tell apart. */}
      {anyAdded ? (
        <div className="mt-1.5 flex items-center gap-3 text-[11px] text-stone-500">
          <span className="flex items-center gap-1">
            <span className="h-2 w-3 rounded-sm bg-[var(--mail-hours-accent)]" />
            {onLabel}
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-3 rounded-sm" style={{ backgroundImage: HATCH }} />
            {t("hoursLegendAdded")}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function LockedChip() {
  const t = useMailT();
  return (
    <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-700">
      <Lock className="h-3 w-3" aria-hidden />
      {t("hoursLocked")}
    </span>
  );
}

/**
 * The foot of the editor while a change that adds hours waits. Unlock to
 * save asks for the words; once typed, the change is saved.
 */
export function LockedSaveBar({
  words,
  hiding,
  onCancel,
  onSave,
}: {
  words: number;
  hiding: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const t = useMailT();
  const [asking, setAsking] = React.useState(false);
  if (asking) {
    return (
      <UnlockBox
        words={words}
        confirm={t("unlockSave")}
        onUnlocked={onSave}
        onCancel={() => setAsking(false)}
      />
    );
  }
  return (
    <div className="mt-3 border-t border-stone-100 pt-3">
      <p className="flex items-start gap-1.5 text-xs leading-snug text-stone-700">
        <Lock className="mt-px h-3.5 w-3.5 shrink-0 text-amber-700" aria-hidden />
        {t(hiding ? "hoursMoreShown" : "hoursMoreNewMail")}
      </p>
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          className="rounded-md px-2.5 py-1 text-xs text-stone-600 hover:bg-stone-100"
          onClick={onCancel}
        >
          {t("cancel")}
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md bg-[var(--mail-hours-accent)] px-3 py-1 text-xs font-semibold text-white hover:bg-[var(--mail-hours-accent-hover)]"
          onClick={() => setAsking(true)}
        >
          <Lock className="h-3 w-3" aria-hidden />
          {t("unlockToSave")}
        </button>
      </div>
    </div>
  );
}

export function UnlockBox({
  words,
  confirm,
  onUnlocked,
  onCancel,
}: {
  words: number;
  /** The button's words once they are typed; "Make the change" when not given. */
  confirm?: string;
  onUnlocked: () => void;
  onCancel: () => void;
}) {
  const t = useMailT();
  const [target] = React.useState(() => randomUnpauseWords(words));
  const [typed, setTyped] = React.useState("");
  const done = typed === target;
  return (
    <div className="mt-2 rounded-lg border border-stone-200 bg-white p-2.5">
      <p className="text-xs text-stone-700">{t("pauseLockAsk")}</p>
      <ChallengeTyping
        target={target}
        typed={typed}
        onTyped={setTyped}
        label={t("pauseLockAsk")}
        rows={2}
        onEnter={() => {
          if (done) onUnlocked();
        }}
      />
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          className="rounded-md px-2.5 py-1 text-xs text-stone-500 hover:bg-stone-100"
          onClick={onCancel}
        >
          {t("cancel")}
        </button>
        <button
          type="button"
          disabled={!done}
          className="rounded-md bg-teal-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-50"
          onClick={onUnlocked}
        >
          {confirm ?? t("pauseLockConfirm")}
        </button>
      </div>
    </div>
  );
}

/** A sentence with <b>…</b> in it, the bold parts drawn bold. */
export function RuleText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/<b>(.*?)<\/b>/);
  return (
    <p className={className}>
      {parts.map((part, i) => (i % 2 ? <strong key={i} className="font-semibold text-stone-800">{part}</strong> : part))}
    </p>
  );
}
