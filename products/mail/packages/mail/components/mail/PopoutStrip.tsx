"use client";

import * as React from "react";
import { MessagesSquare } from "lucide-react";
import { useMailT } from "@/lib/mail/i18n";

/**
 * What stands where the reply box was, while a pop-out has the answer.
 *
 * Popping out carries the half-written reply into the other window and
 * shuts the box here, which is right — but on its own the box simply
 * vanishes and nothing says why. This is what makes the handover legible,
 * and it holds the two ways back: bring that window to the front, or bring
 * the message home.
 */
export function PopoutStrip({
  onShow,
  onBringBack,
}: {
  onShow: () => void;
  onBringBack: () => void;
}) {
  const t = useMailT();
  const ref = React.useRef<HTMLDivElement>(null);

  /**
   * The box that had the focus has gone, so this takes it.
   *
   * Only when it is going spare. A reader who has since clicked somewhere
   * else keeps what they clicked on.
   */
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    el.focus({ preventScroll: true });
  }, []);

  return (
    <div
      ref={ref}
      tabIndex={-1}
      className="flex items-center gap-1.5 border-t border-[var(--mail-thread-chrome-line)] bg-[var(--mail-thread-chrome)] px-8 py-3 text-[13px] text-[var(--mail-thread-muted)] outline-none"
    >
      <MessagesSquare className="h-4 w-4 shrink-0" aria-hidden />
      <span>{t("answeringInPopout")}</span>
      <span aria-hidden className="text-stone-300">
        ·
      </span>
      <button
        type="button"
        className="font-semibold text-teal-700 hover:text-teal-800"
        onClick={onShow}
      >
        {t("show")}
      </button>
      <span aria-hidden className="text-stone-300">
        ·
      </span>
      <button
        type="button"
        className="font-semibold text-teal-700 hover:text-teal-800"
        onClick={onBringBack}
      >
        {t("bringBack")}
      </button>
    </div>
  );
}
