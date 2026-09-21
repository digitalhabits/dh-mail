import { localStoreServes } from "@/lib/mail/local-store";
import "server-only";

import { mailStore } from "@/lib/mail/store";
import type { MailProvider } from "@/lib/mail/types";
import {
  getMessageMetadata,
  headerValue,
  listMessageIds,
  parseAddressList,
} from "@/lib/gmail/api";
import { accessTokenFor } from "@/lib/mail/mail-gmail-token";
import { outlookAccessTokenFor } from "@/lib/mail/outlook-inbox";
import { listConnectedMailAccounts } from "@/lib/mail/providers";
import {
  graphAddresses,
  listOutlookContacts,
  listOutlookMessages,
} from "@/lib/outlook/api";
import { isOwnOrgAddress } from "@/lib/own-addresses";
import type {
  MailContactSourceSummary,
  MailContactSuggestion,
} from "@/lib/mail/contact-suggestion";
import { loadCrmContacts, loadTeamRoster } from "@/lib/mail/crm-gate";
import { mailUsesCrmPeople } from "@/lib/mail/product-flavor";
import {
  macContactsAuthorization,
  macContactsList,
  type MacContactsStatus,
} from "@/lib/native-shell";

/**
 * Compose-field contact sources beyond the CRM: read-only mirrors of the
 * connected accounts' Google/Outlook address books, plus "mail history"
 * (addresses you've written to, from sent mail). Synced on demand into
 * mail_source_contacts (migration 024); mail only reads them — editing
 * happens at the source.
 */

export type MailSourceKind = "google" | "outlook" | "history" | "mac";

/**
 * The Mac address book is the machine's, not a mailbox's, so its rows carry an
 * empty account — the same as the key it is toggled by.
 */
const MAC_ACCOUNT = "";

/** History scan limits: recent sent mail only, capped per run. */
const HISTORY_LOOKBACK = "1y";
const HISTORY_MAX_GMAIL_MESSAGES = 500;
const HISTORY_MAX_OUTLOOK_PAGES = 5;

// ---------------------------------------------------------------------------
// Enabled/disabled toggles (app_settings)
// ---------------------------------------------------------------------------

const SETTINGS_KEY = "mail_contact_sources";

/**
 * Source keys: 'crm', 'history', 'google:<account>', 'outlook:<account>'.
 * Everything is enabled unless listed in `disabled`.
 */
export type ContactSourceSettings = { disabled: string[] };

export async function getContactSourceSettings(): Promise<ContactSourceSettings> {
  const raw = await mailStore().settings.get(SETTINGS_KEY);
  if (!raw) return { disabled: [] };
  try {
    const parsed = JSON.parse(raw) as ContactSourceSettings;
    return { disabled: Array.isArray(parsed.disabled) ? parsed.disabled : [] };
  } catch {
    return { disabled: [] };
  }
}

