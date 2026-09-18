"use client";

import * as React from "react";
import { Loader2, Mic, MicOff, Sparkles, Square } from "lucide-react";

import { useSpeechDictation } from "@/components/mail/use-speech-dictation";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { MailPopoverContent } from "@/components/mail/MailPopoverContent";
import { useMailT } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";

/**
 * "AI reply": ask the planner to draft this reply.
 *
 * Nothing is sent here. The menu hands an optional steer to `onDraft`
 * ("say yes to hosting, suggest October"), and the draft comes back into
 * the composer to edit and send. Same shape as AddToCrmMenu: a popover
 * with a note, dictation, one button.
 *
 * Three jobs wear it — a reply, a new message, and the out-of-office
 * auto-reply — and they differ only in what the words say. Anywhere the
 * reader asks the AI for something should look and behave the same: the
 * sparkle, a box to say what they want, and nothing written until they
 * press Draft.
 */

/** What each job calls itself. Keys into the mail strings. */
const WORDS = {
  reply: {
    label: "aiReply",
    title: "aiReplyTitle",
    explainer: "aiReplyExplainer",
    placeholder: "aiReplyHintPlaceholder",
    drafting: "aiReplyDrafting",
  },
  compose: {
    label: "aiCompose",
    title: "aiComposeTitle",
    explainer: "aiComposeExplainer",
    placeholder: "aiComposeHintPlaceholder",
    drafting: "aiReplyDrafting",
  },
  autoreply: {
    label: "aiAutoreply",
    title: "aiAutoreplyTitle",
    explainer: "aiAutoreplyExplainer",
    placeholder: "aiAutoreplyHintPlaceholder",
    drafting: "aiAutoreplyDrafting",
  },
} as const;

export function AiReplyMenu({
  drafting,
  disabled,
  onDraft,
  onStop,
  purpose = "reply",
  variant = "quiet",
  className,
}: {
  /** A draft is in flight. */
  drafting: boolean;
  disabled?: boolean;
  /** Run the draft with this steer for the model. */
  onDraft: (hint: string) => void;
  /** Call off the draft in flight. */
  onStop?: () => void;
  /** A new message and the out-of-office use the same menu, with their
      own words. */
  purpose?: keyof typeof WORDS;
  /**
   * Under the box it is a quiet text link. The pill is the older shape,
   * kept for a call that still wants a button of its own.
   */
  variant?: "quiet" | "pill";
  className?: string;
}) {
  const t = useMailT();
  const words = WORDS[purpose];
  const [open, setOpen] = React.useState(false);
  const [note, setNote] = React.useState("");
  const dictation = useSpeechDictation(note, setNote);

  const submit = () => {
    dictation.stop();
    setOpen(false);
    onDraft(note.trim());
    setNote("");
  };

  /*
    While it writes, the button is the way to stop it.

    It used to go grey and spin, which says "wait" to a reader who has
    changed their mind and can do nothing about it. The press that started
    the draft ends it, and the button says which it will do under the
    pointer — the spinner while it is only reporting, the stop square when
    pressing would stop it.
  */
  if (drafting && onStop) {
    return (
      <button
        type="button"
        onClick={onStop}
        aria-label={t("aiReplyStop")}
        title={t("aiReplyStop")}
        className={cn(
          variant === "quiet"
            ? "group inline-flex items-center gap-1 text-xs text-stone-500 hover:text-stone-800"
            : "group inline-flex items-center gap-1.5 rounded-full border border-stone-200 px-2.5 py-1 text-xs text-stone-700 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-800",
          className
        )}
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin group-hover:hidden" />
        <Square
          className="hidden h-3.5 w-3.5 fill-current group-hover:block"
          aria-hidden
        />
        <span className="group-hover:hidden">{t(words.drafting)}</span>
        <span className="hidden group-hover:inline">{t("aiReplyStop")}</span>
      </button>
    );
  }

  return (
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
          disabled={disabled || drafting}
          aria-label={t(words.label)}
          title={t(words.title)}
          className={cn(
            variant === "quiet"
              ? "inline-flex items-center gap-1 text-xs text-stone-500 hover:text-stone-800 disabled:cursor-not-allowed disabled:opacity-60"
              : "inline-flex items-center gap-1.5 rounded-full border border-stone-200 px-2.5 py-1 text-xs text-stone-700 hover:border-stone-300 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60",
            className
          )}
        >
          {drafting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {drafting ? t(words.drafting) : t(words.label)}
        </button>
      </PopoverTrigger>
      <MailPopoverContent align="end" className="w-80 p-3">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">
          {t(words.label)}
        </p>
        <p className="mt-1 text-xs text-stone-600">{t(words.explainer)}</p>
        <div className="mt-2">
          <textarea
            value={note}
            onChange={(e) => {
              if (dictation.listening) dictation.stop();
              setNote(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={
              dictation.listening ? t("listening") : t(words.placeholder)
            }
            rows={3}
            className={cn(
              "w-full resize-y rounded-lg border bg-stone-50/50 px-2.5 py-2 text-sm outline-none placeholder:text-stone-400 focus:bg-white",
              dictation.listening
                ? "border-teal-400 focus:border-teal-500"
                : "border-stone-200 focus:border-stone-300"
            )}
          />
        </div>
        {/*
          The microphone stands beside the button that uses what it hears,
          not over the words in the box. Inside the box it was drawn on top
          of the placeholder and took a corner of every line the reader
          wrote; out here the box is the reader's, whole, and the row reads
          left to right: speak it, or press Draft.
        */}
        <div className="mt-2 flex items-center gap-2">
          {dictation.supported ? (
            <button
              type="button"
              className={cn(
                "shrink-0 rounded-full p-1.5 transition-colors",
                dictation.listening
                  ? "bg-teal-700 text-white hover:bg-teal-800"
                  : "text-stone-400 hover:bg-stone-100 hover:text-stone-700"
              )}
              aria-label={dictation.listening ? "Stop dictation" : "Dictate"}
              title={dictation.listening ? "Stop dictation" : "Dictate"}
              onClick={() => dictation.toggle()}
            >
              {dictation.listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
          ) : null}
          {dictation.listening ? (
            <span className="text-[11px] text-muted-foreground">
              {t("listening")}
            </span>
          ) : null}
          <Button
            type="button"
            size="sm"
            className="ml-auto shrink-0 rounded-full bg-teal-700 px-4 text-sm text-white hover:bg-teal-800"
            onClick={submit}
          >
            {t("draft")}
          </Button>
        </div>
      </MailPopoverContent>
    </Popover>
  );
}
