"use client";

/**
 * What happens when the message leaves.
 *
 * One menu on the Send chevron. Outlook can hold the mail and send it later
 * — Exchange keeps it, so the machine that wrote it can be shut. Gmail has
 * nothing we can ask for the same thing, so that half of the menu stays
 * off. See `sendMailMessage`.
 *
 * The other actions are the same on every mailbox: preview the mail, send
 * and propose CRM updates, or finish it in Outlook. They used to sit under
 * the box as a second row of chrome.
 */

import * as React from "react";
import { Clock } from "lucide-react";
import { toast } from "@/lib/mail/toast";

import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { MailPopoverContent } from "@/components/mail/MailPopoverContent";
import { snoozeOptions } from "@/components/mail/SnoozeMenu";
import { mailSay, useMailT } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";

/** `datetime-local` wants local wall-clock, not the ISO string we send. */
function localInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate()
  )}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * What the box starts on: tomorrow morning.
 *
 * It started empty, which the browser fills in with today — a date that is
 * behind by the time anybody reads it, on a control whose whole subject is
 * the future. Tomorrow at eight is both a real answer and the commonest one.
 */
function defaultCustomValue(): string {
  const at = new Date();
  at.setDate(at.getDate() + 1);
  at.setHours(8, 0, 0, 0);
  return localInputValue(at);
}

/**
 * Now, to the next whole minute.
 *
 * Rounded up rather than down: a time that has just passed is refused, and a
 * button that fills the box with something the next click rejects is worse
 * than no button.
 */
function nowValue(): string {
  const at = new Date();
  at.setSeconds(0, 0);
  at.setMinutes(at.getMinutes() + 1);
  return localInputValue(at);
}

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

export function SendLaterMenu({
  onPick,
  trigger,
  schedule = false,
  extras,
}: {
  /** ISO 8601 time to hold the message until. Outlook only. */
  onPick?: (iso: string) => void;
  /**
   * What opens the menu. Given by the caller rather than made here, because
   * it is part of the Send button — one control that sends, with a second
   * section that says how.
   */
  trigger: React.ReactNode;
  /**
   * Offer the Outlook times. Off for Gmail, and off on a forward, which
   * leaves through a path that has nowhere to put a time.
   */
  schedule?: boolean;
  extras?: SendMenuExtra[];
}) {
  const t = useMailT();
  const [open, setOpen] = React.useState(false);
  const [custom, setCustom] = React.useState(defaultCustomValue);
  const extraItems = extras?.filter(Boolean) ?? [];
  // Recomputed on open, or the offer goes stale overnight.
  React.useEffect(() => {
    if (open) setCustom(defaultCustomValue());
  }, [open]);

  // The same times the snooze menu offers, recomputed each time this opens.
  // `open` is in the list for that purpose, although the body does not read it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const options = React.useMemo(() => snoozeOptions(), [open]);

  const choose = (iso: string) => {
    setOpen(false);
    setCustom(defaultCustomValue());
    onPick?.(iso);
  };

  const submitCustom = () => {
    const at = new Date(custom);
    if (!Number.isFinite(at.getTime())) {
      toast.error(mailSay("pickADateAndTime"));
      return;
    }
    if (at.getTime() <= Date.now()) {
      toast.error(mailSay("pickTimeNotPassed"));
      return;
    }
    choose(at.toISOString());
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <MailPopoverContent align="start" className="w-72 rounded-xl p-1.5">
        {schedule && onPick ? (
          <>
            <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-400">
              {t("sendLater")}
            </p>
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                className="flex w-full items-baseline justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-stone-100"
                onClick={() => choose(option.iso)}
              >
                <span className="font-semibold text-stone-800">
                  {option.label}
                </span>
                <span className="text-sm tabular-nums text-stone-400">
                  {option.detail}
                </span>
              </button>
            ))}
            <div className="flex items-center gap-2 px-2.5 py-2">
              <div className="flex min-w-0 flex-1 items-center gap-1 rounded-lg border border-stone-200 pl-2 pr-1">
                <input
                  type="datetime-local"
                  className="min-w-0 flex-1 bg-transparent py-1 text-sm text-stone-800 outline-none"
                  value={custom}
                  min={localInputValue(new Date())}
                  onChange={(e) => setCustom(e.target.value)}
                />
                <button
                  type="button"
                  title={t("now")}
                  aria-label={t("setToNow")}
                  className="shrink-0 rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                  onClick={() => setCustom(nowValue())}
                >
                  <Clock className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-lg bg-teal-600 px-2.5 py-1 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-40"
                disabled={!custom}
                onClick={submitCustom}
              >
                {t("set")}
              </button>
            </div>
            {/* The one thing a reader has to be able to trust about this.
                Said in the same words as the toast that follows, and not
                "this Mac": the standalone app runs on Windows too. */}
            <p className="px-2.5 pb-1.5 pt-0.5 text-[11px] leading-snug text-stone-400">
              {t("outlookHoldsIt")}
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