export async function setContactSourceEnabled(
  key: string,
  enabled: boolean
): Promise<ContactSourceSettings> {
  const settings = await getContactSourceSettings();
  const disabled = new Set(settings.disabled);
  if (enabled) disabled.delete(key);
  else disabled.add(key);
  const next = { disabled: [...disabled] };
  await mailStore().settings.set(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

export function sourceKey(kind: MailSourceKind | "crm", account?: string): string {
  // crm, history and mac each present as one source, so each is its own key.
  return kind === "crm" || kind === "history" || kind === "mac"
    ? kind
    : `${kind}:${account}`;
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A 403 that means "come back later", not "you may not". */
function isRateLimit(err: unknown): boolean {
  return /ratelimitexceeded|userratelimitexceeded|quota exceeded|too many requests|over its request limit/i.test(
    errorMessage(err)
  );
}

/** True when the OAuth token is missing contacts scopes (user must reconnect). */
function isScopeError(err: unknown): boolean {
  // Google says "over the limit" with a 403 too. Told to reconnect for
  // that, the reader reconnects, and nothing changes — see the mail list.
  if (isRateLimit(err)) return false;
  const message = errorMessage(err).toLowerCase();
  // People API disabled on the GCP project is also a 403 — not a reconnect issue.
  if (
    message.includes("service_disabled") ||
    message.includes("has not been used in project") ||
    message.includes("it is disabled")
  ) {
    return false;
  }
  const status = (err as Error & { status?: number }).status;
  return (
    status === 403 ||
    message.includes("insufficient") ||
    message.includes("access_token_scope") ||
    message.includes("accessdenied") ||
    message.includes("access denied")
  );
}

/** Turn opaque upstream errors into something actionable in Contact sources. */
function friendlyContactSyncError(err: unknown): string {
  const message = errorMessage(err);
  const lower = message.toLowerCase();
  if (isRateLimit(err)) {
    return "Google is over its request limit for this account. Sync again in a minute.";
  }
  if (isScopeError(err)) {
    return "Reconnect this account to grant contacts access";
  }
  if (
    lower.includes("service_disabled") ||
    lower.includes("has not been used in project") ||
    lower.includes("people api")
  ) {
    return "Google People API is disabled on this app’s Cloud project — enable people.googleapis.com, then Sync now";
  }
  // Keep the People API status line; drop the huge JSON blob.
  const people = message.match(/People API failed \((\d+)\):\s*(.*)/s);
  if (people) {
    try {
      const json = JSON.parse(people[2]) as { error?: { message?: string } };
      if (json.error?.message) {
        return `People API (${people[1]}): ${json.error.message.slice(0, 180)}`;
      }
    } catch {
      /* fall through */
    }
  }
  return message.slice(0, 240);
}

/** Clear a prior contacts-scope error after the user reconnects OAuth. */
export async function clearContactSourceError(
  source: "google" | "outlook",
  account: string
): Promise<void> {
  await mailStore().contactSources.clearError(source, account.toLowerCase());
}

async function saveState(
  source: MailSourceKind,
  account: string,
  update: { count?: number; error?: string | null; synced?: boolean }
): Promise<void> {
  await mailStore().contactSources.saveState(source, account, update);
}

/** Replace the mirror rows for one provider source (full re-sync). */
async function replaceSourceRows(
  source: "google" | "outlook",
  account: string,
  rows: { email: string; name: string; card?: string }[]
): Promise<void> {
  await mailStore().contactSources.replaceContacts(source, account, rows);
}

/**
 * Sync one Google mailbox’s address book (used after OAuth reconnect so the
 * Contact sources panel updates without waiting for Sync now).
 */
export async function syncGoogleContactsForAccount(
  account: string
): Promise<SyncProgress> {
  try {
    await syncGoogleContacts(account);
    return { source: "google", account, ok: true };
  } catch (err) {
    const message = friendlyContactSyncError(err);
    await saveState("google", account, { error: message });
    return { source: "google", account, ok: false, error: message };
  }
}

/** Google People API: the account's saved contacts. */
async function syncGoogleContacts(account: string): Promise<void> {
  const token = await accessTokenFor(account);
  // The card is the book's own id for the person, kept so two addresses on
  // one card read as one person in the People view.
  const byEmail = new Map<string, { name: string; card?: string }>();
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      personFields: "names,emailAddresses",
      pageSize: "1000",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetch(
      `https://people.googleapis.com/v1/people/me/connections?${params}`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
    );
    if (!res.ok) {
      const detail = await res.text();
      const err = new Error(`People API failed (${res.status}): ${detail.slice(0, 200)}`);
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }
    const data = (await res.json()) as {
      connections?: {
        resourceName?: string;
        names?: { displayName?: string }[];
        emailAddresses?: { value?: string }[];
      }[];
      nextPageToken?: string;
    };
    for (const person of data.connections ?? []) {
      const name = person.names?.[0]?.displayName?.trim() ?? "";
      const card = person.resourceName?.trim() || undefined;
      for (const addr of person.emailAddresses ?? []) {
        const email = addr.value?.trim().toLowerCase();
        if (!email || !email.includes("@")) continue;
        if (!byEmail.get(email)) byEmail.set(email, { name, card });
      }
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  const rows = [...byEmail.entries()].map(([email, row]) => ({ email, ...row }));
  await replaceSourceRows("google", account, rows);
  await saveState("google", account, { count: rows.length, error: null, synced: true });
}

/** Microsoft Graph: the account's Outlook contacts. */
async function syncOutlookContacts(account: string): Promise<void> {
  const token = await outlookAccessTokenFor(account);
  const byEmail = new Map<string, { name: string; card?: string }>();
  let pageToken: string | undefined;
  do {
    const page = await listOutlookContacts(token, pageToken);
    for (const contact of page.contacts) {
      const name = contact.displayName?.trim() ?? "";
      const card = contact.id?.trim() || undefined;
      for (const addr of contact.emailAddresses ?? []) {
        const email = addr.address?.trim().toLowerCase();
        if (!email || !email.includes("@")) continue;
        if (!byEmail.get(email)) byEmail.set(email, { name, card });
      }
    }
    pageToken = page.nextPageToken;
  } while (pageToken);

  const rows = [...byEmail.entries()].map(([email, row]) => ({ email, ...row }));
  await replaceSourceRows("outlook", account, rows);
  await saveState("outlook", account, { count: rows.length, error: null, synced: true });
}

// ---------------------------------------------------------------------------
// Mac address book
// ---------------------------------------------------------------------------

/** True when macOS has granted enough to read something. */
function macGranted(status: MacContactsStatus): boolean {
  // "limited" means the reader picked some contacts rather than all. Mail
  // reads what it is given, which is not a failure.
  return status === "authorized" || status === "limited";
}

/** What the panel says when macOS has not granted access. */
function macAccessMessage(status: MacContactsStatus): string {
  if (status === "denied") {
    return "Allow Contacts in System Settings, then Sync now";
  }
  if (status === "restricted") {
    return "A profile on this Mac blocks Contacts access";
  }
  if (status === "notDetermined") {
    return "Turn this source on to allow Contacts access";
  }
  return "Contacts is not available in this build";
}

/**
 * Mirror the Mac address book.
 *
 * One row per address, so a contact with a home and a work address gives two.
 * Nothing is written back — editing happens in Contacts.app.
 */
async function syncMacContacts(): Promise<void> {
  const status = await macContactsAuthorization();
  if (status !== "authorized" && status !== "limited") {
    throw new Error(macAccessMessage(status));
  }
  const byEmail = new Map<string, { name: string; card?: string }>();
  for (const contact of await macContactsList()) {
    const email = contact.email.trim().toLowerCase();
    if (!email || !email.includes("@")) continue;
    // The first name wins, the same rule the other address books follow.
    if (!byEmail.get(email)) {
      byEmail.set(email, {
        name: contact.name.trim(),
        card: contact.card?.trim() || undefined,
      });
    }
  }
  const rows = [...byEmail.entries()].map(([email, row]) => ({ email, ...row }));
  await mailStore().contactSources.replaceContacts("mac", MAC_ACCOUNT, rows);
  await saveState("mac", MAC_ACCOUNT, {
    count: rows.length,
    error: null,
    synced: true,
  });
}

type HistoryEntry = { name: string; lastAt: number };

function noteRecipient(
  entries: Map<string, HistoryEntry>,
  email: string,
  name: string,
  at: number,
  selfAccount: string
): void {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) return;
  if (normalized === selfAccount || isOwnOrgAddress(normalized)) return;
  const existing = entries.get(normalized);
  if (!existing) {
    entries.set(normalized, { name: name.trim(), lastAt: at });
    return;
  }
  if (at > existing.lastAt) existing.lastAt = at;
  if (!existing.name && name.trim()) existing.name = name.trim();
}

/**
 * Who the mailbox wrote to, from the local copy: a query, no reads. Null
 * when the copy does not serve this mailbox, so the scan of sent mail
 * over the API still answers.
 */
async function collectFromLocalCopy(account: string): Promise<Map<string, HistoryEntry> | null> {
  if (!(await localStoreServes(account))) return null;
  const since = Date.now() - 365 * 24 * 3600 * 1000;
  const rows = await mailStore().messages.recipients(account, since);
  const entries = new Map<string, HistoryEntry>();
  for (const row of rows) {
    noteRecipient(entries, row.email, row.name, row.lastAt, account);
  }
  return entries;
}

async function collectGmailHistory(
  account: string
): Promise<Map<string, HistoryEntry>> {
  const token = await accessTokenFor(account);
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = await listMessageIds(
      token,
      `in:sent newer_than:${HISTORY_LOOKBACK}`,
      pageToken
    );
    ids.push(...page.ids);
    pageToken =
      ids.length < HISTORY_MAX_GMAIL_MESSAGES ? page.nextPageToken : undefined;
  } while (pageToken);

  const entries = new Map<string, HistoryEntry>();
  const limited = ids.slice(0, HISTORY_MAX_GMAIL_MESSAGES);
  /*
    Paced, so the scan shares the minute.

    Five hundred message reads is two and a half thousand units, and
    Google allows a mailbox six thousand a minute. Read in one go, as it
    was, the scan took most of the minute's allowance in a few seconds
    and the inbox behind it was refused. Read thirty at a time with six
    seconds between chunks, it spends fifteen hundred a minute and is
    done inside two minutes — a background job's pace, which is what it
    is. The client's own allowance (see gmail/api) is the hard stop
    under this.
  */
  const CHUNK = 30;
  const CHUNK_MS = 6_000;
  for (let start = 0; start < limited.length; start += CHUNK) {
    const chunk = limited.slice(start, start + CHUNK);
    const began = Date.now();
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(6, chunk.length) }, async () => {
        while (next < chunk.length) {
          const id = chunk[next++];
          try {
            const message = await getMessageMetadata(token, id, ["To", "Cc"]);
            const at = Number(message.internalDate ?? 0);
            for (const header of ["To", "Cc"]) {
              for (const addr of parseAddressList(headerValue(message, header))) {
                noteRecipient(entries, addr.email, addr.name, at, account);
              }
            }
          } catch {
            // Skip unreadable messages; the scan is best-effort.
          }
        }
      })
    );
    if (start + CHUNK < limited.length) {
      const elapsed = Date.now() - began;
      if (elapsed < CHUNK_MS) {
        await new Promise((resolve) => setTimeout(resolve, CHUNK_MS - elapsed));
      }
    }
  }
  return entries;
}

