"use client";

import { Loader2, Sparkles, Square, X } from "lucide-react";

import { useMailT } from "@/lib/mail/i18n";

/** What /api/mail/reply-draft answers, less the body that went into the composer. */
export type AiReplyDraftResult = {
  body: string;
  subject?: string;
  scenario: "cold" | "ongoing" | "resurfacing";
  usedRecords: { source: string; recordId: string; recordName: string }[];
  gaps: string[];
  /**
   * What the reader had already written, which the draft was built from.
   *
   * The notes are consumed by the draft that replaces them, so the strip
   * keeps them and offers them back. A draft written from a brief is still
   * a draft somebody may not want.
   */
  brief?: string;
};

/**
 * The line above the composer during and after an AI draft: what it is
 * drafting from, and afterwards what it did not know.
 *
 * The wait is mostly the model, and a bare spinner says nothing about it.
 * So the strip fills in as the work does — first that the thread is being
 * read, then the records the draft is being built from while the model
 * writes, then the notes on the finished draft.
 *
 * The gaps matter most. Each is a fact the model needed and did not have,
 * with a [bracketed] placeholder in the body where it goes — the reader
 * fills those in or cuts them, and never trusts a guess. Dismiss it once
 * read; it says nothing the draft itself does not carry.
 */
export function AiReplyNotes({
  result,
  working,
  onDismiss,
  onStop,
  onRestoreBrief,
  purpose = "reply",
}: {
  /** What the draft is built from. Null until the match answers. */
  result: AiReplyDraftResult | null;
  /** "reading" until the match answers, "writing" while the model works. */
  working?: "reading" | "writing" | null;
  onDismiss: () => void;
  /** Call off a draft that is still being written. */
  onStop?: () => void;
  /** Put the reader's own notes back in the box, in place of the draft. */
  onRestoreBrief?: (brief: string) => void;
  /** A new message has no thread to read. */
  purpose?: "reply" | "compose";
}) {
  const t = useMailT();
  const scenario = !result
    ? ""
    : result.scenario === "cold"
      ? purpose === "compose"
        ? t("aiComposeScenarioCold")
        : t("aiReplyScenarioCold")
      : result.scenario === "resurfacing"
        ? t("aiReplyScenarioResurfacing")
        : t("aiReplyScenarioOngoing");
  const records = result ? result.usedRecords.map((r) => r.recordName).join(", ") : "";

  // Reading the thread is a second; the model is the wait. Until the match
  // answers there is nothing true to say beyond that it has started.
  /**
   * Call it off.
   *
   * Where the dismiss sits once there is something to dismiss, because it
   * is the same thing at the other end: this strip is the draft, and this
   * is how the reader is done with it.
   */
  const stop =
    working && onStop ? (
      <button
        type="button"
        aria-label={t("aiReplyStop")}
        title={t("aiReplyStop")}
        className="ml-auto inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-medium text-teal-800 hover:bg-teal-100"
        onClick={onStop}
      >
        <Square className="h-3 w-3 fill-current" aria-hidden />
        {t("aiReplyStop")}
      </button>
    ) : null;

  if (working === "reading" || !result) {
    return (
      <div className="mx-3 mb-1.5 rounded-lg border border-teal-200 bg-teal-50/60 px-3 py-2 text-xs text-stone-700">
        <div className="flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-teal-700" />
          <p>{purpose === "compose" ? t("aiComposeReading") : t("aiReplyReading")}</p>
          {stop}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-3 mb-1.5 rounded-lg border border-teal-200 bg-teal-50/60 px-3 py-2 text-xs text-stone-700">
      <div className="flex items-start gap-2">
        {working === "writing" ? (
          <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-teal-700" />
        ) : (
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-700" />
        )}
        <div className="min-w-0 flex-1">
          <p>
            <span className="font-medium">
              {working === "writing" ? t("aiReplyWriting") : t("aiReplyDrafted")}
            </span>{" "}
            · {scenario}
            {records ? (
              <>
                {" "}
                · {t("aiReplyFrom")} {records}
              </>
            ) : null}
          </p>
          {!working && result.brief && onRestoreBrief ? (
            <p className="mt-1">
              {t("aiReplyFromYourNotes")}{" "}
              <button
                type="button"
                className="font-medium text-teal-800 underline-offset-2 hover:underline"
                onClick={() => onRestoreBrief(result.brief!)}
              >
                {t("aiReplyPutNotesBack")}
              </button>
            </p>
          ) : null}
          {!working && result.gaps.length ? (
            <div className="mt-1">
              <p className="font-medium text-stone-800">{t("aiReplyGaps")}</p>
              {/* However many facts it wanted, this strip sits above the
                  composer and every line of it is a line the draft does not
                  get. Past a few it scrolls inside itself. */}
              <ul className="mt-0.5 max-h-24 list-disc space-y-0.5 overflow-y-auto pl-4">
                {result.gaps.map((gap, i) => (
                  <li key={i}>{gap}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        {/* Nothing to dismiss while it is still being written — that end of
            the strip holds Stop until there is. */}
        {working ? (
          stop
        ) : (
          <button
            type="button"
            aria-label={t("dismiss")}
            title={t("dismiss")}
            className="rounded p-0.5 text-stone-500 hover:bg-teal-100 hover:text-stone-800"
            onClick={onDismiss}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
