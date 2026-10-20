"use client";

/**
 * A scheduled message, open in the reader.
 *
 * A reply sent later stands in its thread, as a dashed bubble with its
 * time. A new message has no thread to stand in until it goes, so clicking
 * its row in the Scheduled group opened nothing: the reader could see that
 * it was there, but not what it said, and could not change it. This is its
 * page — the words, who it goes to, when — with the four things to do with
 * it: Send now, Change time, Edit, Cancel (docs/mail-send-later.md, 4.7).
 */

import * as React from "react";
import { Clock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmailHtmlView } from "@/components/mail/EmailHtmlView";
import { SendLaterMenu } from "@/components/mail/SendLaterMenu";
import { formatSnoozeWakeLabel } from "@/components/mail/SnoozeMenu";
import type { MailPageModel } from "@/components/mail/use-mail-page";
import { plainTextToEditorHtml } from "@/lib/client-email-html";
import { dropOwnInkForEditing, dropRemoteImagesForEditing } from "@/lib/mail/editor-html";
import { sanitizeEmailHtml } from "@/lib/mail/email-html";
import { useMailT } from "@/lib/mail/i18n";
import { useMailColorMode } from "@/lib/mail/theme";
import { newComposeDraftKey, saveComposeDraft } from "@/lib/mail/local-drafts";
import { isScheduledDraftId } from "@/lib/mail/scheduled-drafts";
import type { MailScheduledMessage } from "@/lib/mail/types";

// ---------------------------------------------------------------------------
// Which scheduled message is open. A little store of its own: the list sets
// it, the reading pane shows it, and opening a thread clears it.
// ---------------------------------------------------------------------------

let openNow: MailScheduledMessage | null = null;
const listeners = new Set<() => void>();

export function openScheduledMessage(held: MailScheduledMessage | null): void {
  if (openNow === held) return;
  openNow = held;
  for (const listener of listeners) listener();
}

export function useOpenScheduledMessage(): MailScheduledMessage | null {
  return React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => openNow,
    () => null
  );
}

/**
 * The scheduled message open in the reader, as the list has it now. It goes
 * when a thread is opened, when another person is picked in Stacks, and
 * when it has been sent or let go.
 */
export function useOpenHeldMessage(
  held: readonly MailScheduledMessage[],
  threadOpen: boolean,
  personKey?: string | null
): MailScheduledMessage | null {
  const open = useOpenScheduledMessage();
  React.useEffect(() => {
    if (threadOpen) openScheduledMessage(null);
  }, [threadOpen]);
  // By key, not by row: the rows are made again on every refresh of the list.
  React.useEffect(() => {
    if (personKey) openScheduledMessage(null);
  }, [personKey]);
  if (!open || threadOpen) return null;
  return held.find((h) => h.id === open.id && h.account === open.account) ?? null;
}

/** "Change time": the same times as Send later, for a message already scheduled. */
export function ChangeTimeMenu({
  account,
  onPick,
  asButton = false,
  label,
  overDialog = false,
}: {
  account: string;
  onPick: (iso: string) => void;
  asButton?: boolean;
  /** In place of "Change time": "Reschedule…" for a message that missed its time. */
  label?: string;
  /** Opened from a dialog: the menu stands above it. */
  overDialog?: boolean;
}) {
  const t = useMailT();
  const word = label ?? t("changeTime");
  return (
    <SendLaterMenu
      account={account}
      schedule
      onPick={onPick}
      contentClassName={overDialog ? "z-[210]" : undefined}
      trigger={
        asButton ? (
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5">
            <Clock className="h-3.5 w-3.5" aria-hidden />
            {word}
          </Button>
        ) : (
          <button type="button" className="font-semibold text-teal-700 hover:text-teal-800">
            {word}
          </button>
        )
      }
    />
  );
}

/**
 * Edit: the words in a new composer, with the original's time on Send. The
 * original stays scheduled until the edited one is sent; discard the
 * composer and it goes as it was (lib/mail/scheduled-replace).
 */
async function editInComposer(m: MailPageModel, held: MailScheduledMessage): Promise<void> {
  const key = newComposeDraftKey();
  const asRecipients = (list: string[]) => list.map((email) => ({ kind: "email" as const, email }));
  await saveComposeDraft({
    key,
    kind: "compose",
    from: held.account,
    subject: held.subject,
    body: held.bodyHtml
      ? dropOwnInkForEditing(dropRemoteImagesForEditing(held.bodyHtml))
      : plainTextToEditorHtml(held.bodyText),
    toList: asRecipients(held.to),
    ccList: asRecipients(held.cc),
    bccList: asRecipients(held.bcc ?? []),
    showCc: held.cc.length > 0,
    showBcc: Boolean(held.bcc?.length),
    attachments: [],
    // A draft's words were kept without the signature, which goes on at the
    // send. An outbox message's words carry it already.
    includeSignature: !held.signed,
    replacesScheduled: { account: held.account, id: held.id, sendAt: held.sendAt },
  });
  openScheduledMessage(null);
  m.startCompose({ to: [], subject: "", continuedFromLabel: "", draftKey: key });
}