async function collectOutlookHistory(
  account: string
): Promise<Map<string, HistoryEntry>> {
  const token = await outlookAccessTokenFor(account);
  const entries = new Map<string, HistoryEntry>();
  let pageToken: string | undefined;
  for (let page = 0; page < HISTORY_MAX_OUTLOOK_PAGES; page++) {
    const result = await listOutlookMessages(token, {
      folder: "sentitems",
      top: 100,
      pageToken,
    });
    for (const message of result.messages) {
      if (message.isDraft) continue;
      const at = Date.parse(message.sentDateTime ?? "") || 0;
      for (const addr of [
        ...graphAddresses(message.toRecipients),
        ...graphAddresses(message.ccRecipients),
      ]) {
        noteRecipient(entries, addr.email, addr.name, at, account);
      }
    }
    pageToken = result.nextPageToken;
    if (!pageToken) break;
  }
  return entries;
}

/** Accumulative upsert: preserves `hidden`, keeps the latest send time. */
async function upsertHistoryRows(
  account: string,
  entries: Map<string, HistoryEntry>
): Promise<number> {
  await mailStore().contactSources.mergeHistoryContacts(
    account,
    [...entries].map(([email, entry]) => ({
      email,
      name: entry.name,
      lastEmailedAt: entry.lastAt
        ? new Date(entry.lastAt).toISOString()
        : null,
    }))
  );
  return mailStore().contactSources.countVisibleHistory(account);
}

