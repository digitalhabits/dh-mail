/**
 * Send later for Gmail (API) and Exchange: the message waits as a draft on
 * the server, and this computer sends that draft at its time.
 *
 * See docs/mail-send-later.md. The schedule — which draft, and when — is
 * kept in the local store (`scheduled_sends.rs`), which claims a row before
 * it is sent. Sending a draft takes it out of Drafts, so a second try finds
 * no draft and sends nothing: a message goes once, or not at all. If the app
 * never runs again, the message is still a draft, on every device.
 *
 * Only the main window runs the sender (`startScheduledSender`).
 */

import { utf8ToBase64 } from "@/lib/base64";
import { createGmailDraft, deleteGmailDraft, sendGmailDraft } from "@/lib/gmail/api";
import { mailSay, currentMailLocale } from "@/lib/mail/i18n-strings";
import { accessTokenFor } from "@/lib/mail/mail-gmail-token";
import { tauriInvoke } from "@/lib/mail/store/tauri";
import type { MailScheduledMessage } from "@/lib/mail/types";

export type DraftProvider = "gmail" | "exchange";

/** A row of the list's ids, so the list's actions know it is one of these. */
const ID_PREFIX = "draft:";

/** How often the sender looks for a message whose time has come. */
const LOOK_EVERY_MS = 30_000;

/** The row the store answers (`scheduled_sends.rs`, `row_json`). */
type Row = {
  id: number;
  account: string;
  provider: DraftProvider;
  draftId: string;
  threadId?: string | null;
  subject: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  bodyText?: string;
  bodyHtml?: string | null;
  sendAt: number;
  status: "waiting" | "sending" | "late" | "refused";
  lastError?: string | null;
};

/** What a failed send means. See `SendFailure` in scheduled_sends.rs. */
export type SendFailure = "gone" | "retry" | "refused";

function invokeOrThrow() {
  const invoke = tauriInvoke();
  if (!invoke) throw new Error(mailSay("sendLaterNeedsApp"));
  return invoke;
}

/** True when this app can send later from a draft. */
export function canScheduleFromDraft(): boolean {
  return Boolean(tauriInvoke());
}

/**
 * Save the message as a draft on the server, and schedule that draft.
 *
 * `raw` is the whole message as it will be sent (the same MIME a send
 * builds). A schedule that cannot be written takes its draft away again, so
 * nothing is left that the person did not ask for.
 */
export async function scheduleAsDraft(input: {
  account: string;
  provider: DraftProvider;
  raw: string;
  bcc: string[];
  threadId?: string;
  subject: string;
  to: string[];
  cc: string[];
  bodyText: string;
  bodyHtml?: string;
  /** ISO time. */
  sendAt: string;
}): Promise<void> {
  const invoke = invokeOrThrow();
  const account = input.account.trim().toLowerCase();
  const sendAt = Date.parse(input.sendAt);
  if (!Number.isFinite(sendAt) || sendAt <= Date.now()) throw new Error(mailSay("sendLaterTimePassed"));

  let draftId: string;
  if (input.provider === "gmail") {
    const draft = await createGmailDraft(await accessTokenFor(account), input.raw, input.threadId);
    draftId = draft.id;
  } else {
    const saved = (await invoke("mail_ews_save_draft", {
      account,
      mime: utf8ToBase64(input.raw),
      bcc: input.bcc,
      replaces: null,
    })) as { itemId: string };
    draftId = saved.itemId;
  }

  try {
    await invoke("mail_scheduled_add", {
      account,
      message: {
        provider: input.provider,
        draftId,
        threadId: input.threadId ?? null,
        subject: input.subject,
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        bodyText: input.bodyText,
        bodyHtml: input.bodyHtml ?? null,
        sendAt,
      },
    });
  } catch (err) {
    await deleteDraft(account, input.provider, draftId).catch(() => undefined);
    throw err;
  }
}

