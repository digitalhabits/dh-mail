"use client";

/**
 * Stack the threads from one sender into one row: a switch in the title
 * bar, left of the settings button.
 *
 * Stacks change the list more than any setting in Settings > Reading, so
 * the switch is where the list is looked at, as one control. On by default.
 *
 * On, the switch is the slate of a chosen folder (--mail-switch-on), not
 * the accent: "on" here reads as "chosen" in the folder rail.
 */

import { GalleryVerticalEnd } from "lucide-react";

import { useMailViewMode } from "@/components/mail/mail-list-state";
import { takeGlidePlaces } from "@/lib/mail/stack-glide";
import { useMailT } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";

export function StacksSwitch({
  onDark = false,
  openKey = null,
}: {
  onDark?: boolean;
  /** The open thread, kept still on screen as the list changes. */
  openKey?: string | null;
}) {
  const t = useMailT();
  const [mode, setMode] = useMailViewMode();
  const on = mode === "people";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={t("stackThreads")}
      title={t("stackThreads")}
      onClick={() => {
        // Where the rows are now, so they can glide to where they go.
        takeGlidePlaces(
          document.querySelector<HTMLElement>("[data-mail-list-scroller]"),
          !on,
          {
            movedAbove: (count) => t("stackMovedAbove", { count }),
            movedBelow: (count) => t("stackMovedBelow", { count }),
          },
          openKey
        );
        setMode(on ? "threads" : "people");
      }}
      className={cn(
        // Less on the right: the settings button follows, and the switch's
        // own end is edge enough.
        "flex h-7 shrink-0 items-center gap-1.5 rounded-full pl-2.5 pr-1 text-xs font-medium",
        onDark
          ? "text-[var(--mail-chrome-muted)] hover:bg-[var(--mail-chrome-hover)] hover:text-[var(--mail-chrome-fg)]"
          : "text-stone-500 hover:bg-stone-200/70 hover:text-stone-800"
      )}
    >
      <GalleryVerticalEnd className="h-3.5 w-3.5" aria-hidden />
      {t("stacksSwitch")}
      <span
        aria-hidden
        className={cn(
          "relative ml-0.5 block h-4 w-7 shrink-0 rounded-full transition-colors",
          on ? "bg-[var(--mail-switch-on)]" : onDark ? "bg-white/25" : "bg-stone-300"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-[left]",
            on ? "left-3.5" : "left-0.5"
          )}
        />
      </span>
    </button>
  );
}

/** The preview, also on the welcome screen (apps/mail/src/WelcomeScreen.tsx). */
export function StackPreview({ on, className }: { on: boolean; className?: string }) {
  const t = useMailT();
  const sender = t("stackSampleSender");
  const subjects = [t("stackSampleSubject1"), t("stackSampleSubject2"), t("stackSampleSubject3")];
  return (
    <div aria-hidden className={cn("flex gap-4 rounded-control bg-stone-100 px-3 py-2.5 text-xs", className)}>
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
    <div className="flex min-w-0 items-center gap-2 rounded-inner bg-white px-2 py-1.5">
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
