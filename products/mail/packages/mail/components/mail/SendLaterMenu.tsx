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
 * action a build adds, or finish it in Outlook.
 */

import { formatSnoozeWakeLabel } from "@/components/mail/SnoozeMenu";
import { useSendLaterHolder } from "@/lib/mail/use-outlook-accounts";
import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { CalendarTimePicker, MenuHeading, PresetRow } from "@/components/mail/date-time-pick";

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
  "flex w-full items-center gap-2 rounded-control px-2.5 py-2 text-left text-sm font-semibold text-stone-800 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40";

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
  contentClassName,
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
  /** For a menu opened over a dialog: a layer above it. */
  contentClassName?: string;
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

  /*
    A time picked is a time scheduled, at once, as with Change time. If
    the time waits on the Send button ("Send at …") for a press of Send,
    it is not plain what Send does with the menu open. Send sends at once,
    and the time picked is lost. The toast that follows has Undo. `onArm` stays for a time the composer already
    holds (Edit on a scheduled message), which the menu can take off.
  */
  const setMenuOpen = (next: boolean) => {
    setOpen(next);
    if (!next) setPicking(false);
  };
  /*
    Send pauses while the menu is open (mail.css, [data-send-main]): dimmed,
    and a press on it only closes the menu. With the menu open, it is not
    plain whether Send uses the time being picked. It does not.
  */
  React.useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    root.setAttribute("data-send-later-open", "");
    return () => root.removeAttribute("data-send-later-open");
  }, [open]);
  const choose = (iso: string) => {
    setMenuOpen(false);
    onPick?.(iso);
  };
  /** The calendar opens on today, an hour from now: the first time offered. */
  const inAnHour = () => new Date(Date.now() + 60 * 60 * 1000);

  return (
    <Popover open={open} onOpenChange={setMenuOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <MailPopoverContent
        align="start"
        className={cn(
          "max-h-[var(--radix-popover-content-available-height)] overflow-y-auto rounded-surface p-1.5",
          // Wide while the date and time are being picked: the month and
          // the clock side by side, so Schedule stays in sight.
          picking ? "w-[34rem]" : "w-72",
          contentClassName
        )}
      >
        {schedule && onPick && picking ? (
          /*
            The picker in place of everything else: the presets, the hint
            and the other ways to send. Under them, it runs past the window
            and Schedule is out of sight. A back row returns to them.
          */
          <>
            <div className="mb-2 flex items-center gap-3 border-b border-stone-100 px-1.5 pb-2 pt-1">
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-sm text-stone-500 hover:bg-stone-100 hover:text-stone-800"
                onClick={() => setPicking(false)}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
                {t("sendLater")}
              </button>
              <span className="text-sm font-semibold text-stone-900">{t("pickDateAndTimeTitle")}</span>
            </div>
            <CalendarTimePicker
              wide
              initial={inAnHour()}
              // The time stands beside the button, which says only what it does.
              action={() => t(onArm ? "schedule" : "changeTime")}
              onPick={(at) => choose(at.toISOString())}
            />
          </>
        ) : null}
        {schedule && onPick && !picking ? (
          <>
            <MenuHeading>{t("sendLater")}</MenuHeading>
            {armed && onArm ? (
              <button
                type="button"
                className="flex w-full items-baseline justify-between gap-3 rounded-control px-2.5 py-1.5 text-left text-sm hover:bg-stone-100"
                onClick={() => {
                  setMenuOpen(false);
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
              onClick={() => setPicking(true)}
              trailing={<ChevronRight className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />}
            />
            {/* The one thing a reader has to be able to trust about this.
                Said in the same words as the toast that follows, and not
                "this Mac": the standalone app runs on Windows too. */}
            <p className="px-2.5 pb-1.5 pt-1 text-[11px] leading-snug text-stone-400">
              {t(holder === "computer" ? "draftSendLaterHint" : "outlookHoldsIt")}
            </p>
          </>
        ) : null}
        {schedule && onPick && extraItems.length && !picking ? (
          <div className="mx-1.5 my-1 border-t border-stone-100" />
        ) : null}
        {(picking ? [] : extraItems).map((item) => (
          <button
            key={item.id}
            type="button"
            title={item.title}
            disabled={item.disabled}
            className={EXTRA_BUTTON}
            onClick={() => {
              setMenuOpen(false);
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