async function deleteDraft(account: string, provider: DraftProvider, draftId: string): Promise<void> {
  if (provider === "gmail") {
    await deleteGmailDraft(await accessTokenFor(account), draftId);
    return;
  }
  await invokeOrThrow()("mail_ews_delete_draft", { account, itemId: draftId, discard: true });
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

export function isScheduledDraftId(id: string): boolean {
  return id.startsWith(ID_PREFIX);
}

function rowIdOf(id: string): number {
  return Number(id.slice(ID_PREFIX.length));
}

function timeOf(ms: number): string {
  return new Date(ms).toLocaleString(currentMailLocale(), {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * The scheduled drafts, as the list's held rows. A late row and a refused
 * one are "failed": the list shows them as Not sent, with Try again (send
 * now) and Cancel, which is the question the late rule asks.
 */
export function toScheduledMessage(row: Row): MailScheduledMessage {
  const status = row.status === "late" || row.status === "refused" ? "failed" : row.status;
  const error =
    row.status === "late"
      ? mailSay("scheduledWasDue", { time: timeOf(row.sendAt) })
      : row.status === "refused"
        ? (row.lastError ?? undefined)
        : undefined;
  const to = row.to ?? [];
  return {
    id: `${ID_PREFIX}${row.id}`,
    sendAt: new Date(row.sendAt).toISOString(),
    account: row.account,
    threadId: row.threadId ?? "",
    toName: to[0] ?? "",
    subject: row.subject,
    bodyText: row.bodyText ?? "",
    ...(row.bodyHtml ? { bodyHtml: row.bodyHtml } : null),
    to,
    cc: row.cc ?? [],
    ...(row.bcc?.length ? { bcc: row.bcc } : null),
    status,
    reschedulable: true,
    ...(row.status === "late" ? { missed: true } : null),
    ...(error ? { error } : null),
  };
}

/** One mailbox's scheduled drafts, or one thread's. */
export async function listScheduledDrafts(account: string, threadId?: string): Promise<MailScheduledMessage[]> {
  const invoke = tauriInvoke();
  if (!invoke) return [];
  const rows = (await invoke("mail_scheduled_list", { account })) as Row[] | null;
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => !threadId || row.threadId === threadId)
    .map(toScheduledMessage);
}

/**
 * Cancel a message waiting for its time: the schedule goes, and so does
 * its draft — as a cancel of an Outlook message does. Edit is a cancel that
 * opens the words in the composer first, so nothing is lost.
 *
 * A late or refused message keeps its draft: dismissing "it was due at
 * 09:00" is Keep as draft (docs/mail-send-later.md, 4.5), and the person
 * finds it in Drafts.
 */
export async function cancelScheduledDraft(account: string, id: string): Promise<void> {
  const invoke = invokeOrThrow();
  const email = account.trim().toLowerCase();
  const row = (await invoke("mail_scheduled_cancel", { account: email, id: rowIdOf(id) })) as Row | null;
  if (!row || row.status === "late" || row.status === "refused") return;
  await deleteDraft(email, row.provider, row.draftId).catch((err) => {
    // The schedule is gone, so it will not be sent; the draft stays in
    // Drafts, which is safe.
    console.warn("[mail] a cancelled scheduled draft could not be deleted:", err);
  });
}

/** Change the time. A late or refused one is given its chance again. */
export async function rescheduleScheduledDraft(account: string, id: string, sendAt: string): Promise<void> {
  const at = Date.parse(sendAt);
  if (!Number.isFinite(at) || at <= Date.now()) throw new Error(mailSay("sendLaterTimePassed"));
  await invokeOrThrow()("mail_scheduled_reschedule", { account: account.trim().toLowerCase(), id: rowIdOf(id), sendAt: at });
}

/** Send now: its time becomes now, and the sender goes at once. */
export async function sendScheduledDraftNow(account: string, id: string): Promise<void> {
  const invoke = invokeOrThrow();
  await invoke("mail_scheduled_send_now", { account: account.trim().toLowerCase(), id: rowIdOf(id) });
  await runScheduledSends();
}

// ---------------------------------------------------------------------------
// The sender
// ---------------------------------------------------------------------------

/** What a Gmail error means for a scheduled draft. */
export function gmailFailure(err: unknown): SendFailure {
  const status = (err as { status?: number } | null)?.status;
  if (status === 404) return "gone";
  // A message Gmail will not send: a bad address, a From no longer allowed.
  if (status === 400 || (status === 403 && !/rate|quota|limit/i.test(String((err as Error)?.message)))) {
    return "refused";
  }
  // Network, signed out (401), rate limits, Google's own trouble.
  return "retry";
}

/** What an Exchange error means. The Rust side has already answered "gone". */
export function exchangeFailure(err: unknown): SendFailure {
  const text = String((err as Error)?.message ?? err);
  // The server said no to this message. A refused password ("ews:refused")
  // is a sign-in to put right, not a message to give up on.
  if (text.startsWith("ews:fault") || text.includes("ews:invalid")) return "refused";
  return "retry";
}

async function sendOne(row: Row): Promise<"sent" | "gone"> {
  if (row.provider === "gmail") {
    try {
      await sendGmailDraft(await accessTokenFor(row.account), row.draftId);
      return "sent";
    } catch (err) {
      if (gmailFailure(err) === "gone") return "gone";
      throw err;
    }
  }
  const outcome = (await invokeOrThrow()("mail_ews_send_draft", { account: row.account, itemId: row.draftId })) as
    | "sent"
    | "gone";
  return outcome === "gone" ? "gone" : "sent";
}

let running: Promise<void> | null = null;

/**
 * Send every scheduled draft whose time has come. One run at a time; the
 * store's claim keeps a second copy of the app off the same rows.
 */
export function runScheduledSends(): Promise<void> {
  if (running) return running;
  running = (async () => {
    const invoke = tauriInvoke();
    if (!invoke) return;
    const rows = ((await invoke("mail_scheduled_take_due", {})) as Row[] | null) ?? [];
    for (const row of rows) {
      try {
        const outcome = await sendOne(row);
        if (outcome === "gone") {
          console.info(`[mail] a scheduled draft was no longer there; nothing was sent (${row.account})`);
          await invoke("mail_scheduled_failed", { id: row.id, failure: "gone", error: "draft gone" });
        } else {
          await invoke("mail_scheduled_done", { id: row.id });
        }
      } catch (err) {
        const failure = row.provider === "gmail" ? gmailFailure(err) : exchangeFailure(err);
        const error = String((err as Error)?.message ?? err).slice(0, 500);
        console.warn(`[mail] a scheduled send did not go (${failure}):`, error);
        await invoke("mail_scheduled_failed", { id: row.id, failure, error }).catch(() => undefined);
      }
    }
  })()
    .catch((err) => console.warn("[mail] the scheduled sender failed:", err))
    .finally(() => {
      running = null;
    });
  return running;
}

let started = false;

/**
 * Look for due messages now, every half minute, and when the network or
 * the window comes back (a computer waking from sleep). The main window
 * only. A look is cheap: one read of the local store.
 */
export function startScheduledSender(): void {
  if (started || !tauriInvoke()) return;
  started = true;
  void runScheduledSends();
  setInterval(() => void runScheduledSends(), LOOK_EVERY_MS);
  window.addEventListener("online", () => void runScheduledSends());
  window.addEventListener("focus", () => void runScheduledSends());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void runScheduledSends();
  });
}
