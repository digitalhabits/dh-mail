"use client";

import { useMailT } from "@/lib/mail/i18n";

/**
 * How many conversations a person's row holds, said in words beside the
 * name: "3 threads". A bare number at the end of the line was read as a
 * message count, which is what the same mark means on a thread's row.
 */
export function PersonThreadsBadge({ count }: { count: number }) {
  const t = useMailT();
  if (count <= 1) return null;
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-[var(--mail-chrome-selected)] px-2 py-0.5 text-[11px] font-semibold leading-none text-[var(--mail-chrome-muted)]">
      {t("personThreadsCount", { count })}
    </span>
  );
}
