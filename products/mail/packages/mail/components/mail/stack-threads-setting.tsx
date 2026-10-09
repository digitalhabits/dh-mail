"use client";

/**
 * Settings > Reading: stack the threads from one sender into one row.
 *
 * It was a pair of buttons in the title bar ("By thread", "By person"). It
 * is one behaviour, not a second view, and most people set it once, so it
 * is a toggle here, on by default (2026-09-29). The preview shows what it
 * does: three threads from one sender fold into one row, and a sender with
 * one thread does not change. The mail in it is invented.
 */

import { useMailViewMode } from "@/components/mail/mail-list-state";
import { SettingsRow, SettingsToggle } from "@/components/mail/settings-ui";
import { useMailT } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";

export function StackThreadsSetting() {
  const t = useMailT();
  const [mode, setMode] = useMailViewMode();
  const on = mode === "people";
  return (
    <div>
      <SettingsRow
        label={t("stackThreads")}
        hint={t("stackThreadsHint")}
        control={
          <SettingsToggle
            checked={on}
            onChange={(next) => setMode(next ? "people" : "threads")}
            label={t("stackThreads")}
          />
        }
      />
      <StackPreview on={on} className="mx-4 mb-3" />
    </div>
  );
}

/** The preview, also on the welcome screen (apps/mail/src/WelcomeScreen.tsx). */
export function StackPreview({ on, className }: { on: boolean; className?: string }) {
  const t = useMailT();
  const sender = t("stackSampleSender");
  const subjects = [t("stackSampleSubject1"), t("stackSampleSubject2"), t("stackSampleSubject3")];
  return (
    <div aria-hidden className={cn("flex gap-4 rounded-lg bg-stone-100 px-3 py-2.5 text-xs", className)}>
      <div className="w-16 shrink-0">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">{t("stackPreview")}</div>
        <div className={cn("mt-0.5 font-medium", on ? "text-teal-700" : "text-stone-500")}>
          {on ? t("stackOn") : t("stackOff")}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {(on ? subjects.slice(0, 1) : subjects).map((subject, i) => (
          <PreviewRow
            key={subject}
            initials="CI"
            name={sender}
            subject={subject}
            count={on && i === 0 ? t("stackThreadCount", { count: 3 }) : null}
          />
        ))}
        <PreviewRow initials="LI" name={t("stackSampleOther")} subject={t("stackSampleOtherSubject")} count={null} />
      </div>
    </div>
  );
}

function PreviewRow({
  initials,
  name,
  subject,
  count,
}: {
  initials: string;
  name: string;
  subject: string;
  count: string | null;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md bg-white px-2 py-1.5">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-50 text-[9px] font-semibold text-teal-800">
        {initials}
      </span>
      <span className="shrink-0 font-semibold text-stone-800">{name}</span>
      {count ? (
        <span className="shrink-0 rounded-full bg-stone-100 px-1.5 text-[10px] font-medium text-stone-600">{count}</span>
      ) : null}
      <span className="min-w-0 truncate text-stone-500">{subject}</span>
    </div>
  );
}
