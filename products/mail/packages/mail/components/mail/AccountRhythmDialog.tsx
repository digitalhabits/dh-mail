"use client";

/**
 * Two questions, asked once, right after a mailbox is connected
 * (mailbox-connected.ts):
 *
 * 1. When do you want to see this account in your inbox? (its hiding
 *    schedule, kept as the hours it is hidden)
 * 2. When should new mail come in? (its own quiet hours, kept as the hours
 *    nothing is fetched)
 *
 * Each step offers a few plain answers and Custom hours…. Any answer but
 * Always opens the time editor the menus use (hours-rule-cards.tsx), and the
 * week beside it can be dragged (hours-week-editor.tsx). Each step can also
 * turn on the words to type before going round its hours (the same setting
 * as in the menus, for every mailbox). Those switches start off.
 *
 * Nothing is saved until Done. Shut any other way, the mailbox stays as
 * every new mailbox is: shown, and fetching on All's hours.
 */

import * as React from "react";

import { AccountMarkButton, ChoosePictureLink } from "@/components/mail/AccountMarkButton";
import { answerFor, HoursQuestion, type HoursAnswer } from "@/components/mail/hours-question";
import { SettingsDialog, settingsPrimaryButton } from "@/components/mail/settings-ui";
import { readMailboxShowWords, setMailboxHiddenHours, setMailboxShowWords } from "@/components/mail/use-mailbox-hide";
import { readMailUnpauseWords, setAccountQuietHours, setMailUnpauseWords } from "@/components/mail/use-mail-pause";
import {
  FETCH_PRESET_ORDER,
  FETCH_PRESETS,
  keptFromOnHours,
  SHOWN_PRESET_ORDER,
  SHOWN_PRESETS,
  type FetchPreset,
  type ShownPreset,
} from "@/lib/mail/account-rhythm";
import { useMailT, type MailStringKey } from "@/lib/mail/i18n";
import { MAILBOX_CONNECTED_EVENT, takeConnectedMailbox } from "@/lib/mail/mailbox-connected";
import type { MailQuietWindow } from "@/lib/mail/quiet-hours";
import { mailProviderFor, useIsOutlookAccount } from "@/lib/mail/use-outlook-accounts";
import { cn } from "@/lib/utils";

/** Words to type when a step's lock is turned on here and none were set. */
const FRICTION_WORDS = 10;

type Answer = { name: MailStringKey; what: MailStringKey };

const SHOWN_ANSWERS: Record<ShownPreset, Answer> = {
  always: { name: "rhythmAnswerAlways", what: "rhythmAnswerAlwaysWhat" },
  weekdays: { name: "rhythmAnswerWeekdays", what: "rhythmAnswerWeekdaysWhat" },
  work: { name: "rhythmAnswerWork", what: "rhythmAnswerWorkWhat" },
};

const FETCH_ANSWERS: Record<FetchPreset, Answer> = {
  always: { name: "rhythmAnswerAlways", what: "rhythmAnswerAlwaysWhat" },
  twice: { name: "rhythmAnswerTwice", what: "rhythmAnswerTwiceWhat" },
  work: { name: "rhythmAnswerWork", what: "rhythmAnswerWorkWhat" },
};

/**
 * The dialog, when a mailbox has just been connected: the address waiting
 * from before the page was there, or the next one announced.
 */
export function ConnectedMailboxRhythm() {
  const [email, setEmail] = React.useState<string | null>(null);
  React.useEffect(() => {
    const waiting = takeConnectedMailbox();
    if (waiting) setEmail(waiting);
    const onConnected = () => {
      const next = takeConnectedMailbox();
      if (next) setEmail(next);
    };
    window.addEventListener(MAILBOX_CONNECTED_EVENT, onConnected);
    return () => window.removeEventListener(MAILBOX_CONNECTED_EVENT, onConnected);
  }, []);
  if (!email) return null;
  // A key a mailbox: a second one connected while the first is asked about
  // starts its own questions from the first step.
  return <AccountRhythmDialog key={email} email={email} onClose={() => setEmail(null)} />;
}

