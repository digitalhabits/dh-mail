"use client";

/*
 * What the address field suggests, and how it looks: the contacts and
 * lists (read once, kept, and read again when they change), the score a
 * contact gets for what is typed, the menu that score builds, your own
 * addresses, and the initials and colour of a chip.
 *
 * RecipientField.tsx draws the field; recipient-lists.tsx the lists.
 */

import * as React from "react";
import {
  emailsOfRecipients,
  type MailContactList,
  type MailRecipient,
} from "@/lib/mail/contact-list-types";
import {
  type MailContactSourceSummary,
  type MailContactSuggestion,
} from "@/lib/mail/contact-suggestion";
import { mailSay } from "@/lib/mail/i18n";
import { mailApiJson as apiJson } from "@/lib/mail/api";
import { mailApiFetch } from "@/lib/mail/api";

/**
 * The row the arrow keys are on.
 *
 * The navy the rail paints an open folder in, rather than the palest teal
 * this had: on a white menu that teal was a tint you had to look for, and
 * looking for it is the one thing a reader running down a list with the
 * keyboard cannot do. Navy is the same "you are here" the rest of the app
 * uses, and it takes the words on the row with it.
 */
export const HIGHLIGHT_ROW = "bg-[var(--mail-chrome-pinned)]";

export function provenanceBadgeClass(source: MailContactSuggestion["source"]): string {
  if (source === "crm") {
    return "bg-teal-700 text-white";
  }
  if (source === "self") {
    return "bg-stone-800 text-white";
  }
  if (source === "history") {
    return "border border-stone-300 bg-white text-stone-500";
  }
  return "bg-stone-200 text-stone-600";
}

export function formatSearchingFooter(sources: MailContactSourceSummary[]): string {
  if (!sources.length) return mailSay("searchingContacts");
  const ready = sources.filter((s) => !s.needsReconnect);
  const needsReconnect = sources.filter((s) => s.needsReconnect);
  // Prefer listing sources that can actually return hits; call out reconnects.
  const parts = (ready.length ? ready : sources).map((s) => s.label);
  let base: string;
  if (parts.length === 1) base = `Searching ${parts[0]}`;
  else if (parts.length === 2) base = `Searching ${parts[0]} and ${parts[1]}`;
  else {
    const last = parts[parts.length - 1];
    base = `Searching ${parts.slice(0, -1).join(", ")}, and ${last}`;
  }
  if (ready.length && needsReconnect.length) {
    const n = needsReconnect.length;
    return `${base} · ${n} Google/Outlook mailbox${n === 1 ? "" : "es"} need reconnect for contacts`;
  }
  return base;
}

export type ContactSuggestion = MailContactSuggestion;

type ListSuggestion = {
  list: MailContactList;
  score: number;
};

export type MenuItem =
  | { kind: "list"; list: MailContactList }
  | { kind: "contact"; contact: ContactSuggestion };

export function parseEmails(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
}

function deriveInitials(name: string, email: string): string {
  const source = name.trim() || email;
  const words = source.split(/[\s.@_-]+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export function memberInitials(m: { name?: string; email: string; initials?: string }): string {
  const custom = m.initials?.replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase();
  if (custom) return custom;
  return deriveInitials(m.name || "", m.email);
}

export function initials(name: string, email: string): string {
  return deriveInitials(name, email);
}

export function avatarTone(seed: string): string {
  const tones = [
    "bg-rose-100 text-rose-800",
    "bg-emerald-100 text-emerald-800",
    "bg-sky-100 text-sky-800",
    "bg-violet-100 text-violet-800",
    "bg-amber-100 text-amber-900",
    "bg-stone-200 text-stone-700",
  ];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h + seed.charCodeAt(i) * 17) % tones.length;
  return tones[h];
}

/** Session caches shared by every recipient field on the page. */
let contactsCache: Promise<{
  contacts: ContactSuggestion[];
  sources: MailContactSourceSummary[];
}> | null = null;
let listsCache: MailContactList[] | null = null;
const listsListeners = new Set<(lists: MailContactList[]) => void>();
let staleSyncStarted = false;

export function invalidateContactsCache(): void {
  contactsCache = null;
}

export function loadContacts(): Promise<{
  contacts: ContactSuggestion[];
  sources: MailContactSourceSummary[];
}> {
  if (!contactsCache) {
    contactsCache = apiJson<{
      contacts: ContactSuggestion[];
      sources: MailContactSourceSummary[];
    }>("/api/mail/contacts")
      .then((r) => ({
        contacts: r.contacts,
        sources: r.sources ?? [],
      }))
      .catch(() => {
        contactsCache = null;
        return { contacts: [], sources: [] };
      });

    // First compose in a session: pull provider mirrors if never synced.
    if (!staleSyncStarted) {
      staleSyncStarted = true;
      void mailApiFetch("/api/mail/contact-sources/sync?ifStale=1", {
        method: "POST",
        cache: "no-store",
      })
        .then(async (res) => {
          if (!res.ok) return;
          const json = (await res.json()) as { skipped?: boolean };
          if (!json.skipped) invalidateContactsCache();
        })
        .catch(() => {
          /* best-effort */
        });
    }
  }
  return contactsCache;
}

export async function refreshLists(): Promise<MailContactList[]> {
  const json = await apiJson<{ lists: MailContactList[] }>(
    "/api/mail/contact-lists"
  );
  listsCache = json.lists;
  for (const listener of listsListeners) listener(json.lists);
  return json.lists;
}

function loadLists(): Promise<MailContactList[]> {
  if (listsCache) return Promise.resolve(listsCache);
  return refreshLists().catch(() => {
    listsCache = listsCache ?? [];
    return listsCache;
  });
}

export function useContactLists() {
  const [lists, setLists] = React.useState<MailContactList[]>(
    () => listsCache ?? []
  );
  React.useEffect(() => {
    let cancelled = false;
    listsListeners.add(setLists);
    void loadLists().then((next) => {
      if (!cancelled) setLists(next);
    });
    return () => {
      cancelled = true;
      listsListeners.delete(setLists);
    };
  }, []);
  return lists;
}

export function nameForEmail(
  email: string,
  contacts: ContactSuggestion[]
): string | undefined {
  const hit = contacts.find(
    (c) => c.email.toLowerCase() === email.toLowerCase()
  );
  return hit?.name || undefined;
}

/**
 * How well a contact matches the typeahead query. Lower is better; -1 = no hit.
 *
 * An own mailbox carries no name of its own, so `name.includes(q)` finds
 * nothing when the reader types their own name. Match each query word
 * against the email local part (split on `.` `_` `+` `-`) as well as
 * name/org.
 */
function contactMatchScore(contact: ContactSuggestion, q: string): number {
  const email = contact.email.toLowerCase();
  const name = (contact.name || "").toLowerCase();
  const org = (contact.recordName || "").toLowerCase();
  const local = email.slice(0, Math.max(0, email.indexOf("@")));
  const localSpaced = local.replace(/[._+\-]+/g, " ");
  const haystack = `${name} ${email} ${org} ${localSpaced}`;

  if (email.startsWith(q) || name.startsWith(q) || local.startsWith(q)) {
    return 0;
  }
  if (
    email.includes(q) ||
    name.includes(q) ||
    org.includes(q) ||
    local.includes(q) ||
    localSpaced.includes(q)
  ) {
    return 1;
  }

  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    // "ada lovelace" → matches ada.lovelace@… even though the full string
    // does not appear contiguously in the address.
    if (tokens.every((t) => haystack.includes(t))) return 1;
  } else if (tokens.length === 1) {
    const t = tokens[0];
    const localParts = local.split(/[._+\-]+/).filter(Boolean);
    if (localParts.some((p) => p.startsWith(t) || p.includes(t))) return 1;
  }

  return -1;
}

