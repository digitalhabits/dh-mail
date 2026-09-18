/**
 * The team layer, reached over the planner API.
 *
 * `crm-gate.ts` names `@/lib/plan/crm-contacts` and `@/lib/team` inside its
 * dynamic imports. In the planner those read Postgres. In the mail pane of
 * the Planner Mac app, mail is local and the CRM is not, so this module
 * stands in for both: it reads one snapshot from `/api/agent/mail/crm-context`
 * and answers every question from it. The snapshot is refreshed every five
 * minutes, and on demand with `resetPlannerCrm`.
 *
 * **The signatures must match the real modules.** The gate is typed against
 * them, and this file is what the bundle resolves to on the internal flavor.
 */

import type { ContactIndex, CrmRecordRef } from "@/lib/crm-contact-index";

import { plannerJson } from "../planner-api";

type RecipientSuggestion = {
  email: string;
  name: string;
  recordName: string;
};

type Snapshot = {
  contacts: ContactIndex;
  domains: Map<string, CrmRecordRef[]>;
  recipients: RecipientSuggestion[];
  team: RecipientSuggestion[];
  contactEmailCount: number;
  fetchedAt: number;
};

const TTL_MS = 5 * 60 * 1000;

let snapshot: Snapshot | null = null;
let inflight: Promise<Snapshot> | null = null;

async function load(): Promise<Snapshot> {
  if (snapshot && Date.now() - snapshot.fetchedAt < TTL_MS) return snapshot;
  if (inflight) return inflight;
  inflight = (async () => {
    let data: {
      contacts: [string, CrmRecordRef[]][];
      domains: [string, CrmRecordRef[]][];
      recipients: RecipientSuggestion[];
      team: RecipientSuggestion[];
      contactEmailCount: number;
    };
    try {
      data = await plannerJson("/api/agent/mail/crm-context");
    } catch (err) {
      // The planner did not answer — a session being renewed, or the
      // server away for a moment. What it said last time is still a
      // better answer than nothing, so the stale snapshot stands until
      // the next ask, which comes with the next list refresh.
      if (snapshot) {
        console.warn("[mail] CRM context not refreshed; using the last one:", err);
        return snapshot;
      }
      throw err;
    }
    snapshot = {
      contacts: new Map(data.contacts),
      domains: new Map(data.domains),
      recipients: data.recipients ?? [],
      team: data.team ?? [],
      contactEmailCount: data.contactEmailCount ?? 0,
      fetchedAt: Date.now(),
    };
    return snapshot;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Forget the snapshot, so the next question asks the planner again. */
export function resetPlannerCrm(): void {
  snapshot = null;
}

export async function buildContactIndex(): Promise<ContactIndex> {
  return (await load()).contacts;
}

/**
 * Synchronous in the real module, because it reads what buildContactIndex
 * cached. Same here: call buildContactIndex first, as the mail core does.
 */
export function buildContactDomainIndex(): Map<string, CrmRecordRef[]> {
  return snapshot?.domains ?? new Map();
}

function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1) : "";
}

export function crmLogoUrlFor(
  email: string,
  contacts: ContactIndex,
  domainContacts?: Map<string, CrmRecordRef[]>
): string | undefined {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return undefined;
  const domain = emailDomain(normalized);
  const refs = [
    ...(contacts.get(normalized) ?? []),
    ...((domain && domainContacts?.get(domain)) || []),
  ];
  for (const ref of refs) {
    const url = (ref.fields.Logo || ref.fields.logo || "").trim();
    if (url) return url;
  }
  return undefined;
}

export async function listCrmRecipientSuggestions(): Promise<RecipientSuggestion[]> {
  return (await load()).recipients;
}

export async function listTeamRecipientSuggestions(): Promise<RecipientSuggestion[]> {
  return (await load()).team;
}

export async function countCrmContactEmails(): Promise<number> {
  return (await load()).contactEmailCount;
}

/*
 * The typecheck resolves the gate's imports to no-crm.ts, not to this file,
 * so a drift here would reach the bundle unseen. This line makes the
 * typecheck compare the two: no-crm.ts keeps the real modules' signatures.
 */
import type * as StandIn from "./no-crm";
const conforms: {
  [K in keyof typeof StandIn]: (typeof StandIn)[K];
} = {
  buildContactIndex,
  buildContactDomainIndex,
  crmLogoUrlFor,
  listCrmRecipientSuggestions,
  listTeamRecipientSuggestions,
  countCrmContactEmails,
};
void conforms;
