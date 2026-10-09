"use client";

import * as React from "react";
import { Calendar, ChevronDown } from "lucide-react";
import { toast } from "@/lib/mail/toast";

import { MailPopoverContent } from "@/components/mail/MailPopoverContent";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import {
  CALENDAR_TARGETS,
  calendarTargetUrl,
  readCalendarTarget,
  writeCalendarTarget,
  type CalendarTarget,
} from "@/lib/mail/calendar-targets";

import {
  attachmentDownloadProps,
  formatFileSize,
} from "@/components/mail/attachment-files";
import { attachmentUrl } from "@/lib/mail/attachment-save";
import {
  formatInviteWhen,
  isCalendarAttachment,
  joinLinkLabel,
  parseCalendarInvite,
  type ParsedCalendarInvite,
} from "@/lib/mail/ics";
import type { MailAttachment } from "@/lib/mail/types";
import {
  isNativeShell,
  openCalendarInvite,
  openExternalUrl,
} from "@/lib/native-shell";
import { mailSay, useMailT } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";
import { mailApiFetch } from "@/lib/mail/api";

function pickCalendarAttachment(
  attachments: MailAttachment[] | undefined
): MailAttachment | null {
  return attachments?.find(isCalendarAttachment) ?? null;
}

export function MessageCalendarInvite({
  account,
  messageId,
  attachments,
  onUnavailable,
}: {
  account: string;
  messageId: string;
  attachments?: MailAttachment[];
  /** Called when ICS can't be parsed — parent can show the file chip again. */
  onUnavailable?: (attachmentId: string) => void;
}) {
  const calendarAtt = pickCalendarAttachment(attachments);
  if (!calendarAtt || calendarAtt.attachmentId.startsWith("local-")) {
    return null;
  }
  return (
    <CalendarInviteCard
      account={account}
      messageId={messageId}
      attachment={calendarAtt}
      onUnavailable={onUnavailable}
    />
  );
}

/** Non-calendar attachments for the normal chip row. */
export function nonCalendarAttachments(
  attachments: MailAttachment[] | undefined,
  /** Calendar attachment ids that failed to parse — show as chips. */
  failedCalendarIds?: Set<string>
): MailAttachment[] {
  return (attachments ?? []).filter(
    (a) => !isCalendarAttachment(a) || failedCalendarIds?.has(a.attachmentId)
  );
}

/**
 * True when we can genuinely hand the invite to the OS default calendar app:
 * the Tauri shells, or local dev where the Next server runs on this machine.
 * Call client-side only (Tauri detection needs `window`).
 */
function canOpenInCalendarApp(): boolean {
  return isNativeShell() || process.env.NODE_ENV === "development";
}

async function openInviteWithDefaultCalendar(input: {
  filename: string;
  icsText: string;
}): Promise<void> {
  // Desktop shell: write a temp .ics and hand it to the OS default app.
  if (isNativeShell()) {
    await openCalendarInvite({
      filename: input.filename,
      content: input.icsText,
    });
    return;
  }

  // Local dev: the Next server runs on this machine, so it can hand the
  // file to the default calendar app directly (Chrome can't).
  const res = await mailApiFetch("/api/mail/open-ics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: input.filename,
      content: input.icsText,
    }),
  });
  if (!res.ok) throw new Error(mailSay("couldNotOpenInvite"));
}

