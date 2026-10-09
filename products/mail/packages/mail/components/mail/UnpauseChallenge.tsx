"use client";

/**
 * The words to type before a pause can be ended early.
 *
 * The typing gate of Digital Habits: Blocker's "To stop early", for Mail:
 * the words are shown, the reader types them, and fetching starts again only
 * when they match. What is typed is tidied (no leading space, single spaces),
 * pasting and dropping are refused, the part typed right is marked, and the
 * first wrong letter is shown in red.
 *
 * `requestUnpauseChallenge(count)` asks, and answers true once the words are
 * typed, false when the reader cancels. `UnpauseChallengeHost`, mounted once
 * in MailPage, draws the dialog. With no host mounted (a bug, not a choice)
 * the answer is true: a pause must never become impossible to end.
 */

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { Button } from "@/components/ui/button";
import { useMailT } from "@/lib/mail/i18n";
import {
  correctPrefixLength,
  normaliseUnpauseWords,
  randomUnpauseWords,
  tidyTyped,
} from "@/lib/mail/unpause-friction";

/** The dialog's words: ending a pause early, unless the caller says otherwise. */
export type ChallengeCopy = { title: string; lead: string; confirm: string };

type Ask = (count: number, copy?: ChallengeCopy) => Promise<boolean>;
let host: Ask | null = null;

/** True once the reader has typed `count` random words; false on cancel. */
export function requestUnpauseChallenge(count: number, copy?: ChallengeCopy): Promise<boolean> {
  if (normaliseUnpauseWords(count) === 0) return Promise.resolve(true);
  if (!host) return Promise.resolve(true);
  return host(count, copy);
}

type Pending = { target: string; copy?: ChallengeCopy; resolve: (ok: boolean) => void };

export function UnpauseChallengeHost() {
  const t = useMailT();
  const [pending, setPending] = React.useState<Pending | null>(null);
  const [typed, setTyped] = React.useState("");

  React.useEffect(() => {
    host = (count, copy) =>
      new Promise<boolean>((resolve) => {
        setTyped("");
        setPending((prior) => {
          // A second ask while one is open replaces it; the first is a no.
          prior?.resolve(false);
          return { target: randomUnpauseWords(count), copy, resolve };
        });
      });
    return () => {
      host = null;
    };
  }, []);

  const finish = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
    setTyped("");
  };

  const target = pending?.target ?? "";
  const done = Boolean(target) && typed === target;

  return (
    <DialogPrimitive.Root
      open={pending != null}
      onOpenChange={(open) => {
        if (!open) finish(false);
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[2200] bg-stone-900/30" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-[2201] w-[calc(100%-3rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-stone-200 bg-white p-5 shadow-xl">
          <DialogPrimitive.Title className="text-base font-semibold text-stone-900">
            {pending?.copy?.title ?? t("unpauseTitle")}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-2 text-sm text-stone-600">
            {pending?.copy?.lead ?? t("unpauseLead")}
          </DialogPrimitive.Description>
          <ChallengeTyping
            target={target}
            typed={typed}
            onTyped={setTyped}
            label={pending?.copy?.lead ?? t("unpauseLead")}
            onEnter={() => {
              if (done) finish(true);
            }}
          />
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => finish(false)}>
              {t("cancel")}
            </Button>
            <Button type="button" disabled={!done} onClick={() => finish(true)}>
              {pending?.copy?.confirm ?? t("unpauseConfirm")}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * The words, and the box to type them in: the typed part marked, the first
 * wrong letter in red, pasting and dropping refused. The dialog uses it, and
 * so do the pause panels when a change would loosen a running pause.
 */
export function ChallengeTyping({
  target,
  typed,
  onTyped,
  label,
  onEnter,
  rows = 3,
}: {
  target: string;
  typed: string;
  onTyped: (value: string) => void;
  label: string;
  /** Enter in the box: the caller decides whether it is done. */
  onEnter: () => void;
  rows?: number;
}) {
  const t = useMailT();
  const correct = correctPrefixLength(typed, target);
  const wrongAt = correct < typed.length ? correct : -1;
  return (
    <>
      <p
        aria-hidden
        className="mt-3 select-none break-words rounded-lg bg-stone-100 px-3 py-2.5 font-mono text-sm leading-relaxed text-stone-500"
      >
        <span className="text-teal-700">{target.slice(0, correct)}</span>
        {wrongAt >= 0 ? (
          <>
            <span className="rounded-sm bg-red-100 text-red-700">{target.slice(correct, correct + 1) || " "}</span>
            {target.slice(correct + 1)}
          </>
        ) : (
          target.slice(correct)
        )}
      </p>
      <textarea
        autoFocus
        rows={rows}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        aria-label={label}
        placeholder={t("unpausePlaceholder")}
        value={typed}
        onChange={(e) => onTyped(tidyTyped(e.target.value))}
        onPaste={(e) => e.preventDefault()}
        onDrop={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          onEnter();
        }}
        className="mt-3 w-full resize-none rounded-lg border border-stone-300 bg-white px-3 py-2 font-mono text-sm text-stone-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20"
      />
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-stone-200">
        <div
          className="h-full bg-teal-600 transition-[width]"
          style={{ width: `${target ? Math.round((correct / target.length) * 100) : 0}%` }}
        />
      </div>
    </>
  );
}