/**
 * Who this mailbox wrote to, into the history rows.
 *
 * The copy answers first, whichever provider the mailbox is: one query
 * against rows the app already holds, against hundreds of calls to read
 * the same sent mail over the provider's API. The Outlook side asked
 * Graph even where the copy could have answered, for no reason beyond the
 * order the two were written in.
 *
 * The rows are merged, never replaced, so a copy that is still filling
 * takes nothing away from what an earlier scan found.
 */
async function syncHistory(
  provider: MailProvider,
  account: string
): Promise<void> {
  const entries =
    (await collectFromLocalCopy(account)) ??
    (provider === "gmail"
      ? await collectGmailHistory(account)
      : await collectOutlookHistory(account));
  const count = await upsertHistoryRows(account, entries);
  await saveState("history", account, { count, error: null, synced: true });
}

export type SyncProgress = {
  source: MailSourceKind;
  account: string;
  ok: boolean;
  error?: string;
};

export type SyncContactSourcesOptions = {
  /** Only sync address books for mailboxes this local owner connected. */
  clerkUserId: string;
  /**
   * Whether to read sent-mail history over the provider's API, which is
   * hundreds of calls per account. False for the background “if stale”
   * pass that fires from compose: that one still refreshes history for
   * every mailbox the local copy serves, because there it is one query.
   */
  includeHistory?: boolean;
  onProgress?: (progress: SyncProgress) => void;
};