/** Plain browser: no way to launch a native app, so download a named .ics. */
function downloadInvite(input: { filename: string; icsText: string }): void {
  const blob = new Blob([input.icsText], {
    type: "text/calendar;charset=utf-8",
  });
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = input.filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

function CalendarInviteCard({
  account,
  messageId,
  attachment,
  onUnavailable,
}: {
  account: string;
  messageId: string;
  attachment: MailAttachment;
  onUnavailable?: (attachmentId: string) => void;
}) {
  const t = useMailT();
  const [invite, setInvite] = React.useState<ParsedCalendarInvite | null>(null);
  const [icsText, setIcsText] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [opening, setOpening] = React.useState(false);
  // Resolved in an effect: Tauri detection needs `window`, and reading it
  // during render would mismatch the server-rendered HTML in the shells.
  const [canOpenApp, setCanOpenApp] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [remember, setRemember] = React.useState(true);
  /**
   * Where this card would put the event.
   *
   * The calendar application to begin with, which is what this button has
   * always done, until a reader says otherwise. Read in the effect for the
   * same reason as the line above: `localStorage` is not there to be read
   * while the markup is being made.
   */
  const [target, setTarget] = React.useState<CalendarTarget>("app");

  React.useEffect(() => {
    setCanOpenApp(canOpenInCalendarApp());
    const stored = readCalendarTarget();
    if (stored) setTarget(stored);
  }, []);

  const calendarAtt = {
    ...attachment,
    mimeType: attachment.mimeType.includes("calendar")
      ? attachment.mimeType
      : "text/calendar",
    filename: attachment.filename?.toLowerCase().endsWith(".ics")
      ? attachment.filename
      : "invite.ics",
  };
  const downloadHref = attachmentUrl({
    account,
    messageId,
    attachment: calendarAtt,
    download: true,
  });
  const inlineHref = attachmentUrl({
    account,
    messageId,
    attachment: calendarAtt,
  });

  React.useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setInvite(null);
    setIcsText(null);
    void (async () => {
      try {
        const res = await mailApiFetch(inlineHref);
        if (!res.ok) throw new Error(mailSay("couldNotLoadInvite"));
        const text = await res.text();
        const parsed = parseCalendarInvite(text);
        if (cancelled) return;
        if (!parsed) {
          setFailed(true);
          onUnavailable?.(attachment.attachmentId);
          return;
        }
        setIcsText(text);
        setInvite(parsed);
      } catch {
        if (!cancelled) {
          setFailed(true);
          onUnavailable?.(attachment.attachmentId);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inlineHref, attachment.attachmentId, onUnavailable]);

  const addToCalendar = async (to: CalendarTarget) => {
    if (!icsText || opening) return;

    if (to !== "app") {
      // The web calendars are handed the event as a filled-in form, not as
      // a file: there is nothing to download and nothing to open twice.
      const url = invite ? calendarTargetUrl(to, invite) : null;
      if (!url) {
        toast.error(mailSay("couldNotOpenInvite"));
        return;
      }
      void openExternalUrl(url);
      return;
    }

    const input = { filename: calendarAtt.filename, icsText };
    if (!canOpenApp) {
      downloadInvite(input);
      return;
    }
    setOpening(true);
    try {
      await openInviteWithDefaultCalendar(input);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : mailSay("couldNotOpenInvite")
      );
    } finally {
      setOpening(false);
    }
  };

  /**
   * Picked from the menu: do it, and remember it if that is still ticked.
   *
   * The tick is on by default, because somebody who has just said where
   * their calendar is has answered that for every invite after this one
   * as well. Turning it off makes the choice about this event only.
   */
  const chooseTarget = (to: CalendarTarget) => {
    setMenuOpen(false);
    setTarget(to);
    if (remember) writeCalendarTarget(to);
    void addToCalendar(to);
  };

  if (failed) return null;
  if (!invite) {
    return (
      <div
        className="mb-1 flex items-center gap-3 rounded-xl border border-stone-200 px-3 py-2.5"
        aria-hidden
      >
        <Calendar className="h-4 w-4 shrink-0 text-stone-300" />
        <div className="h-4 flex-1 max-w-[14rem] rounded bg-stone-100" />
      </div>
    );
  }

  const when = formatInviteWhen(invite);
  const detailBits = [invite.summary, invite.location].filter(Boolean);

  const targetLabel = (option: CalendarTarget) =>
    option === "google"
      ? t("calendarTargetGoogle")
      : option === "outlook"
        ? t("calendarTargetOutlook")
        : t("calendarTargetApp");

  /*
   * What the button says, and the line under it.
   *
   * The calendar application is the one target this app cannot always
   * reach: in a plain browser there is no way to launch it, so the button
   * saves the file instead and says so. The two web calendars are a link,
   * and a link works from anywhere.
   */
  const primaryLabel =
    target === "google"
      ? t("addViaGoogleCalendar")
      : target === "outlook"
        ? t("addViaOutlookCalendar")
        : canOpenApp
          ? t("addToCalendar")
          : t("downloadEvent");

  const primaryCaption =
    target === "google"
      ? t("opensGoogleCalendar")
      : target === "outlook"
        ? t("opensOutlookCalendar")
        : t(canOpenApp ? "opensInCalendarApp" : "savesIcsFile");

  return (
    <div className="mb-1 rounded-xl border border-stone-200 px-3 py-2.5">
      {/*
        The button drops under the event when they cannot stand side by
        side.

        It is a fixed width — a word and a caption under it — and the pane
        it sits in goes as narrow as the reader wants. Held in one row, it
        took what it needed and left the date whatever remained, which at
        a narrow width was a column about one word wide: "Tue / 15– / Thu
        / 17 / Sep". So the row wraps, and the date asks for twelve rems
        before anything is allowed beside it.
      */}
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-48 items-start gap-3">
          <Calendar
            className="mt-0.5 h-4 w-4 shrink-0 stroke-[1.5] text-teal-700/90"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-stone-900">{when}</p>
            {detailBits.length || invite.joinUrl ? (
              <p className="mt-0.5 truncate text-xs text-stone-500">
                {detailBits.join(" · ")}
                {invite.joinUrl ? (
                  <>
                    {detailBits.length ? " · " : null}
                    <a
                      href={invite.joinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-teal-700 hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {joinLinkLabel(invite.joinUrl)}
                    </a>
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
        </div>
        {/* Right of the event, or right under it — `ml-auto` keeps it to
            the same edge either way, so the card has one line of buttons
            wherever that line ends up. */}
        {/* One control that adds the event, with a second section that says
            where to. The same shape as Send and Send later in the composer. */}
        <div className="ml-auto max-w-full shrink-0 text-right">
          <div className="inline-flex items-stretch overflow-hidden rounded-lg border border-teal-700/70">
            <button
              type="button"
              disabled={opening || !icsText}
              className={cn(
                "inline-flex h-8 items-center bg-white px-2.5",
                "text-xs font-semibold text-teal-800 hover:bg-teal-50",
                "disabled:opacity-50"
              )}
              onClick={(e) => {
                e.stopPropagation();
                void addToCalendar(target);
              }}
            >
              {opening ? t("opening") : primaryLabel}
            </button>
            <Popover open={menuOpen} onOpenChange={setMenuOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={t("chooseWhereToAdd")}
                  title={t("chooseWhereToAdd")}
                  disabled={!icsText}
                  className={cn(
                    "flex h-8 items-center border-l border-teal-700/40 bg-white px-1.5",
                    "text-teal-800 hover:bg-teal-50 disabled:opacity-50"
                  )}
                  onClick={(e) => e.stopPropagation()}
                >
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                </button>
              </PopoverTrigger>
              <MailPopoverContent
                align="end"
                className="w-72 rounded-xl p-1.5"
                onClick={(e) => e.stopPropagation()}
              >
                {CALENDAR_TARGETS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="menuitemradio"
                    aria-checked={target === option}
                    className={cn(
                      "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm",
                      target === option
                        ? "bg-teal-50 text-stone-900"
                        : "text-stone-800 hover:bg-stone-100"
                    )}
                    onClick={() => chooseTarget(option)}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                        target === option
                          ? "border-teal-700 bg-teal-700"
                          : "border-stone-300"
                      )}
                    >
                      {target === option ? (
                        <span className="h-1.5 w-1.5 rounded-full bg-white" />
                      ) : null}
                    </span>
                    <span className="min-w-0">{targetLabel(option)}</span>
                  </button>
                ))}
                <div className="mx-1.5 my-1 border-t border-stone-100" />
                <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-stone-600 hover:bg-stone-100">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-teal-700"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                  />
                  {t("rememberMyChoice")}
                </label>
              </MailPopoverContent>
            </Popover>
          </div>
          <p className="mt-1 text-[10px] leading-tight text-stone-400">
            {primaryCaption}
          </p>
        </div>
      </div>
      <p className="mt-1 pl-7 text-[11px] leading-tight text-stone-400">
        <a
          {...attachmentDownloadProps({
            path: downloadHref,
            filename: calendarAtt.filename,
          })}
          className="hover:text-stone-600 hover:underline"
        >
          {calendarAtt.filename}
          {attachment.size > 0 ? ` · ${formatFileSize(attachment.size)}` : ""}
        </a>
      </p>
    </div>
  );
}
