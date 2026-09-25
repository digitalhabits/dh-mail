/*
 * Helpers the inbox modules share: bounded concurrency, message dates,
 * Gmail's errors in the reader's words, RFC message ids, the contact
 * classifier (and its cache), and the summary of a Gmail thread as a list
 * row, with its calendar-invite checks.
 *
 * Part of the inbox core; lib/mail/inbox.ts re-exports what the rest of the
 * app uses, so callers import from there.
 */


import "server-only";

import { decodeSnippet, extractAttachments, getGmailAttachment, getMessageFull, headerValue, parseAddressList, isGmailRateLimit, type GmailMessage, type GmailThread } from "@/lib/gmail/api";
import {
  formatInviteChip,
  isCalendarAttachment,
  mimeTreeHasCalendar,
  parseCalendarInvite,
} from "@/lib/mail/ics";
import { loadCrmContacts, resetCrmGate } from "@/lib/mail/crm-gate";
import type { MailThreadSummary } from "@/lib/mail/types";
import type { ContactIndex, CrmRecordRef } from "@/lib/crm-contact-index";
import { type Classifier, classifyThread, crmLogoFor, crmNameFor, displayName } from "@/lib/mail/thread-classify";
import { registerMailFullCacheClear } from "@/lib/mail/inbox-cache";
import { PlanError } from "@/lib/plan/errors";
import { base64UrlToUtf8 } from "@/lib/base64";

const CONCURRENCY = 8;
// References and In-Reply-To ride along so a provider split can be adopted
// straight from the list — see docs/mail-chat-architecture.md.
export const METADATA_HEADERS = [
  "From",
  "To",
  "Cc",
  "Subject",
  "Date",
  "Message-ID",
  "References",
  "In-Reply-To",
  // How the list knows a thread carries a file. `format=metadata` answers
  // headers and no MIME tree, so the parts cannot be walked here — see
  // `gmailMessageHasFile`.
  "Content-Type",
];
/**
 * A message that carries a file somebody attached.
 *
 * The parts are read when they are there, which is exact. They are usually
 * not: the list asks Gmail for metadata, and that answers a payload with no
 * `parts` array. What it does answer is how the message was built, in both
 * `payload.mimeType` and the Content-Type header, so read that instead.
 *
 * `multipart/mixed` is an attachment beside the body; `multipart/related` is
 * a picture inside it, which a signature logo is; `multipart/alternative` is
 * the same body written twice.
 */
function gmailMessageHasFile(m: GmailMessage): boolean {
  const parts = extractAttachments(m, "");
  if (parts.length) return parts.some((a) => !isCalendarAttachment(a));
  const built = `${m.payload?.mimeType ?? ""} ${headerValue(m, "Content-Type")}`;
  return built.toLowerCase().includes("multipart/mixed");
}

/**
 * The name this message will be known by, everywhere it lands.
 *
 * Written by us rather than left to the provider. A message sent without
 * one is named by the server as it goes, so the same message sent twice —
 * which two workers over one outbox once managed — arrived under two
 * names, and nothing at either end could tell it was one message. With a
 * name of our own, a second copy folds into the first wherever messages
 * are folded by it, this app's own reader included.
 *
 * The domain is the sender's, which is what a receiving server expects to
 * see and what its checks are least surprised by.
 */