function Action({ onClick, children, danger = false }: { onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      className={danger ? "font-semibold text-red-700 hover:text-red-800" : "font-semibold text-teal-700 hover:text-teal-800"}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const Dot = () => <span aria-hidden className="text-stone-300">·</span>;

/**
 * The page: the subject as a thread's heading, who it goes to, and the
 * message in the dashed bubble a scheduled reply has in its thread, with
 * its time and what can be done with it under it.
 */
export function ScheduledMessageView({ m, held }: { m: MailPageModel; held: MailScheduledMessage }) {
  const t = useMailT();
  const late = held.status === "failed";
  const hasWords = Boolean(held.bodyHtml || held.bodyText);
  const html = React.useMemo(() => (held.bodyHtml ? sanitizeEmailHtml(held.bodyHtml) : ""), [held.bodyHtml]);
  const dark = useMailColorMode() === "dark";
  const act = (action: "sendNow" | "cancel") => {
    openScheduledMessage(null);
    void m.actOnHeld(held, action);
  };
  const people = [
    `${t("fieldTo")} ${held.to.join(", ")}`,
    held.cc.length ? `Cc ${held.cc.join(", ")}` : "",
    held.bcc?.length ? `Bcc ${held.bcc.join(", ")}` : "",
  ].filter(Boolean);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="border-b border-stone-200 px-8 pb-4 pt-6">
        <h1 className="font-serif text-2xl font-semibold leading-tight text-stone-900">
          {held.subject || t("noSubject")}
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          {t("fieldFrom")} {held.account}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1.5 px-8 py-6">
        <p className="max-w-[85%] self-end truncate text-xs text-stone-500">{people.join(" · ")}</p>
        <div className="w-full max-w-[85%] self-end rounded-2xl rounded-br-md border border-dashed border-teal-300 bg-[var(--mail-bubble-own)]/60 px-4 py-3">
          {html ? (
            /*
              In the frame the messages are read in, re-lit in the dark as
              they are. Put in as it was, the message kept the colours it
              was written with — dark grey on the dark page (2026-10-20).
            */
            <EmailHtmlView
              html={html}
              allowImages
              bodyColor={dark ? "#e2e9f0" : undefined}
              darkRecolor={dark}
            />
          ) : (
            <p className="whitespace-pre-wrap break-words text-[15px] text-stone-800">{held.bodyText}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5 pr-1 text-xs text-stone-500">
          <Clock className="h-3.5 w-3.5 text-teal-700/75" aria-hidden />
          <span className={late ? "font-semibold text-amber-700" : undefined}>
            {late ? held.error || t("notSent") : t("sendsWhen", { when: formatSnoozeWakeLabel(held.sendAt) })}
          </span>
          {held.reschedulable ? (
            <>
              <Dot />
              <ChangeTimeMenu account={held.account} onPick={(iso) => void m.actOnHeld(held, "reschedule", iso)} />
            </>
          ) : null}
          {held.cancellable === false ? null : (
            <>
              {hasWords ? (
                <>
                  <Dot />
                  <Action onClick={() => void editInComposer(m, held)}>{t("edit")}</Action>
                </>
              ) : null}
              <Dot />
              <Action onClick={() => act("sendNow")}>{t("sendNow")}</Action>
              <Dot />
              <Action danger onClick={() => act("cancel")}>
                {late && isScheduledDraftId(held.id) ? t("keepAsDraft") : t("cancel")}
              </Action>
            </>
          )}
        </div>
        {isScheduledDraftId(held.id) && !late ? (
          <p className="max-w-[85%] self-end text-right text-[11px] text-stone-400">{t("draftSendLaterHint")}</p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Under a composer opened with Edit on a scheduled message: what happens to
 * the original, said where the reader is deciding. Nothing when the
 * composer is not an edit.
 */
export function EditingScheduledNote({
  original,
  width,
}: {
  original: { sendAt: string } | null;
  width?: number;
}) {
  const t = useMailT();
  if (!original) return null;
  return (
    <p
      className="mx-auto mt-2 flex items-start gap-1.5 rounded-lg bg-teal-50/70 px-3 py-2 text-xs leading-snug text-stone-700"
      style={width ? { width, maxWidth: "100%" } : undefined}
    >
      <Clock className="mt-px h-3.5 w-3.5 shrink-0 text-teal-700/75" aria-hidden />
      {t("editingScheduledNote", { when: formatSnoozeWakeLabel(original.sendAt) })}
    </p>
  );
}