export function filterMenu(
  draft: string,
  contacts: ContactSuggestion[],
  lists: MailContactList[],
  values: MailRecipient[]
): MenuItem[] {
  const q = draft.trim().toLowerCase();
  const takenEmails = new Set(emailsOfRecipients(values));
  const takenLists = new Set(
    values.filter((v) => v.kind === "list").map((v) => v.listId)
  );

  // An empty field offers nothing: a menu that opens on every new draft is
  // noise. Typing brings the book, own mailboxes included.
  if (!q) return [];

  const listHits: ListSuggestion[] = [];
  for (const list of lists) {
    if (takenLists.has(list.id)) continue;
    let score = -1;
    if (list.name.toLowerCase().startsWith(q)) score = 0;
    else if (list.name.toLowerCase().includes(q)) score = 1;
    else if (
      list.members.some(
        (m) =>
          m.email.toLowerCase().includes(q) ||
          m.name.toLowerCase().includes(q)
      )
    ) {
      score = 2;
    }
    if (score >= 0) listHits.push({ list, score });
  }
  listHits.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.list.name.localeCompare(b.list.name, undefined, {
      sensitivity: "base",
    });
  });

  const contactHits: { contact: ContactSuggestion; score: number }[] = [];
  for (const contact of contacts) {
    if (takenEmails.has(contact.email.toLowerCase())) continue;
    let score = contactMatchScore(contact, q);
    if (score < 0) continue;
    // Prefer own mailboxes slightly when scores tie (email yourself).
    if (contact.source === "self") score -= 0.1;
    contactHits.push({ contact, score });
  }
  contactHits.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return (a.contact.name || a.contact.email).localeCompare(
      b.contact.name || b.contact.email,
      undefined,
      { sensitivity: "base" }
    );
  });

  // Never drop matching own mailboxes behind the 8-hit cap.
  const selfHits = contactHits.filter((h) => h.contact.source === "self");
  const otherHits = contactHits
    .filter((h) => h.contact.source !== "self")
    .slice(0, Math.max(0, 8 - selfHits.length));

  return [
    ...listHits.slice(0, 6).map((h) => ({ kind: "list" as const, list: h.list })),
    ...selfHits.map((h) => ({ kind: "contact" as const, contact: h.contact })),
    ...otherHits.map((h) => ({ kind: "contact" as const, contact: h.contact })),
  ];
}

/** Connected mailboxes as typeahead rows (email yourself). */
export function selfSuggestionsFromAccounts(
  accounts: string[] | undefined
): ContactSuggestion[] {
  if (!accounts?.length) return [];
  const seen = new Set<string>();
  const out: ContactSuggestion[] = [];
  for (const raw of accounts) {
    const email = raw.trim().toLowerCase();
    if (!email.includes("@") || seen.has(email)) continue;
    seen.add(email);
    out.push({
      email,
      /*
        No name, rather than the word "You".

        A recipient is a person the message is going to, and "You" is not
        anybody: it went on the chip, so a message addressed to one of the
        reader's own mailboxes said it was going to "You" and never said
        which of the four. The badge below already says whose mailbox this
        is; what belongs here is a name, and where there is none the
        address stands in — which is what every other nameless contact
        does.
      */
      name: "",
      recordName: mailSay("yourMailbox"),
      source: "self",
      account: email,
    });
  }
  return out;
}