/** Prevent compose + Sync now from overlapping and melting the dev server. */
let syncInFlight: Promise<SyncProgress[]> | null = null;

/**
 * Sync enabled address books (and optionally mail history) for every mailbox
 * the signed-in user connected. Best-effort: one account’s 403 doesn’t stop
 * the rest.
 */
export async function syncAllContactSources(
  options: SyncContactSourcesOptions
): Promise<SyncProgress[]> {
  if (syncInFlight) return syncInFlight;

  const includeHistory = options.includeHistory ?? true;
  const onProgress = options.onProgress;

  syncInFlight = (async () => {
    const [accounts, settings] = await Promise.all([
      listConnectedMailAccounts(options.clerkUserId),
      getContactSourceSettings(),
    ]);
    const disabled = new Set(settings.disabled);
    const results: SyncProgress[] = [];

    const run = async (
      source: MailSourceKind,
      account: string,
      fn: () => Promise<void>
    ) => {
      try {
        await fn();
        results.push({ source, account, ok: true });
      } catch (err) {
        const message = friendlyContactSyncError(err);
        await saveState(source, account, { error: message });
        results.push({ source, account, ok: false, error: message });
      }
      onProgress?.(results[results.length - 1]);
    };

    // Address books first (fast) — these power compose To.
    for (const account of accounts) {
      if (account.provider === "gmail") {
        if (!disabled.has(sourceKey("google", account.email))) {
          await run("google", account.email, () =>
            syncGoogleContacts(account.email)
          );
        }
      } else if (!disabled.has(sourceKey("outlook", account.email))) {
        await run("outlook", account.email, () =>
          syncOutlookContacts(account.email)
        );
      }
    }

    // The Mac book is not a mailbox's, so it syncs once rather than per
    // account. It is fast, so it runs in the background pass too.
    //
    // Nothing is attempted before macOS grants access. A refusal to read a
    // book the reader never opened is not a sync error, and recording it as
    // one puts a red line under a source that is behaving correctly.
    if (!disabled.has("mac") && macGranted(await macContactsAuthorization())) {
      await run("mac", MAC_ACCOUNT, syncMacContacts);
    }

    /*
      History, from the copy in the background and from anywhere on demand.

      A scan of sent mail over the provider's API is hundreds of calls, so
      it belongs to Sync now and not to the pass that fires from compose.
      That left the history rows as old as the last time somebody pressed
      the button: a person written to since then was offered by nothing,
      and the reader typed the address out again each time.

      The copy answers the same question with one query, so for a mailbox
      the copy serves there is nothing to save by waiting. Mailboxes the
      copy does not serve still wait for Sync now.
    */
    if (!disabled.has("history")) {
      for (const account of accounts) {
        if (!includeHistory && !(await localStoreServes(account.email))) {
          continue;
        }
        await run("history", account.email, () =>
          syncHistory(
            account.provider === "gmail" ? "gmail" : "outlook",
            account.email
          )
        );
      }
    }

    return results;
  })().finally(() => {
    syncInFlight = null;
  });

  return syncInFlight;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type ContactSourceStatus = {
  key: string;
  kind: "crm" | MailSourceKind;
  /** Account email for per-account sources; empty for crm/history. */
  account: string;
  count: number;
  syncedAt: string | null;
  lastError: string | null;
  enabled: boolean;
  /**
   * The source is wanted, but the operating system has not allowed it.
   *
   * "ask" means macOS has no answer yet and Mail can still ask. "settings"
   * means it has one, and only System Settings can change it. Null when there
   * is nothing in the way — which is every source but the Mac address book.
   */
  needsAccess?: "ask" | "settings" | null;
};

/**
 * How many contact addresses the CRM holds, or none on a build without it.
 *
 * The gate decides. This file must not import the planner CRM, or every build
 * carries it.
 */
async function countCrmContactEmails(): Promise<number> {
  const crm = await loadCrmContacts();
  if (!crm) return 0;
  try {
    return await crm.countCrmContactEmails();
  } catch {
    return 0;
  }
}

function shortAccountLabel(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local.length > 18 ? `${local.slice(0, 16)}…` : local;
}

/** Panel data: every source with count, sync time, error, and toggle state. */
export async function listContactSourceStatuses(
  clerkUserId: string
): Promise<ContactSourceStatus[]> {
  const [accounts, settings, crmCount, states] = await Promise.all([
    listConnectedMailAccounts(clerkUserId),
    getContactSourceSettings(),
    countCrmContactEmails(),
    mailStore().contactSources.listState(),
  ]);
  const disabled = new Set(settings.disabled);
  const stateFor = (source: string, account: string) =>
    states.find((s) => s.source === source && s.account === account);

  const statuses: ContactSourceStatus[] = [];

  // Public Mail has no ReDD CRM — People filing uses Google/Outlook contacts.
  if (mailUsesCrmPeople()) {
    statuses.push({
      key: "crm",
      kind: "crm",
      account: "",
      count: crmCount,
      syncedAt: null,
      lastError: null,
      enabled: !disabled.has("crm"),
    });
  }

  for (const account of accounts) {
    const kind = account.provider === "gmail" ? "google" : "outlook";
    const state = stateFor(kind, account.email);
    statuses.push({
      key: sourceKey(kind, account.email),
      kind,
      account: account.email,
      count: state?.itemCount ?? 0,
      syncedAt: state?.syncedAt ?? null,
      lastError: state?.lastError ?? null,
      enabled: !disabled.has(sourceKey(kind, account.email)),
    });
  }

  // The Mac book only appears on a build that can read it. Offering a source
  // that could never sync would be a row that does nothing but fail.
  const macStatus = await macContactsAuthorization();
  if (macStatus !== "unavailable") {
    const state = stateFor("mac", MAC_ACCOUNT);
    const granted = macGranted(macStatus);
    statuses.push({
      key: "mac",
      kind: "mac",
      account: "",
      count: state?.itemCount ?? 0,
      syncedAt: state?.syncedAt ?? null,
      // A missing permission is not a sync failure, so it is not reported as
      // one. `needsAccess` says which of the two ways out the reader has.
      lastError: granted ? (state?.lastError ?? null) : null,
      // On unless it was turned off, the same as every other source. Whether
      // macOS allows it is a separate fact, and conflating the two made the
      // row say "On" and "not allowed" at once.
      enabled: !disabled.has("mac"),
      needsAccess: granted
        ? null
        : macStatus === "notDetermined"
          ? "ask"
          : "settings",
    });
  }

  // History presents as one source; counts/sync roll up across this user's
  // mailboxes only.
  const ownedEmails = new Set(accounts.map((a) => a.email.toLowerCase()));
  const historyStates = states.filter(
    (state) =>
      state.source === "history" &&
      ownedEmails.has(state.account.toLowerCase())
  );
  statuses.push({
    key: "history",
    kind: "history",
    account: "",
    count: historyStates.reduce((n, state) => n + state.itemCount, 0),
    syncedAt:
      historyStates
        .map((state) => state.syncedAt)
        .filter((at): at is string => Boolean(at))
        .sort()
        .at(-1) ?? null,
    lastError: historyStates.find((state) => state.lastError)?.lastError ?? null,
    enabled: !disabled.has("history"),
  });

  return statuses;
}

export type SourceSuggestion = {
  email: string;
  name: string;
  kind: MailSourceKind;
  account: string;
  lastEmailedAt: string | null;
};

/**
 * Provider + history suggestions from the signed-in user's mailboxes, deduped
 * by email with google > outlook > history precedence.
 */
export async function listSourceSuggestions(
  clerkUserId: string
): Promise<SourceSuggestion[]> {
  const [settings, accounts] = await Promise.all([
    getContactSourceSettings(),
    listConnectedMailAccounts(clerkUserId),
  ]);
  const owned = new Set(accounts.map((a) => a.email.toLowerCase()));
  if (!owned.size) return [];
  const disabled = new Set(settings.disabled);
  const rows = await mailStore().contactSources.listVisible([...owned]);
  const byEmail = new Map<string, SourceSuggestion>();
  for (const row of rows) {
    const key =
      row.source === "history" ? "history" : sourceKey(row.source, row.account);
    if (disabled.has(key)) continue;
    const existing = byEmail.get(row.email);
    if (!existing) {
      byEmail.set(row.email, {
        email: row.email,
        name: row.name,
        kind: row.source,
        account: row.account,
        lastEmailedAt: row.lastEmailedAt,
      });
    } else {
      if (!existing.name && row.name) existing.name = row.name;
      if (
        row.lastEmailedAt &&
        (!existing.lastEmailedAt || row.lastEmailedAt > existing.lastEmailedAt)
      ) {
        existing.lastEmailedAt = row.lastEmailedAt;
      }
    }
  }
  return [...byEmail.values()];
}

/** Hide a history suggestion for good (the "remove" affordance). */
export async function hideHistorySuggestion(email: string): Promise<void> {
  await mailStore().contactSources.hideHistoryContact(
    email.trim().toLowerCase()
  );
}


/**
 * Merged compose suggestions: CRM (when enabled) + Org/Team roster, then
 * google > outlook > history, plus every connected mailbox so “email yourself”
 * is always a typeahead hit. One row per email.
 */
export async function listMergedMailContacts(
  clerkUserId: string
): Promise<MailContactSuggestion[]> {
  const settings = await getContactSourceSettings();
  const disabled = new Set(settings.disabled);
  const byEmail = new Map<string, MailContactSuggestion>();

  const crm = disabled.has("crm") ? null : await loadCrmContacts();
  if (crm) {
    for (const contact of await crm.listCrmRecipientSuggestions()) {
      byEmail.set(contact.email, {
        email: contact.email,
        name: contact.name,
        recordName: contact.recordName,
        source: "crm",
      });
    }
  }

  // Team roster is a planner/internal aid — skip on public builds.
  const team = await loadTeamRoster();
  if (team) {
    try {
      for (const contact of await team.listTeamRecipientSuggestions()) {
        byEmail.set(contact.email, {
          email: contact.email,
          name: contact.name,
          recordName: "Team",
          source: "team",
        });
      }
    } catch (err) {
      console.warn("[mail] team recipient suggestions failed:", err);
    }
  }

  try {
    for (const row of await listSourceSuggestions(clerkUserId)) {
      const existing = byEmail.get(row.email);
      if (existing) {
        if (!existing.name && row.name) existing.name = row.name;
        if (
          row.lastEmailedAt &&
          (!existing.lastEmailedAt ||
            row.lastEmailedAt > (existing.lastEmailedAt ?? ""))
        ) {
          existing.lastEmailedAt = row.lastEmailedAt;
        }
        continue;
      }
      byEmail.set(row.email, {
        email: row.email,
        name: row.name,
        recordName: "",
        source: row.kind,
        account: row.account,
        lastEmailedAt: row.lastEmailedAt,
      });
    }
  } catch (err) {
    // Migration 024 not applied yet — CRM-only suggestions still work.
    console.error("[contact-sources] source suggestions failed:", err);
  }

  // Connected inboxes are not contacts/history — inject them so To/Cc can
  // complete to “email yourself” without waiting for a prior send.
  try {
    const mailboxes = await listConnectedMailAccounts(clerkUserId);
    for (const mailbox of mailboxes) {
      const email = mailbox.email.trim().toLowerCase();
      if (!email.includes("@")) continue;
      const existing = byEmail.get(email);
      if (existing) {
        if (!existing.name) existing.name = "You";
        if (!existing.recordName) existing.recordName = "Your mailbox";
        continue;
      }
      byEmail.set(email, {
        email,
        name: "You",
        recordName: "Your mailbox",
        source: "self",
        account: email,
      });
    }
  } catch (err) {
    console.warn("[mail] own-mailbox suggestions failed:", err);
  }

  return [...byEmail.values()].sort((a, b) => {
    // Own mailboxes first when names otherwise collide alphabetically.
    if (a.source === "self" && b.source !== "self") return -1;
    if (b.source === "self" && a.source !== "self") return 1;
    const aKey = a.name || a.email;
    const bKey = b.name || b.email;
    return aKey.localeCompare(bKey, undefined, { sensitivity: "base" });
  });
}

/** Compact enabled-source labels for the typeahead footer. */
export async function listEnabledSourceSummaries(
  clerkUserId: string
): Promise<MailContactSourceSummary[]> {
  const statuses = await listContactSourceStatuses(clerkUserId);
  return statuses
    .filter((s) => s.enabled)
    .map((s) => {
      const needsReconnect = Boolean(
        s.lastError?.toLowerCase().includes("reconnect")
      );
      let label: string;
      if (s.kind === "crm") label = "CRM";
      else if (s.kind === "history") label = "your mail history";
      else if (s.kind === "mac") label = "Mac Contacts";
      else if (s.kind === "google") {
        label = needsReconnect
          ? `Google (${shortAccountLabel(s.account)}, reconnect)`
          : `Google (${shortAccountLabel(s.account)})`;
      } else {
        label = needsReconnect
          ? `Outlook (${shortAccountLabel(s.account)}, reconnect)`
          : s.account
            ? `Outlook (${shortAccountLabel(s.account)})`
            : "Outlook";
      }
      return {
        key: s.key,
        kind: s.kind,
        label,
        enabled: s.enabled,
        needsReconnect,
      };
    });
}

/**
 * True when a provider address book still needs a first sync attempt.
 * Skips history (slow) and accounts that already need reconnect for scopes.
 */
/**
 * How long history from the copy may stand before compose refreshes it.
 *
 * The pass that fires from compose is cheap for these mailboxes — one
 * query each — so this is short. It is not zero: a compose opened twice
 * in a minute must not redo the work twice.
 */
const COPY_HISTORY_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Is there a mailbox whose history the copy can refresh, and has not lately?
 *
 * The pass from compose used to ask one question: has any source never
 * synced? Once every source had synced once, the answer was no for good,
 * and history stopped moving — the rows stayed as old as the last time
 * somebody pressed Sync now. An address written to after that was offered
 * by nothing, and the reader typed it out again every time.
 *
 * Only mailboxes the copy serves count. For the rest, reading sent mail is
 * hundreds of calls to the provider, which is Sync now's work and not
 * something to do behind a reader who is starting a message.
 */
export async function hasStaleCopyHistory(
  clerkUserId: string
): Promise<boolean> {
  const settings = await getContactSourceSettings();
  if (new Set(settings.disabled).has("history")) return false;
  const accounts = await listConnectedMailAccounts(clerkUserId);
  if (!accounts.length) return false;
  const states = await mailStore().contactSources.listState();
  const cutoff = Date.now() - COPY_HISTORY_MAX_AGE_MS;
  for (const account of accounts) {
    if (!(await localStoreServes(account.email))) continue;
    const state = states.find(
      (row) =>
        row.source === "history" &&
        row.account.toLowerCase() === account.email.toLowerCase()
    );
    const at = state?.syncedAt ? Date.parse(state.syncedAt) : 0;
    if (!at || Number.isNaN(at) || at < cutoff) return true;
  }
  return false;
}

export async function hasUnsyncedContactSources(
  clerkUserId: string
): Promise<boolean> {
  const statuses = await listContactSourceStatuses(clerkUserId);
  return statuses.some((s) => {
    if (!s.enabled || s.syncedAt) return false;
    if (s.kind === "google" || s.kind === "outlook") {
      return !s.lastError?.toLowerCase().includes("reconnect");
    }
    // The Mac book is tried until something goes wrong once. A denial is the
    // reader's decision, and asking again at every compose does not change it.
    if (s.kind === "mac") return !s.lastError;
    return false;
  });
}
