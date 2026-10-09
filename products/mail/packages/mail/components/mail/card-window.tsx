"use client";

/**
 * The buttons that put a floating card away, and give it the window.
 *
 * Where each of the three sizes stands is next door, in
 * `@/lib/mail/card-window`, which is plain strings and no React. This is
 * what the reader presses, and the dimmed page behind a card that has been
 * given the whole window.
 */

import * as React from "react";
import { createPortal } from "react-dom";
import { ChevronUp, Expand, Minus, Shrink } from "lucide-react";

import { useMailT } from "@/lib/mail/i18n";
import type { CardWindowView } from "@/lib/mail/card-window";

/**
 * Everything else, dimmed, while the card is the window.
 *
 * And the way back out of it: a press anywhere on the dimmed part is the
 * press that says "not this, the rest" — the same one every dialog answers.
 * The buttons in the heading do it too, for a reader who is not using a
 * mouse.
 */
export function CardWindowBackdrop({
  shown,
  onDismiss,
}: {
  shown: boolean;
  onDismiss: () => void;
}) {
  const [ready, setReady] = React.useState(false);
  // The first render on a page the server sent has no document to put this
  // in. Mounted, there is.
  React.useEffect(() => setReady(true), []);
  if (!shown || !ready || typeof document === "undefined") return null;
  return createPortal(
    <div
      aria-hidden
      className="fixed inset-0 z-40 bg-stone-900/40"
      onClick={onDismiss}
    />,
    document.body
  );
}

/**
 * Put the card away, and give it the window. Nothing else.
 *
 * Drawn by each card's own heading, beside whatever else that heading has —
 * the reply card's way back to its thread, for one — and always to the left
 * of Close, which is the last button in every window there has ever been.
 */
export function CardWindowButtons({
  view,
  onChange,
  className,
}: {
  view: CardWindowView;
  onChange: (next: CardWindowView) => void;
  /** The heading's own button class, so the pair matches its neighbours. */
  className: string;
}) {
  const t = useMailT();
  const minimised = view === "minimised";
  const full = view === "full";
  return (
    <>
      <button
        type="button"
        title={minimised ? t("showTheMessage") : t("minimiseTheMessage")}
        aria-label={minimised ? t("showTheMessage") : t("minimiseTheMessage")}
        className={className}
        onClick={() => onChange(minimised ? "normal" : "minimised")}
      >
        {minimised ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <Minus className="h-4 w-4" />
        )}
      </button>
      <button
        type="button"
        title={full ? t("leaveFullScreen") : t("fullScreen")}
        aria-label={full ? t("leaveFullScreen") : t("fullScreen")}
        className={className}
        onClick={() => onChange(full ? "normal" : "full")}
      >
        {full ? <Shrink className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
      </button>
    </>
  );
}