export function AccountRhythmDialog({ email, onClose }: { email: string; onClose: () => void }) {
  const t = useMailT();
  const [step, setStep] = React.useState<1 | 2>(1);
  const [shown, setShown] = React.useState<MailQuietWindow[]>(SHOWN_PRESETS.always);
  const [fetching, setFetching] = React.useState<MailQuietWindow[]>(FETCH_PRESETS.always);
  // Off to begin with, whatever is set for the other mailboxes. Left off, nothing changes; turned on, it asks for words.
  const [showLock, setShowLock] = React.useState(false);
  const [fetchLock, setFetchLock] = React.useState(false);

  const done = () => {
    setMailboxHiddenHours(email, keptFromOnHours(shown));
    setAccountQuietHours(email, keptFromOnHours(fetching));
    // A switch turned on sets the words, for every mailbox, as the menus do:
    // the number already set, or FRICTION_WORDS when none is.
    if (showLock) setMailboxShowWords(readMailboxShowWords() || FRICTION_WORDS);
    if (fetchLock) setMailUnpauseWords(readMailUnpauseWords() || FRICTION_WORDS);
    onClose();
  };

  return (
    <SettingsDialog
      title={<DialogHeading email={email} step={step} />}
      nav={<StepBars step={step} />}
      onClose={onClose}
      closeLabel={t("close")}
      width="w-[880px]"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="text-xs text-stone-500">{t("rhythmLater")}</span>
          <span className="flex items-center gap-2">
            {step === 2 ? (
              <button
                type="button"
                className="rounded-control px-3 py-1.5 text-sm font-semibold text-stone-700 hover:bg-stone-100"
                onClick={() => setStep(1)}
              >
                {t("back")}
              </button>
            ) : null}
            <button
              type="button"
              className={settingsPrimaryButton}
              onClick={step === 1 ? () => setStep(2) : done}
            >
              {step === 1 ? t("rhythmNext") : t("done")}
            </button>
          </span>
        </div>
      }
    >
      {step === 1 ? (
        <RhythmStep
          key="shown"
          question={t("rhythmShownQuestion")}
          lead={t("rhythmShownLead")}
          presets={SHOWN_PRESETS}
          order={SHOWN_PRESET_ORDER}
          answers={SHOWN_ANSWERS}
          rows={shown}
          onRows={setShown}
          previewHint={t("rhythmShownPreviewHint")}
          lock={{ on: showLock, set: setShowLock, title: t("rhythmShownFriction"), what: t("rhythmShownFrictionWhat") }}
        />
      ) : (
        <RhythmStep
          key="fetching"
          question={t("rhythmFetchQuestion")}
          lead={t("rhythmFetchLead")}
          presets={FETCH_PRESETS}
          order={FETCH_PRESET_ORDER}
          answers={FETCH_ANSWERS}
          rows={fetching}
          onRows={setFetching}
          shown={shown}
          previewHint={t("rhythmFetchPreviewHint")}
          lock={{ on: fetchLock, set: setFetchLock, title: t("rhythmFetchFriction"), what: t("rhythmFetchFrictionWhat") }}
        />
      )}
    </SettingsDialog>
  );
}

/**
 * The mailbox, connected, and which step of two this is. Its picture can be
 * chosen here, as in Settings: the mark with its pencil opens
 * the picture menu, and "Choose a picture" goes straight to the file.
 */
function DialogHeading({ email, step }: { email: string; step: 1 | 2 }) {
  const t = useMailT();
  const isOutlookAccount = useIsOutlookAccount();
  return (
    <span className="flex min-w-0 items-center gap-2 font-sans text-sm font-normal">
      <AccountMarkButton
        account={email}
        provider={mailProviderFor(email, isOutlookAccount)}
        title={t("changeAccountPicture")}
        large
        className="mr-1 h-8 w-8 rounded-control"
      />
      <span className="truncate font-semibold text-stone-900">{email}</span>
      <span className="text-stone-500">{t("rhythmConnected")}</span>
      <span className="text-stone-400" aria-hidden>·</span>
      <ChoosePictureLink account={email} className="shrink-0" />
      <span className="ml-auto shrink-0 pl-3 text-stone-500">{t("rhythmStep", { step })}</span>
    </span>
  );
}

function StepBars({ step }: { step: 1 | 2 }) {
  return (
    <div className="flex gap-2" aria-hidden>
      {[1, 2].map((n) => (
        <span
          key={n}
          className={cn("h-[3px] flex-1 rounded-full", n <= step ? "bg-[var(--mail-week-fetch)]" : "bg-stone-200")}
        />
      ))}
    </div>
  );
}

/** One question of the two, with its answers and its week (hours-question.tsx). */
function RhythmStep<P extends string>({
  question,
  lead,
  presets,
  order,
  answers,
  rows,
  onRows,
  shown,
  previewHint,
  lock,
}: {
  question: string;
  lead: string;
  presets: Record<P, MailQuietWindow[]>;
  order: P[];
  answers: Record<P, Answer>;
  rows: MailQuietWindow[];
  onRows: (rows: MailQuietWindow[]) => void;
  /** The hours shown, when the step is about new mail. */
  shown?: MailQuietWindow[];
  previewHint: string;
  lock: { on: boolean; set: (on: boolean) => void; title: string; what: string };
}) {
  const t = useMailT();
  const list: HoursAnswer[] = order.map((name, i) => ({
    id: name,
    name: t(answers[name].name),
    what: t(answers[name].what),
    rows: presets[name],
    badge: i === 0 ? t("rhythmDefault") : null,
  }));
  // Custom hours… stays chosen once picked, even for hours that match an
  // answer; an edit by hand reads the answer again from the hours.
  const [choice, setChoice] = React.useState<string | null>(() => answerFor(list, rows));
  return (
    <HoursQuestion
      question={question}
      lead={lead}
      answers={list}
      customWords={{ name: t("rhythmAnswerCustom"), what: t("rhythmAnswerCustomWhat") }}
      choice={choice}
      onChoose={(id) => setChoice(id)}
      rows={rows}
      onRows={onRows}
      shown={shown}
      previewHint={previewHint}
      lock={lock}
    />
  );
}
