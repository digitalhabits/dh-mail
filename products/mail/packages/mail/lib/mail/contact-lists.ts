/**
 * Named groups of recipients.
 *
 * The whole set is one JSON value, so this needs no contract of its own — the
 * settings store already moves named strings. The normalization, the validation,
 * and the duplicate-name rules stay here.
 */

import { newMailId } from "@/lib/mail/uuid";

import { mailStore } from "@/lib/mail/store";
import type {
  MailContactList,
  MailContactListMember,
} from "@/lib/mail/contact-list-types";
import { PlanError } from "@/lib/plan/errors";

const LISTS_KEY = "mail_contact_lists";

function normalizeInitials(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const initials = raw.replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase();
  return initials || undefined;
}

function normalizeMember(raw: {
  email?: string;
  name?: string;
  initials?: string;
}): MailContactListMember | null {
  const email = (raw.email ?? "").trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  const initials = normalizeInitials(raw.initials);
  return {
    email,
    name: (raw.name ?? "").trim(),
    ...(initials ? { initials } : {}),
  };
}

function normalizeList(raw: Partial<MailContactList>): MailContactList | null {
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : null;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!id || !name) return null;
  const members: MailContactListMember[] = [];
  const seen = new Set<string>();
  for (const m of raw.members ?? []) {
    const next = normalizeMember(m);
    if (!next || seen.has(next.email)) continue;
    seen.add(next.email);
    members.push(next);
  }
  if (!members.length) return null;
  return {
    id,
    name,
    members,
    updatedAt:
      typeof raw.updatedAt === "string" && raw.updatedAt
        ? raw.updatedAt
        : new Date().toISOString(),
  };
}

export async function listMailContactLists(): Promise<MailContactList[]> {
  const raw = await mailStore().settings.get(LISTS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizeList(item as Partial<MailContactList>))
      .filter((x): x is MailContactList => Boolean(x))
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      );
  } catch {
    return [];
  }
}

async function saveAll(lists: MailContactList[]): Promise<void> {
  await mailStore().settings.set(LISTS_KEY, JSON.stringify(lists));
}

export async function createMailContactList(input: {
  name: string;
  members: { email: string; name?: string; initials?: string }[];
}): Promise<MailContactList> {
  const name = input.name.trim();
  if (!name) throw new PlanError("List name is required", 400);
  const members: MailContactListMember[] = [];
  const seen = new Set<string>();
  for (const m of input.members) {
    const next = normalizeMember(m);
    if (!next || seen.has(next.email)) continue;
    seen.add(next.email);
    members.push(next);
  }
  if (members.length < 2) {
    throw new PlanError("A list needs at least two people", 400);
  }
  const list: MailContactList = {
    id: newMailId(),
    name,
    members,
    updatedAt: new Date().toISOString(),
  };
  const existing = await listMailContactLists();
  if (
    existing.some(
      (l) => l.name.toLowerCase() === name.toLowerCase()
    )
  ) {
    throw new PlanError("A list with that name already exists", 400);
  }
  await saveAll([...existing, list]);
  return list;
}

export async function updateMailContactList(input: {
  id: string;
  name?: string;
  members?: { email: string; name?: string; initials?: string }[];
}): Promise<MailContactList> {
  const existing = await listMailContactLists();
  const idx = existing.findIndex((l) => l.id === input.id);
  if (idx < 0) throw new PlanError("List not found", 404);

  const current = existing[idx];
  const name =
    input.name !== undefined ? input.name.trim() : current.name;
  if (!name) throw new PlanError("List name is required", 400);

  let members = current.members;
  if (input.members) {
    members = [];
    const seen = new Set<string>();
    for (const m of input.members) {
      const next = normalizeMember(m);
      if (!next || seen.has(next.email)) continue;
      seen.add(next.email);
      members.push(next);
    }
    if (members.length < 2) {
      throw new PlanError("A list needs at least two people", 400);
    }
  }

  if (
    existing.some(
      (l, i) =>
        i !== idx && l.name.toLowerCase() === name.toLowerCase()
    )
  ) {
    throw new PlanError("A list with that name already exists", 400);
  }

  const updated: MailContactList = {
    ...current,
    name,
    members,
    updatedAt: new Date().toISOString(),
  };
  const next = [...existing];
  next[idx] = updated;
  await saveAll(next);
  return updated;
}

export async function deleteMailContactList(id: string): Promise<void> {
  const existing = await listMailContactLists();
  const next = existing.filter((l) => l.id !== id);
  if (next.length === existing.length) {
    throw new PlanError("List not found", 404);
  }
  await saveAll(next);
}
