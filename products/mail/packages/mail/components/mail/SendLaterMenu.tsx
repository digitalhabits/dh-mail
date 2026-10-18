"use client";

/**
 * What happens when the message leaves.
 *
 * One menu on the Send chevron. Outlook holds the mail on Microsoft's
 * server and sends it later, so the machine that wrote it can be shut.
 * Gmail and Exchange keep it as a draft that this computer sends at the
 * time (docs/mail-send-later.md), and the menu says so.
 *
 * The other actions are the same on every mailbox: preview the mail, an
 * action a build adds, or finish it in Outlook. They used to sit under
 * the box as a second row of chrome.
 */

import { formatSnoozeWakeLabel } from "@/components/mail/SnoozeMenu";
import { useSendLaterHolder } from "@/lib/mail/use-outlook-accounts";
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { CalendarTimePicker, MenuHeading, PresetRow, pickedLabel } from "@/components/mail/date-time-pick";

import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { MailPopoverContent } from "@/components/mail/MailPopoverContent";
import { snoozeOptions } from "@/components/mail/SnoozeMenu";
import { useMailT } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";


export type SendMenuExtra = {
  id: string;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  title?: string;
  onSelect: () => void;
};

const EXTRA_BUTTON =
  "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-semibold text-stone-800 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40";

/** The Send button's word: Sending…, Forward, Send at Sun 08:00, or Send. */
export function sendButtonWord(
  t: (key: "sending" | "actionForward" | "sendAtWhen" | "send", vars?: Record<string, string>) => string,
  state: { sending: boolean; forwarding?: boolean; armed?: string | null }
): string {
  if (state.sending) return t("sending");
  if (state.forwarding) return t("actionForward");
  if (state.armed) return t("sendAtWhen", { when: formatSnoozeWakeLabel(state.armed) });
  return t("send");
}

export function SendLaterMenu({
  account = "",
  armed = null,
  onArm,
  onPick,
  trigger,
  schedule = false,
  extras,
}: {
  /** The mailbox it goes from: it decides who keeps it until the time. */
  account?: string;
  /** ISO 8601 time to hold the message until. */
  onPick?: (iso: string) => void;
  /**
   * A time picked, quick or Set: it is not sent yet. The Send button takes
   * the time ("Send at …"), and the message goes when it is pressed.
   * Without this (Change time), a pick is acted on at once.
   */
  onArm?: (iso: string | null) => void;
  /** The time Set gave, if any: the menu offers to take it off. */
  armed?: string | null;
  /**
   * What opens the menu. Given by the caller rather than made here, because
   * it is part of the Send button — one control that sends, with a second
   * section that says how.
   */
  trigger: React.ReactNode;
  /**
   * Offer the times. Off where there is no send later (a browser), and off
   * on a forward, which leaves through a path that has nowhere to put a time.
   */
  schedule?: boolean;
  extras?: SendMenuExtra[];
}) {
  const t = useMailT();
  const holder = useSendLaterHolder(account);
  const [open, setOpen] = React.useState(false);
  // "Pick date and time…" opens the calendar inside this card.
  const [picking, setPicking] = React.useState(false);
  const extraItems = extras?.filter(Boolean) ?? [];

  // The same times the snooze menu offers, recomputed each time this opens.
  // `open` is in the list for that purpose, although the body does not read it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const options = React.useMemo(() => snoozeOptions(), [open]);

  // With `onArm`, every time goes on the Send button first ("Send at …"),
  // and nothing is sent until it is pressed. Without (Change time), at once.
  const choose = (iso: string) => {
    setOpen(false);
    setPicking(false);
    if (onArm) onArm(iso);
    else onPick?.(iso);
  };
  /** The calendar opens on today, an hour from now: the first time offered. */
  const inAnHour = () => new Date(Date.now() + 60 * 60 * 1000);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setPicking(false);
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <MailPopoverContent
        align="start"
        className="max-h-[var(--radix-popover-content-available-height)] w-72 overflow-y-auto rounded-xl p-1.5"
      >
        {schedule && onPick ? (
          <>
            <MenuHeading>{t("sendLater")}</MenuHeading>
            {armed && onArm ? (
              <button
                type="button"
                className="flex w-full items-baseline justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-stone-100"
                onClick={() => {
                  setOpen(false);
                  onArm(null);
                }}
              >
                <span className="font-semibold text-stone-800">{t("sendNowInstead")}</span>
              </button>
            ) : null}
            {options.map((option) => (
              <PresetRow key={option.id} label={option.label} detail={option.detail} onClick={() => choose(option.iso)} />
            ))}
            <PresetRow
              label={t("pickDateAndTime")}
              onClick={() => setPicking((v) => !v)}
              trailing={
                <ChevronDown
                  className={cn("h-4 w-4 shrink-0 text-stone-400 transition-transform", picking && "rotate-180")}
                  aria-hidden
                />
              }
            />
            {picking ? (
              <div className="pt-1">
                <CalendarTimePicker
                  initial={inAnHour()}
                  action={(at) =>
                    t(onArm ? "useWhen" : "changeToWhen", { when: pickedLabel(at, t("todayLower")) })
                  }
                  onPick={(at) => choose(at.toISOString())}
                />
              </div>
            ) : null}
            {/* The one thing a reader has to be able to trust about this.
                Said in the same words as the toast that follows, and not
                "this Mac": the standalone app runs on Windows too. */}
            <p className="px-2.5 pb-1.5 pt-1 text-[11px] leading-snug text-stone-400">
              {t(holder === "computer" ? "draftSendLaterHint" : "outlookHoldsIt")}
            </p>
          </>
        ) : null}
        {schedule && onPick && extraItems.length ? (
          <div className="mx-1.5 my-1 border-t border-stone-100" />
        ) : null}
        {extraItems.map((item) => (
          <button
            key={item.id}
            type="button"
            title={item.title}
            disabled={item.disabled}
            className={EXTRA_BUTTON}
            onClick={() => {
              setOpen(false);
              item.onSelect();
            }}
          >
            {item.icon ? (
              <span className="inline-flex text-stone-500 [&_svg]:h-3.5 [&_svg]:w-3.5">
                {item.icon}
              </span>
            ) : null}
            <span className={cn(item.icon ? "min-w-0" : undefined)}>
              {item.label}
            </span>
          </button>
        ))}
      </MailPopoverContent>
    </Popover>
  );
}
