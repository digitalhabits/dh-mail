"use client";

/**
 * Scheduled mail that missed its time, asked about once.
 *
 * Mail sends a scheduled message by itself until an hour past its time.
 * Later than that — the computer was asleep, or Mail was closed — it waits
 * for the person: a message meant for 09:00 must not go at 15:00 by
 * itself. A warning in the Scheduled row alone, "Not sent · Try again ·
 * Keep as draft", reads as an error and runs out of the row. So Mail asks,
 * in plain words, once per message: one message with a look at what it says, or several with a
 * box each. Not now leaves them in Scheduled, marked as missed.
 */

import { usePageActions, usePageList } from "@/components/mail/mail-page-slices";
import { MISSED_SCHEDULED_ASKED_KEY as ASKED_KEY } from "@/lib/mail/storage-keys";
import * as React from "react";
import { createPortal } from "react-dom";

import { ChangeTimeMenu, openScheduledMessage } from "@/components/mail/ScheduledMessageView";
import { currentMailLocale } from "@/lib/mail/i18n-strings";
import { useMailT } from "@/lib/mail/i18n";
import { isScheduledDraftId } from "@/lib/mail/scheduled-drafts";
import type { MailScheduledMessage } from "@/lib/mail/types";

/** The messages asked about in this window, so a reload does not ask again. */
const keyOf = (held: MailScheduledMessage) => `${held.account.toLowerCase()}|${held.id}`;

function readAsked(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(ASKED_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function markAsked(list: MailScheduledMessage[]): void {
  const asked = readAsked();
  for (const held of list) asked.add(keyOf(held));
  try {
    sessionStorage.setItem(ASKED_KEY, JSON.stringify([...asked]));
  } catch {
    /* asked again after a reload */
  }
}

/** "08:00 today", or "Mon 19 Oct, 17:00". */
export function missedWhen(iso: string, t: ReturnType<typeof useMailT>): string {
  const at = new Date(iso);
  const locale = currentMailLocale();
  const time = at.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  if (at.toDateString() === new Date().toDateString()) return t("todayAt", { time });
  return `${at.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" })}, ${time}`;
}

/** "2 h 42 min", "35 min". */
function agoLabel(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours >= 48) return `${Math.floor(hours / 24)} d`;
  return hours ? `${hours} h ${rest} min` : `${rest} min`;
}

/** The first line the message says. */
function firstLine(held: MailScheduledMessage): string {
  const text = held.bodyText || (held.bodyHtml ?? "").replace(/<[^>]+>/g, " ");
  return text.replace(/\s+/g, " ").trim();
}

export function MissedScheduledDialog() {
  const pageList = usePageList();
  const pageActions = usePageActions();
  const t = useMailT();
  const [askedNow, setAskedNow] = React.useState(0);
  const missed = React.useMemo(() => {
    const asked = readAsked();
    return pageList.heldMessages.filter((held) => held.missed && !asked.has(keyOf(held)));
    // `askedNow` makes it read again once the person has answered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageList.heldMessages, askedNow]);
  const [ticked, setTicked] = React.useState<Set<string>>(new Set());
  // Every one ticked, as it comes: the question is which to hold back.
  const missedKey = missed.map(keyOf).join(",");
  React.useEffect(() => {
    setTicked(new Set(missed.map(keyOf)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missedKey]);

  if (!missed.length || typeof document === "undefined") return null;

  const done = () => {
    markAsked(missed);
    setAskedNow((n) => n + 1);
  };
  const sendNow = (list: MailScheduledMessage[]) => {
    done();
    for (const held of list) void pageActions.actOnHeld(held, "sendNow");
  };
  const allDrafts = missed.every((held) => isScheduledDraftId(held.id));
  const one = missed.length === 1 ? missed[0] : null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/30 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) done();
      }}
    >
      <div
        // A dialog: the list's keys leave the focus here alone.
        role="dialog"
        aria-modal="true"
        aria-label={one ? t("missedOneTitle") : t("missedManyTitle", { count: missed.length })}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            done();
          }
        }}
        className="w-full max-w-lg rounded-dialog border border-stone-200 bg-white p-6 text-stone-800 shadow-xl"
      >
        {one ? (
          <>
            <h2 className="text-lg font-semibold">{t("missedOneTitle")}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-stone-600">
              {t("missedOneBody", { when: missedWhen(one.sendAt, t), ago: agoLabel(one.sendAt) })}
            </p>
            <div className="mt-4 rounded-control border border-stone-200 bg-stone-50 px-4 py-3">
              <div className="flex items-baseline justify-between gap-3 text-xs text-stone-500">
                <span className="min-w-0 truncate">
                  {t("fieldTo")} {one.to.join(", ") || one.toName}
                </span>
                <span className="shrink-0">
                  {t("fieldFrom").toLowerCase()} {one.account}
                </span>
              </div>
              <p className="mt-1 truncate text-sm font-semibold text-stone-900">{one.subject || t("noSubject")}</p>
              <p className="truncate text-sm text-stone-600">{firstLine(one)}</p>
              <button
                type="button"
                className="mt-1 text-sm font-semibold text-teal-700 hover:text-teal-800"
                onClick={() => {
                  done();
                  openScheduledMessage(one);
                }}
              >
                {t("openEmail")}
              </button>
            </div>
            <div className="mt-5 flex items-center gap-2">
              <button
                type="button"
                className="mr-auto rounded-full px-3 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-100"
                onClick={done}
              >
                {t(isScheduledDraftId(one.id) ? "keepAsDraft" : "notNow")}
              </button>
              {one.reschedulable ? (
                <ChangeTimeMenu
                  account={one.account}
                  asButton
                  overDialog
                  label={t("reschedule")}
                  onPick={(iso) => {
                    done();
                    void pageActions.actOnHeld(one, "reschedule", iso);
                  }}
                />
              ) : null}
              <button
                type="button"
                className="rounded-full bg-teal-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-teal-800"
                onClick={() => sendNow([one])}
              >
                {t("sendNow")}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold">{t("missedManyTitle", { count: missed.length })}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-stone-600">{t("missedManyBody")}</p>
            <ul className="mt-4 divide-y divide-stone-200 overflow-hidden rounded-surface border border-stone-200">
              {missed.map((held) => {
                const key = keyOf(held);
                const on = ticked.has(key);
                return (
                  <li key={key}>
                    <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-stone-50">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-teal-700"
                        checked={on}
                        onChange={() =>
                          setTicked((prev) => {
                            const next = new Set(prev);
                            if (next.has(key)) next.delete(key);
                            else next.add(key);
                            return next;
                          })
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-stone-900">{held.toName}</span>
                        <span className="block truncate text-sm text-stone-600">{held.subject || t("noSubject")}</span>
                      </span>
                      <span className="shrink-0 text-xs text-stone-500">{missedWhen(held.sendAt, t)}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="mt-5 flex items-center gap-2">
              <button
                type="button"
                className="mr-auto rounded-full px-3 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-100"
                onClick={done}
              >
                {t(allDrafts ? "keepAllAsDrafts" : "notNow")}
              </button>
              <button
                type="button"
                disabled={!ticked.size}
                className="rounded-full bg-teal-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => sendNow(missed.filter((held) => ticked.has(keyOf(held))))}
              >
                {ticked.size === missed.length
                  ? t("sendAllCount", { count: missed.length })
                  : t("sendCount", { count: ticked.size })}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
