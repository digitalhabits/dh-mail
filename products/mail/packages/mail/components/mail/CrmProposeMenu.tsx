"use client";

/**
 * Asking the AI what this thread should change in the CRM.
 *
 * A press is the whole of it: the agent reads the thread and drafts, and
 * the proposals are read and picked over in the dialog. Nothing is written
 * here — the Apply there is what writes.
 *
 * The chevron is for a paragraph the thread does not carry: how they were
 * met, what was agreed on a call, why this one matters. Context, whatever
 * the reason for it. It used to offer a set of tables to file a new record
 * in, which answered only one of the reasons somebody has something to add
 * and made the other reasons look unwelcome.
 *
 * Team layer only. A public build has no CRM, so the flavor check hides this
 * and the paths it calls are the ones the standalone deliberately does not
 * answer. See `@/lib/mail/product-flavor`.
 */

import * as React from "react";
import { CalendarPlus, ChevronDown, Loader2, Mic, MicOff, Sparkles } from "lucide-react";

import { THREAD_ACTION_CLASS } from "@/components/mail/thread-actions";
import { useSpeechDictation } from "@/components/mail/use-speech-dictation";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { MailPopoverContent } from "@/components/mail/MailPopoverContent";
import { useMailT } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";

export function CrmProposeMenu({
  busy = false,
  onPropose,
  onProposeDiary,
}: {
  /** A proposal is already in flight. */
  busy?: boolean;
  /**
   * Run the proposal flow. No hint is the plain "what does this thread
   * change?" that the button asks on its own.
   */
  onPropose: (hint?: string) => void;
  /**
   * Read the thread for the reader's own diary instead — flights, stays,
   * bookings. Left out where there is no calendar to write to.
   */
  onProposeDiary?: (hint?: string) => void;
}) {
  const t = useMailT();
  const [open, setOpen] = React.useState(false);
  const [note, setNote] = React.useState("");
  const dictation = useSpeechDictation(note, setNote);

  /*
    One note, two things it can be given to.

    What the reader has to add — "these are the Newcastle flights", "match
    this with Worcester College" — is the same kind of sentence either way,
    so it is asked for once and the two buttons below say what to do with
    it. The plain press on the sparkle is still the CRM update, which is
    what it has always been.
  */
  const run = (to: (hint?: string) => void) => {
    dictation.stop();
    setOpen(false);
    const context = note.trim();
    setNote("");
    to(context || undefined);
  };
  const submit = () => run(onPropose);

  return (
    /*
      Split, the way Send is: the press everybody makes does the thing, and
      the chevron beside it is for the times there is something to add. The
      button asked for three ticks and a note before it would do anything,
      which is a form in front of a one-press job.
    */
    <span className="flex items-center">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={busy}
        aria-label={t(busy ? "askingAi" : "updateCrm")}
        title={t(busy ? "askingAi" : "updateCrm")}
        className={cn(THREAD_ACTION_CLASS, busy && "[&_svg]:animate-spin")}
        onClick={() => onPropose()}
      >
        {busy ? <Loader2 /> : <Sparkles />}
      </Button>
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (!next) dictation.stop();
          setOpen(next);
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={busy}
            aria-label={t("crmProposeSteer")}
            title={t("crmProposeSteer")}
            className="-ml-2 flex h-9 w-5 shrink-0 items-center justify-center rounded-full text-[var(--mail-thread-muted)] hover:text-[var(--mail-thread-fg)] disabled:opacity-50 group-data-[tight]/toolbar:h-8"
          >
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </button>
        </PopoverTrigger>
        <MailPopoverContent align="start" className="w-72 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">
            {t("askTheAi")}
          </p>
          <p className="mt-1 text-xs text-stone-600">
            {onProposeDiary ? t("threadAiExplainer") : t("crmProposeExplainer")}
          </p>
          <div className="relative mt-3">
            <textarea
              value={note}
              onChange={(e) => {
                if (dictation.listening) dictation.stop();
                setNote(e.target.value);
              }}
              placeholder={
                dictation.listening ? t("listening") : t("crmProposeNotePlaceholder")
              }
              /*
                Enter asks, Shift+Enter writes a line.

                This box holds a sentence — "match this with our client entry
                for Worcester College" — and the hand that finishes it is
                already on Enter. Reaching for the button after typing one
                line is the same reach twice.
              */
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.shiftKey) return;
                // A composition is mid-word: Enter is choosing a candidate
                // from the input method, not finishing the sentence.
                if (e.nativeEvent.isComposing) return;
                e.preventDefault();
                submit();
              }}
              rows={3}
              className={cn(
                "w-full resize-y rounded-lg border bg-stone-50/50 py-2 pl-2.5 pr-10 text-sm outline-none placeholder:text-stone-400 focus:bg-white",
                dictation.listening
                  ? "border-teal-400 focus:border-teal-500"
                  : "border-stone-200 focus:border-stone-300"
              )}
            />
            {dictation.supported ? (
              <button
                type="button"
                className={cn(
                  "absolute right-1.5 top-1.5 rounded-full p-1.5 transition-colors",
                  dictation.listening
                    ? "bg-teal-700 text-white hover:bg-teal-800"
                    : "text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                )}
                aria-label={dictation.listening ? "Stop dictation" : "Dictate note"}
                title={dictation.listening ? "Stop dictation" : "Dictate"}
                onClick={() => dictation.toggle()}
              >
                {dictation.listening ? (
                  <MicOff className="h-4 w-4" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
              </button>
            ) : null}
          </div>
          {dictation.listening ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              {t("listening")}
            </p>
          ) : null}
          <div className="mt-3 flex flex-col gap-1.5">
            <Button
              type="button"
              size="sm"
              className="w-full justify-start gap-2 rounded-lg bg-teal-700 px-3 text-sm text-white hover:bg-teal-800"
              onClick={submit}
            >
              <Sparkles className="h-4 w-4 shrink-0" aria-hidden />
              {t("updateCrm")}
            </Button>
            {onProposeDiary ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-full justify-start gap-2 rounded-lg border-stone-200 px-3 text-sm"
                onClick={() => run(onProposeDiary)}
              >
                <CalendarPlus className="h-4 w-4 shrink-0" aria-hidden />
                {t("addToDiary")}
              </Button>
            ) : null}
          </div>
        </MailPopoverContent>
      </Popover>
    </span>
  );
}