export function newRfcMessageId(account: string): string {
  const domain = account.split("@")[1]?.trim().toLowerCase() || "mail.invalid";
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "")
      : `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  return `<${Date.now().toString(36)}.${random}@${domain}>`;
}

/** Normalize RFC 822 Message-ID for snooze / cross-mailbox matching. */
export function normalizeRfcMessageId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed.replace(/^<|>$/g, "");
}

/** Surfaces Gmail's 403 (old readonly token) as an actionable message. */
export function translateGmailError(err: unknown, accountEmail: string): never {
  const status = (err as Error & { status?: number }).status;
  // Gmail says "over the limit" with a 403 as well, and reconnecting does
  // nothing for that. Said as what it is, so the reader waits instead.
  if (status === 403 && isGmailRateLimit(err)) {
    throw new PlanError(
      `Gmail is over its request limit for ${accountEmail}. Try again in a minute.`,
      429
    );
  }
  if (status === 403) {
    throw new PlanError(
      `The Gmail connection for ${accountEmail} is read-only — reconnect the account to enable sending and archiving.`,
      403
    );
  }
  throw err;
}

// ---------------------------------------------------------------------------
// People / everything-else classification (CRM contact matcher)
// ---------------------------------------------------------------------------

export let classifierCache: { value: Classifier; expiresAt: number } | null = null;
/** How long a list waits for the CRM before filing by address books. */
const CRM_WAIT_MS = 8_000;
/** One in-flight build — parallel /threads?account=… must not stampede Postgres. */
export let classifierInflight: Promise<Classifier> | null = null;
/**
 * The classifier is cached for the whole process, not per owner. On the planner
 * the CRM index is org-wide, so that is right. The public flavor reads one
 * user's address books, and that host has a single owner.
 */
export async function getClassifier(ownerId: string): Promise<Classifier> {
  if (classifierCache && classifierCache.expiresAt > Date.now()) {
    return classifierCache.value;
  }
  if (classifierInflight) return classifierInflight;

  classifierInflight = (async () => {
    let contacts: ContactIndex;
    let domains: Map<string, CrmRecordRef[]>;
    // Without the CRM the list still reads; the People tab is only
    // thinner. Short-lived, so the next refresh asks the CRM again.
    let withoutCrm = false;
    const crm = await loadCrmContacts();
    if (crm) {
      try {
        // Not for long: a planner that hangs would hold every list behind
        // it. Past this the address books answer and the next refresh asks
        // again.
        contacts = await Promise.race([
          crm.buildContactIndex(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("the CRM did not answer in time")), CRM_WAIT_MS)
          ),
        ]);
        domains = await crm.buildContactDomainIndex();
      } catch (err) {
        // The planner did not answer: a session being renewed, or the
        // server away. That is not a mailbox that cannot be read, which
        // is what failing here told the reader. File by the address
        // books instead, and say so once in the console.
        console.warn("[mail] CRM not reachable; filing by address books:", err);
        const people = await import("@/lib/mail/people-contacts");
        contacts = await people.buildPeopleContactIndex(ownerId);
        domains = new Map();
        withoutCrm = true;
      }
    } else {
      // Public: People = address-book emails only (no CRM org-domain matching).
      const people = await import("@/lib/mail/people-contacts");
      contacts = await people.buildPeopleContactIndex(ownerId);
      domains = new Map();
    }
    const value = { contacts, domains };
    classifierCache = {
      value,
      expiresAt: Date.now() + (withoutCrm ? 20 * 1000 : 5 * 60 * 1000),
    };
    return value;
  })().finally(() => {
    classifierInflight = null;
  });

  return classifierInflight;
}

// ---------------------------------------------------------------------------
// Concurrency helper
// ---------------------------------------------------------------------------

export async function mapWithConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(CONCURRENCY, items.length) },
    async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index]);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

export function messageDate(message: GmailMessage): number {
  const internal = Number(message.internalDate ?? 0);
  if (internal) return internal;
  const header = Date.parse(headerValue(message, "Date"));
  return Number.isFinite(header) ? header : 0;
}

/**
 * Invite detection is expensive (it probes full payloads of up to six
 * messages per meeting-looking thread), and a thread's invite status can
 * only change when a new message arrives — so memoize per latest message.
 */
const gmailCalendarCache = new Map<
  string,
  { hasCalendarInvite: boolean; calendarInviteWhen?: string }
>();
const GMAIL_CALENDAR_CACHE_MAX = 5000;
export async function summarizeGmailThread(options: {
  token: string;
  accountEmail: string;
  thread: GmailThread;
  classifier: Classifier;
  focusMessageId?: string;
  resolveCalendar?: boolean;
  /** Set on a row of the Snoozed list. */
  snoozedUntil?: string;
}): Promise<{
  summary: MailThreadSummary;
  latestRfcId: string;
  latestReferences?: string;
} | null> {
  const { token, accountEmail, thread, classifier, focusMessageId } = options;
  const threadMessages = [...(thread.messages ?? [])];
  if (threadMessages.length === 0) return null;

  threadMessages.sort((a, b) => messageDate(a) - messageDate(b));
  const latest = threadMessages[threadMessages.length - 1];

  const { tab, counterpart, externalParticipants } = classifyThread({
    accountEmail,
    participants: threadMessages.flatMap((m) => [
      ...parseAddressList(headerValue(m, "From")),
      ...parseAddressList(headerValue(m, "To")),
      ...parseAddressList(headerValue(m, "Cc")),
    ]),
    senders: threadMessages.flatMap((m) =>
      parseAddressList(headerValue(m, "From")).slice(0, 1)
    ),
    latestFrom: parseAddressList(headerValue(latest, "From"))[0],
    latestTo: parseAddressList(headerValue(latest, "To")),
    classifier,
  });

  const subject = headerValue(latest, "Subject").trim() || "(no subject)";
  const snippet = decodeSnippet(latest.snippet ?? "");
  const calKey = `${accountEmail}|${thread.id}|${latest.id}`;
  let cal =
    options.resolveCalendar === false
      ? { hasCalendarInvite: false as const }
      : gmailCalendarCache.get(calKey);
  if (!cal) {
    cal = await resolveGmailCalendarInvite(
      token,
      threadMessages,
      latest,
      subject,
      snippet
    );
    if (gmailCalendarCache.size >= GMAIL_CALENDAR_CACHE_MAX) {
      const oldest = gmailCalendarCache.keys().next().value;
      if (oldest != null) gmailCalendarCache.delete(oldest);
    }
    gmailCalendarCache.set(calKey, cal);
  }

  return {
    summary: {
      account: accountEmail,
      threadId: thread.id,
      subject,
      fromName: displayName(counterpart),
      fromEmail: counterpart.email,
      snippet,
      lastAt: new Date(messageDate(latest)).toISOString(),
      unread: threadMessages.some((m) =>
        (m.labelIds ?? []).includes("UNREAD")
      ),
      messageCount: threadMessages.length,
      tab,
      externalParticipants,
      crmName: crmNameFor(counterpart.email, classifier),
      crmLogoUrl: crmLogoFor(counterpart.email, classifier),
      ...(focusMessageId ? { focusMessageId } : null),
      ...(options.snoozedUntil ? { snoozedUntil: options.snoozedUntil } : null),
      // A file somebody attached, not a logo in a signature. Reading the
      // parts costs nothing here: the metadata is already in hand.
      ...(threadMessages.some(gmailMessageHasFile)
        ? { hasAttachments: true }
        : null),
      ...(cal.hasCalendarInvite
        ? {
            hasCalendarInvite: true,
            ...(cal.calendarInviteWhen
              ? { calendarInviteWhen: cal.calendarInviteWhen }
              : null),
          }
        : null),
    },
    latestRfcId: headerValue(latest, "Message-ID").trim(),
    latestReferences:
      [headerValue(latest, "References"), headerValue(latest, "In-Reply-To")]
        .join(" ")
        .trim() || undefined,
  };
}

function gmailMessageLooksLikeInvite(
  subject: string,
  snippet: string
): boolean {
  return /invite|attend|rsvp|teams meeting|zoom\.|meet\.google|icalendar|\.ics|calendar|meeting request/i.test(
    `${subject}\n${snippet}`
  );
}

function gmailHasCalendarPart(m: GmailMessage): boolean {
  if (mimeTreeHasCalendar(m.payload)) return true;
  if (extractAttachments(m, "").some(isCalendarAttachment)) return true;
  return headerValue(m, "Content-Type").toLowerCase().includes("text/calendar");
}

/** Detect .ics / meeting parts and parse a short when-label for the list chip. */
async function resolveGmailCalendarInvite(
  token: string,
  threadMessages: GmailMessage[],
  _latest: GmailMessage,
  _subject: string,
  _snippet: string
): Promise<{ hasCalendarInvite: boolean; calendarInviteWhen?: string }> {
  const calendarAtt = (m: GmailMessage) =>
    extractAttachments(m, "").find(isCalendarAttachment);

  let host =
    threadMessages.find((m) => gmailHasCalendarPart(m)) ?? null;

  // Metadata often omits nested MIME parts. Invites usually sit on an older
  // message while the list tip is a later reply — so scan oldest-first with
  // full payloads when the thread looks meeting-related (or is short).
  if (!host) {
    const looksMeeting =
      threadMessages.length <= 4 ||
      threadMessages.some((m) =>
        gmailMessageLooksLikeInvite(
          headerValue(m, "Subject"),
          m.snippet ?? ""
        )
      );
    if (looksMeeting) {
      for (const m of threadMessages.slice(0, 6)) {
        if (gmailHasCalendarPart(m)) {
          host = m;
          break;
        }
        const full = await getMessageFull(token, m.id).catch(() => null);
        if (full && gmailHasCalendarPart(full)) {
          host = full;
          break;
        }
      }
    }
  }

  if (!host) return { hasCalendarInvite: false };

  const att = calendarAtt(host);
  if (!att) return { hasCalendarInvite: true };

  try {
    const { data } = await getGmailAttachment(
      token,
      host.id,
      att.attachmentId
    );
    const text = base64UrlToUtf8(data);
    const parsed = parseCalendarInvite(text);
    const when = parsed ? formatInviteChip(parsed) : null;
    return {
      hasCalendarInvite: true,
      ...(when ? { calendarInviteWhen: when } : null),
    };
  } catch {
    return { hasCalendarInvite: true };
  }
}

registerMailFullCacheClear(() => {
  classifierCache = null;
  classifierInflight = null;
  resetCrmGate();
});
