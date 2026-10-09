"use client";

import { chatDayLabel } from "@/lib/mail/date-format";
import { useMailT } from "@/lib/mail/i18n";

/**
 * The day, once, over the messages that belong to it.
 *
 * Every message used to carry its own full date. With that line gone, the
 * time in the corner of a bubble says 15:06 and nothing says which 15:06 —
 * so the day is said once, where it changes, the way a chat says it.
 */
export function DayHeading({ iso }: { iso: string | null }) {
  const t = useMailT();
  if (!iso) return null;
  return (
    /* The same small capitals the mail list puts over TODAY and
       YESTERDAY. Both are one day naming the things under it, and they
       were two different marks for that.

       Centred, unlike the list's: over a column of bubbles this is a
       seam across the conversation, where in a list of rows it is a
       heading at the front of them. */
    <p
      /* `first:` — the space above a day is there to part it from the day
         before it, and the one at the top of the thread has no day above
         it, only the subject. The stream's own padding is the space it
         needs. It keeps the padding whenever something does come first,
         such as the button that fetches older messages. */
      className="pb-1 pt-3 text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--mail-chrome-faint)] first:pt-0"
    >
      {chatDayLabel(iso, t)}
    </p>
  );
}

/** Quiet divider when older messages live in an earlier part. */
export function PartSeam({ onView }: { onView?: () => void }) {
  const t = useMailT();
  return (
    <div className="flex items-center gap-3 py-2" role="separator">
      <div className="h-px flex-1 bg-stone-200" />
      <p className="shrink-0 text-[11px] text-stone-400">
        {t("olderInEarlierPart")}
        {onView ? (
          <>
            {" · "}
            <button
              type="button"
              className="font-medium text-teal-700 hover:underline"
              onClick={onView}
            >
              {t("view")}
            </button>
          </>
        ) : null}
      </p>
      <div className="h-px flex-1 bg-stone-200" />
    </div>
  );
}
