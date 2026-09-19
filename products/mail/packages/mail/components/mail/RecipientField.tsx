"use client";

import * as React from "react";
import { Clock, SquarePen, Users, X } from "lucide-react";
import { toast } from "@/lib/mail/toast";

import {
  CONTACTS_CHANGED_EVENT,
  openContactSourcesDialog,
} from "@/components/mail/ContactSourcesDialog";
import { AppleMark } from "@/components/mail/AccountMark";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { MailPopoverContent } from "@/components/mail/MailPopoverContent";
import {
  emailsOfRecipients,
  recipientKey,
  type MailContactList,
  type MailContactListMember,
  type MailRecipient,
} from "@/lib/mail/contact-list-types";
import {
  contactSourceBadge,
  historyEmailedWhen,
  type MailContactSourceSummary,
  type MailContactSuggestion,
} from "@/lib/mail/contact-suggestion";
import {
  chipSelectionAfterRemoval,
  recipientsToClipboardText,
} from "@/lib/mail/recipient-chips";
import {
  mailSay,
  useMailT,
  type MailStringKey,
} from "@/lib/mail/i18n";
import { copyTextToClipboard } from "@/lib/mail/copy-text";
import { useAddressMenu } from "@/components/mail/AddressMenu";
import { cn } from "@/lib/utils";
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
const HIGHLIGHT_ROW = "bg-[var(--mail-chrome-pinned)]";

function provenanceBadgeClass(source: MailContactSuggestion["source"]): string {
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

function formatSearchingFooter(sources: MailContactSourceSummary[]): string {
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

type ContactSuggestion = MailContactSuggestion;

type ListSuggestion = {
  list: MailContactList;
  score: number;
};

type MenuItem =
  | { kind: "list"; list: MailContactList }
  | { kind: "contact"; contact: ContactSuggestion };

function parseEmails(raw: string): string[] {
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

function memberInitials(m: { name?: string; email: string; initials?: string }): string {
  const custom = m.initials?.replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase();
  if (custom) return custom;
  return deriveInitials(m.name || "", m.email);
}

function initials(name: string, email: string): string {
  return deriveInitials(name, email);
}

function avatarTone(seed: string): string {
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
let listsListeners = new Set<(lists: MailContactList[]) => void>();
let staleSyncStarted = false;


function invalidateContactsCache(): void {
  contactsCache = null;
}

function loadContacts(): Promise<{
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

async function refreshLists(): Promise<MailContactList[]> {
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

function useContactLists() {
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

function nameForEmail(
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

function filterMenu(
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
function selfSuggestionsFromAccounts(
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


/**
 * "Save as list…", for a set of people already gathered.
 *
 * Exported because the compose field is not the only place a group of
 * addresses sits together: a circular that arrives in the inbox has the
 * whole club on it, and that is a list you want long before you write the
 * reply. The thread header uses it — see ThreadPane.
 */
export function SaveAsListControl({
  people,
  contacts = [],
  onSaved,
  className,
  align = "end",
  noteKey = "saveListNote",
  labelKey = "saveAsList",
}: {
  people: { email: string; name?: string }[];
  /** Only to fill in a name the caller does not have. */
  contacts?: ContactSuggestion[];
  onSaved?: (list: MailContactList) => void;
  className?: string;
  align?: "start" | "end";
  /** The small print under the box: it reads differently while composing. */
  noteKey?: MailStringKey;
  /** Its own control in the composer; part of a sentence in a thread. */
  labelKey?: MailStringKey;
}) {
  const t = useMailT();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const members = people.map((p) => ({
    email: p.email,
    name: p.name || nameForEmail(p.email, contacts) || "",
  }));

  const save = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const json = await apiJson<{ list: MailContactList }>(
        "/api/mail/contact-lists",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), members }),
        }
      );
      await refreshLists();
      onSaved?.(json.list);
      setOpen(false);
      setName("");
      toast.success(mailSay("savedListNamed", { name: json.list.name }));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : mailSay("couldNotSaveList")
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "shrink-0 text-xs text-teal-700 underline-offset-2 hover:underline",
            className
          )}
        >
          {t(labelKey)}
        </button>
      </PopoverTrigger>
      <MailPopoverContent align={align} className="w-72 p-3">
        <p className="text-sm font-medium text-stone-800">
          {t("saveTheseAsList", { count: people.length })}
        </p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            }
          }}
          placeholder={t("listName")}
          className="mt-2 w-full rounded-lg border border-teal-600 px-2.5 py-1.5 text-sm text-stone-800 outline-none focus:ring-2 focus:ring-teal-600/20"
        />
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            disabled={!name.trim() || saving}
            onClick={() => void save()}
            className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-40"
          >
            {saving ? t("saving") : t("save")}
          </button>
          <button
            type="button"
            className="text-sm text-teal-700 hover:underline"
            onClick={() => setOpen(false)}
          >
            {t("cancel")}
          </button>
        </div>
        <p className="mt-3 text-[11px] leading-snug text-stone-400">
          {t(noteKey)}
        </p>
      </MailPopoverContent>
    </Popover>
  );
}

function EditListPanel({
  name,
  setName,
  members,
  setMembers,
  addDraft,
  setAddDraft,
  contacts,
  saving,
  onDone,
  onDelete,
}: {
  name: string;
  setName: (v: string) => void;
  members: MailContactListMember[];
  setMembers: React.Dispatch<React.SetStateAction<MailContactListMember[]>>;
  addDraft: string;
  setAddDraft: (v: string) => void;
  contacts: ContactSuggestion[];
  saving: boolean;
  onDone: () => void;
  onDelete: () => void;
}) {
  const t = useMailT();
  const [editingInitialsEmail, setEditingInitialsEmail] = React.useState<
    string | null
  >(null);
  const [initialsDraft, setInitialsDraft] = React.useState("");
  const initialsInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (editingInitialsEmail) {
      initialsInputRef.current?.focus();
      initialsInputRef.current?.select();
    }
  }, [editingInitialsEmail]);

  const beginEditInitials = (m: MailContactListMember) => {
    setEditingInitialsEmail(m.email);
    setInitialsDraft(memberInitials(m));
  };

  const commitInitialsDraft = (email: string, raw: string) => {
    const next = raw.replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase();
    setMembers((current) =>
      current.map((m) => {
        if (m.email !== email) return m;
        if (!next) {
          const { initials: _drop, ...rest } = m;
          return rest;
        }
        return { ...m, initials: next };
      })
    );
    setEditingInitialsEmail(null);
  };

  const addSuggestions = filterMenu(
    addDraft,
    contacts,
    [],
    members.map((m) => ({ kind: "email" as const, email: m.email }))
  ).filter((i): i is Extract<MenuItem, { kind: "contact" }> => i.kind === "contact");

  const addPerson = (email: string, personName?: string) => {
    const e = email.toLowerCase();
    if (members.some((m) => m.email === e)) {
      setAddDraft("");
      return;
    }
    setMembers((current) => [
      ...current,
      {
        email: e,
        name: personName || nameForEmail(e, contacts) || "",
      },
    ]);
    setAddDraft("");
  };

  return (
    <div className="p-3">
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-stone-200 px-2.5 py-1.5 text-sm font-semibold text-stone-900 outline-none focus:border-teal-600"
        />
        <span className="shrink-0 text-xs text-stone-400">
          {members.length === 1
            ? t("onePersonCount")
            : t("peopleCount", { count: members.length })}
        </span>
      </div>
      <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto">
        {members.map((m) => (
          <li
            key={m.email}
            className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-stone-50"
          >
            {editingInitialsEmail === m.email ? (
              <input
                ref={initialsInputRef}
                value={initialsDraft}
                maxLength={2}
                aria-label={`Initials for ${m.name || m.email}`}
                title={t("editInitials")}
                className={cn(
                  "h-7 w-7 shrink-0 rounded-full text-center text-[10px] font-semibold uppercase outline-none ring-2 ring-teal-600",
                  avatarTone(m.email)
                )}
                onChange={(e) =>
                  setInitialsDraft(
                    e.target.value.replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase()
                  )
                }
                onBlur={() => commitInitialsDraft(m.email, initialsDraft)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitInitialsDraft(m.email, initialsDraft);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setEditingInitialsEmail(null);
                  }
                }}
              />
            ) : (
              <button
                type="button"
                title={t("editInitials")}
                aria-label={`Edit initials for ${m.name || m.email}`}
                className={cn(
                  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold hover:ring-2 hover:ring-teal-500/60",
                  avatarTone(m.email)
                )}
                onClick={() => beginEditInitials(m)}
              >
                {memberInitials(m)}
              </button>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-stone-800">
                {m.name || m.email}
              </span>
              {m.name ? (
                <span className="block truncate text-xs text-stone-400">
                  {m.email}
                </span>
              ) : null}
            </span>
            <button
              type="button"
              aria-label={`Remove ${m.name || m.email}`}
              className="rounded px-1 text-stone-400 hover:text-red-700"
              onClick={() =>
                setMembers((current) =>
                  current.filter((x) => x.email !== m.email)
                )
              }
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="relative mt-2">
        <div className="flex items-center gap-1.5 rounded-lg border border-dashed border-stone-300 px-2 py-1.5">
          <span className="text-stone-400">+</span>
          <input
            value={addDraft}
            onChange={(e) => setAddDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && addDraft.trim()) {
                e.preventDefault();
                const hit = addSuggestions[0];
                if (hit) addPerson(hit.contact.email, hit.contact.name);
                else {
                  const emails = parseEmails(addDraft);
                  if (emails[0]) addPerson(emails[0]);
                }
              }
            }}
            placeholder={t("addPerson")}
            // Names and addresses: the Mac's own suggestions stand down
            // here for the same reason they do in the To field.
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-stone-400"
          />
        </div>
        {addDraft.trim() && addSuggestions.length ? (
          <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-40 overflow-y-auto rounded-lg border border-stone-200 bg-white py-1 shadow-lg">
            {addSuggestions.slice(0, 5).map((item) => (
              <li key={item.contact.email}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-stone-50"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    addPerson(item.contact.email, item.contact.name);
                  }}
                >
                  <span
                    className={cn(
                      "inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold",
                      avatarTone(item.contact.email)
                    )}
                  >
                    {initials(item.contact.name, item.contact.email)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-stone-800">
                      {item.contact.name || item.contact.email}
                    </span>
                    <span className="block truncate text-xs text-stone-400">
                      {item.contact.email}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <button
          type="button"
          disabled={saving || members.length < 2 || !name.trim()}
          onClick={() => void onDone()}
          className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-40"
        >
          {saving ? t("saving") : t("done")}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => void onDelete()}
          className="text-sm text-red-600 hover:underline"
        >
          {t("deleteList")}
        </button>
      </div>
    </div>
  );
}

function ListChip({
  recipient,
  contacts,
  variant,
  selected,
  onSelect,
  onRelease,
  onChange,
  onExpand,
  onRemove,
  carry,
}: {
  recipient: Extract<MailRecipient, { kind: "list" }>;
  contacts: ContactSuggestion[];
  variant: "boxed" | "inline";
  selected?: boolean;
  /** Set where the chip may be carried to another field. */
  carry?: React.HTMLAttributes<HTMLElement> & { draggable?: boolean };
  onSelect: (e: React.MouseEvent) => void;
  /** The mouse let go without a drag: give the input its focus back. */
  onRelease?: () => void;
  onChange: (next: Extract<MailRecipient, { kind: "list" }>) => void;
  onExpand: () => void;
  onRemove: () => void;
}) {
  const t = useMailT();
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState(recipient.name);
  const [members, setMembers] = React.useState(recipient.members);
  const [addDraft, setAddDraft] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setEditing(false);
      setName(recipient.name);
      setMembers(recipient.members);
      setAddDraft("");
    }
  }, [open, recipient.name, recipient.members]);

  const preview = members.slice(0, 3);
  const more = Math.max(0, members.length - preview.length);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span
          {...carry}
          className={cn(
            "select-none inline-flex cursor-pointer items-center gap-1 rounded-full bg-teal-100 py-0.5 pl-2 pr-1 text-teal-900",
            variant === "inline"
              ? "text-[13px]"
              : "mb-1 mr-1.5 align-middle text-xs",
            selected && "ring-2 ring-teal-600 ring-offset-1"
          )}
          aria-selected={selected}
          /* Focusable for the same reason as an address chip: see there. */
          tabIndex={-1}
          onMouseDown={(e) => {
            if ((e.target as HTMLElement).closest("[data-chip-remove]")) return;
            onSelect(e);
          }}
          onMouseUp={(e) => {
            if ((e.target as HTMLElement).closest("[data-chip-remove]")) return;
            onRelease?.();
          }}
        >
          <Users className="h-3.5 w-3.5 shrink-0 text-teal-700" />
          <button
            type="button"
            className="max-w-[16ch] truncate font-medium hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(true);
            }}
          >
            {recipient.name}
          </button>
          <span className="text-teal-700/80">· {recipient.members.length}</span>
          <button
            type="button"
            data-chip-remove
            aria-label={`Remove ${recipient.name}`}
            title={`Remove ${recipient.name}`}
            className="rounded-full px-1 text-teal-700/70 hover:text-red-700"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            ×
          </button>
        </span>
      </PopoverTrigger>
      <MailPopoverContent
        align="start"
        className="w-80 p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {!editing ? (
          <div className="p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold text-stone-900">
                {recipient.name}
              </p>
              <button
                type="button"
                className="shrink-0 text-xs text-teal-700 hover:underline"
                onClick={() => setEditing(true)}
              >
                {t("editList")}
              </button>
            </div>
            <ul className="mt-2 space-y-1.5">
              {preview.map((m) => (
                <li key={m.email} className="min-w-0">
                  <p className="truncate text-sm font-medium text-stone-800">
                    {m.name || m.email}
                  </p>
                  {m.name ? (
                    <p className="truncate text-xs text-stone-400">{m.email}</p>
                  ) : null}
                </li>
              ))}
              {more > 0 ? (
                <li className="text-xs text-stone-400">+ {more} more</li>
              ) : null}
            </ul>
            <div className="mt-3 space-y-2 border-t border-stone-100 pt-3">
              <button
                type="button"
                className="text-sm text-teal-700 hover:underline"
                onClick={() => {
                  setOpen(false);
                  onExpand();
                }}
              >
                {t("expandToRecipients", { count: members.length })}
              </button>
              <label className="flex items-center gap-2 text-sm text-stone-700">
                <input
                  type="checkbox"
                  checked={Boolean(recipient.sendAsBcc)}
                  onChange={(e) =>
                    onChange({ ...recipient, sendAsBcc: e.target.checked })
                  }
                  className="rounded border-stone-300 text-teal-600 focus:ring-teal-600"
                />
                  {t("sendAsBcc")}
                </label>
            </div>
          </div>
        ) : (
          <EditListPanel
            name={name}
            setName={setName}
            members={members}
            setMembers={setMembers}
            addDraft={addDraft}
            setAddDraft={setAddDraft}
            contacts={contacts}
            saving={saving}
            onDone={async () => {
              setSaving(true);
              try {
                const json = await apiJson<{ list: MailContactList }>(
                  "/api/mail/contact-lists",
                  {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      id: recipient.listId,
                      name: name.trim(),
                      members,
                    }),
                  }
                );
                await refreshLists();
                onChange({
                  ...recipient,
                  name: json.list.name,
                  members: json.list.members,
                });
                setEditing(false);
                toast.success(mailSay("listUpdated"));
              } catch (err) {
                toast.error(
                  err instanceof Error ? err.message : "Couldn't update list"
                );
              } finally {
                setSaving(false);
              }
            }}
            onDelete={async () => {
              if (!window.confirm(`Delete list “${recipient.name}”?`)) return;
              setSaving(true);
              try {
                await apiJson(
                  `/api/mail/contact-lists?id=${encodeURIComponent(recipient.listId)}`,
                  { method: "DELETE" }
                );
                await refreshLists();
                onRemove();
                setOpen(false);
                toast.success(mailSay("listDeleted"));
              } catch (err) {
                toast.error(
                  err instanceof Error ? err.message : "Couldn't delete list"
                );
              } finally {
                setSaving(false);
              }
            }}
          />
        )}
      </MailPopoverContent>
    </Popover>
  );
}

/**
 * One list, open for editing, in the place the menu was.
 *
 * A list could only be edited from a chip: you had to put it into a message
 * first, open it, and press Edit — three steps, and the first one leaves
 * something in a message you may not be writing. The pencils in the
 * suggestions and in the lists menu both come here instead.
 *
 * It takes the same spot under the field the suggestions use, so the menu
 * you pressed the pencil in becomes the thing you pressed it for, rather
 * than a second panel over the top of the first.
 */
function ListEditorCard({
  list,
  contacts,
  above,
  maxHeight,
  onClose,
  onSaved,
  onDeleted,
}: {
  list: MailContactList;
  contacts: ContactSuggestion[];
  above: boolean;
  maxHeight: number;
  onClose: () => void;
  onSaved: (list: MailContactList) => void;
  onDeleted: (listId: string) => void;
}) {
  const [name, setName] = React.useState(list.name);
  const [members, setMembers] = React.useState<MailContactListMember[]>(
    list.members
  );
  const [addDraft, setAddDraft] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const cardRef = React.useRef<HTMLDivElement | null>(null);

  // A second pencil, on a different list, without closing the first.
  React.useEffect(() => {
    setName(list.name);
    setMembers(list.members);
    setAddDraft("");
  }, [list.id, list.name, list.members]);

  /*
    A way out that is not "Done" and not "Delete list".

    Both of those do something to the list, and a reader who opened the
    wrong one, or came to look rather than to change, needs neither. Click
    away or press Escape, same as the menu this replaced — and the edits
    are dropped, because nothing has been sent until Done.
  */
  React.useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (saving) return;
      if (!cardRef.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || saving) return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [onClose, saving]);

  return (
    <div
      ref={cardRef}
      // The reply band clips what hangs out of it; see mail.css.
      data-recipient-menu=""
      className={cn(
        "absolute left-0 right-0 z-30 overflow-y-auto rounded-lg border border-stone-200 bg-white p-3 shadow-lg",
        above ? "bottom-full mb-1" : "top-full mt-1"
      )}
      style={{ maxHeight }}
      // The field's own blur would otherwise commit whatever was typed and
      // shut the menu the moment a name here is clicked into.
      onMouseDown={(e) => e.stopPropagation()}
    >
      <EditListPanel
        name={name}
        setName={setName}
        members={members}
        setMembers={setMembers}
        addDraft={addDraft}
        setAddDraft={setAddDraft}
        contacts={contacts}
        saving={saving}
        onDone={async () => {
          setSaving(true);
          try {
            const json = await apiJson<{ list: MailContactList }>(
              "/api/mail/contact-lists",
              {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  id: list.id,
                  name: name.trim(),
                  members,
                }),
              }
            );
            await refreshLists();
            // The store answers with the list it kept; without one there is
            // nothing to copy onto the chips, and closing is still right.
            if (json.list) onSaved(json.list);
            onClose();
            toast.success(mailSay("listUpdated"));
          } catch (err) {
            toast.error(
              err instanceof Error ? err.message : mailSay("couldNotUpdateList")
            );
          } finally {
            setSaving(false);
          }
        }}
        onDelete={async () => {
          if (!window.confirm(mailSay("deleteListNamed", { name: list.name }))) {
            return;
          }
          setSaving(true);
          try {
            await apiJson(
              `/api/mail/contact-lists?id=${encodeURIComponent(list.id)}`,
              { method: "DELETE" }
            );
            await refreshLists();
            onDeleted(list.id);
            onClose();
            toast.success(mailSay("listDeleted"));
          } catch (err) {
            toast.error(
              err instanceof Error ? err.message : mailSay("couldNotDeleteList")
            );
          } finally {
            setSaving(false);
          }
        }}
      />
    </div>
  );
}

/**
 * Every list you have, at the end of the field.
 *
 * A list could only be found by typing the first letters of its name, which
 * works when you remember it and not at all otherwise — and a reader who
 * has just made one has no reason to think it is in there. So: a button,
 * the lists behind it, and the same pencil on each.
 */
function ListsMenu({
  lists,
  onPick,
  onEdit,
  className,
}: {
  lists: MailContactList[];
  onPick: (list: MailContactList) => void;
  onEdit: (list: MailContactList) => void;
  className?: string;
}) {
  const t = useMailT();
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("yourLists")}
          title={t("yourLists")}
          className={cn(
            "shrink-0 rounded-md p-1 text-[var(--mail-chip-muted)] transition-colors hover:bg-[var(--mail-action-2-hover)] hover:text-[var(--mail-chip-fg)]",
            open && "bg-[var(--mail-action-2-hover)] text-[var(--mail-chip-fg)]",
            className
          )}
        >
          <Users className="h-4 w-4" aria-hidden />
        </button>
      </PopoverTrigger>
      <MailPopoverContent align="end" className="w-64 p-1">
        <p className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-stone-400">
          {t("yourLists")}
        </p>
        {lists.map((list) => (
          <div
            key={list.id}
            className="group flex items-center rounded-md hover:bg-stone-100"
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2.5 py-1.5 pl-2 text-left"
              onClick={() => {
                setOpen(false);
                onPick(list);
              }}
            >
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-teal-600 text-white">
                <Users className="h-3.5 w-3.5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-stone-900">
                  {list.name}
                </span>
                <span className="block text-xs text-stone-500">
                  {listSubtitle(t, list.members.length)}
                </span>
              </span>
            </button>
            <EditListButton
              className="mr-1 text-stone-400 hover:text-stone-700"
              onEdit={() => {
                setOpen(false);
                onEdit(list);
              }}
            />
          </div>
        ))}
      </MailPopoverContent>
    </Popover>
  );
}

/** The little pencil that opens a list for editing. */
function EditListButton({
  onEdit,
  className,
}: {
  onEdit: () => void;
  className?: string;
}) {
  const t = useMailT();
  return (
    <button
      type="button"
      aria-label={t("editList")}
      title={t("editList")}
      // mousedown, and stopped: the field is watching for a blur, and a
      // click that lands after one arrives at a closed menu.
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onEdit();
      }}
      className={cn(
        "shrink-0 rounded-md p-1 opacity-0 transition-opacity hover:bg-black/10 group-hover:opacity-100 focus-visible:opacity-100",
        className
      )}
    >
      <SquarePen className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}

/** How a list says what it is, under its name. */
function listSubtitle(t: ReturnType<typeof useMailT>, count: number): string {
  return count === 1
    ? t("listOnePerson")
    : t("listPeopleCount", { count });
}

/**
 * One person in a field, and who they actually are.
 *
 * The chip says the name when it has one, which is what you want while
 * writing and no help at all when you are checking. Two people share a
 * first name, an old address for the right person is still the wrong
 * address, and a name typed by a sender is not a name anybody verified.
 * Double-click and the chip says the address instead — with where the name
 * came from, and a way to take a copy.
 *
 * Double-click rather than a click or a hover: a click selects the chip
 * (that is how several are cut or deleted at once), and a tooltip cannot
 * be copied from, which is most of the reason for looking.
 */
/**
 * A recipient being carried from one field to another.
 *
 * To, Cc and Bcc are three fields that do not know about each other, and
 * moving somebody between them meant taking them out of one and typing
 * them into the next. The chip carries what it is and how to take it out
 * of where it came from, so the field it lands on can finish the move by
 * itself — no field has to know what the others are.
 *
 * Without a provider round them there is nothing to carry to, and the
 * chips are simply not draggable.
 */
type CarriedRecipient = {
  fieldId: string;
  recipient: MailRecipient;
  /** Take it out of the field it came from, once it has landed. */
  takeFromSource: () => void;
};

const RecipientCarry = React.createContext<{
  carried: CarriedRecipient | null;
  setCarried: (next: CarriedRecipient | null) => void;
} | null>(null);

export function RecipientCarryProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [carried, setCarried] = React.useState<CarriedRecipient | null>(null);
  const value = React.useMemo(() => ({ carried, setCarried }), [carried]);
  return (
    <RecipientCarry.Provider value={value}>{children}</RecipientCarry.Provider>
  );
}

function EmailChip({
  recipient,
  contacts,
  variant,
  selected,
  onSelect,
  onRelease,
  onRemove,
  carry,
}: {
  recipient: Extract<MailRecipient, { kind: "email" }>;
  contacts: ContactSuggestion[];
  variant: "boxed" | "inline";
  selected: boolean;
  onSelect: (e: React.MouseEvent) => void;
  /** The mouse let go without a drag: give the input its focus back. */
  onRelease?: () => void;
  onRemove: () => void;
  /** Set where the chip may be carried to another field. */
  carry?: React.HTMLAttributes<HTMLElement> & { draggable?: boolean };
}) {
  const t = useMailT();
  const [open, setOpen] = React.useState(false);
  const { openAddressMenu, addressMenu } = useAddressMenu();
  const label = recipient.name || recipient.email;
  const known = contacts.find(
    (c) => c.email.trim().toLowerCase() === recipient.email.trim().toLowerCase()
  );
  const badge = known ? contactSourceBadge(known) : null;

  return (
    <>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span
          {...carry}
          className={cn(
            "inline-flex cursor-pointer select-none items-center gap-1 rounded-full bg-[var(--mail-chip)] py-0.5 pl-2 pr-1 text-[var(--mail-chip-fg)]",
            variant === "inline"
              ? "text-[13px]"
              : // Block flow in a boxed field, so the spacing a flex gap
                // gave is carried by the chips themselves.
                "mb-1 mr-1.5 align-middle text-xs",
            selected && "ring-2 ring-teal-600 ring-offset-1"
          )}
          title={recipient.name ? recipient.email : undefined}
          aria-selected={selected}
          /* Focusable, so the mouse going down on it moves focus here and
             not out of the field: the input's blur then does nothing, and
             the mouse coming up hands focus back. The default used to be
             cancelled instead, which kept the focus but also kept WebKit
             from starting a drag — a chip could be selected but never
             carried to another field. */
          tabIndex={-1}
          onMouseDown={(e) => {
            if ((e.target as HTMLElement).closest("[data-chip-remove]")) return;
            onSelect(e);
          }}
          onMouseUp={(e) => {
            if ((e.target as HTMLElement).closest("[data-chip-remove]")) return;
            onRelease?.();
          }}
          /* A click selects; the card is for a double-click. The trigger
             would open it on the click as well, and the card takes the
             focus with it — so a chip picked with the mouse could not be
             cut or copied, the keys went to the card. Marking the click
             handled is what tells the trigger to leave it. */
          onClick={(e) => e.preventDefault()}
          onDoubleClick={(e) => {
            e.preventDefault();
            setOpen(true);
          }}
          onContextMenu={(e) =>
            openAddressMenu(e, recipient.email, recipient.name)
          }
        >
          {label}
          <button
            type="button"
            data-chip-remove
            aria-label={t("removeNamed", { name: label })}
            title={t("removeNamed", { name: label })}
            className="rounded-full px-1 text-[var(--mail-chip-muted)] hover:text-red-500"
            onClick={onRemove}
          >
            ×
          </button>
        </span>
      </PopoverTrigger>
      <MailPopoverContent align="start" className="w-72 p-3">
        {recipient.name ? (
          <p className="text-sm font-semibold text-stone-900">
            {recipient.name}
          </p>
        ) : null}
        {/* Selectable, and wrapped rather than cut: an address you cannot
            read the end of is the one thing this panel is for. */}
        <p className="mt-0.5 select-text break-all text-sm text-stone-700">
          {recipient.email}
        </p>
        {badge ? (
          <span
            className={cn(
              "mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              provenanceBadgeClass(known!.source)
            )}
          >
            {known!.source === "mac" ? <AppleMark /> : null}
            {t(badge)}
          </span>
        ) : null}
        <div className="mt-3 flex items-center gap-3 border-t border-stone-100 pt-2.5">
          <button
            type="button"
            className="text-sm text-teal-700 hover:underline"
            onClick={() => {
              void copyTextToClipboard(recipient.email).then((ok) =>
                ok
                  ? toast.success(mailSay("copied"))
                  : toast.error(mailSay("couldNotCopy"))
              );
            }}
          >
            {t("copyAddress")}
          </button>
          <button
            type="button"
            className="text-sm text-stone-500 hover:text-red-700"
            onClick={() => {
              setOpen(false);
              onRemove();
            }}
          >
            {t("remove")}
          </button>
        </div>
      </MailPopoverContent>
    </Popover>
    {addressMenu}
    </>
  );
}

/** Editable To/Cc/Bcc field with CRM contacts + saved contact lists. */
export function RecipientField({
  label,
  values,
  onChange,
  placeholder,
  inputRef,
  variant = "boxed",
  className,
  allowSaveList = false,
  actions,
  collapseAfter,
  ownAccounts,
  onTabOut,
}: {
  label: string;
  values: MailRecipient[];
  onChange: (next: MailRecipient[]) => void;
  placeholder: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  variant?: "boxed" | "inline";
  className?: string;
  /** Show “Save as list…” when there are 2+ individual people chips. */
  allowSaveList?: boolean;
  /**
   * Controls that belong beside the field — Cc and Bcc, from the composer.
   * Under “Save as list…” rather than next to it, so the column reads down.
   */
  actions?: React.ReactNode;
  /**
   * Show at most this many chips while nobody is writing in the field.
   *
   * A circular to thirty people filled the window with addresses and pushed
   * the message itself off the bottom. Past this count the rest are folded
   * into “and N more”, which unfolds on a click and whenever the field is
   * being typed in — you cannot edit what you cannot see.
   */
  collapseAfter?: number;
  /**
   * Connected mailboxes to always suggest (email yourself). Passed from the
   * shell so To/Cc works even before /api/mail/contacts has synced.
   */
  ownAccounts?: string[];
  /**
   * Where Tab goes when this field has nothing left to do with it.
   *
   * Tab still finishes what is being typed first — it takes the highlighted
   * suggestion, or turns a typed address into a chip. Only once the box is
   * empty does it leave, and then it should land on the next thing the writer
   * means to fill in, not on the buttons that happen to sit beside this one.
   */
  onTabOut?: () => void;
}) {
  const t = useMailT();
  const [draft, setDraft] = React.useState("");
  const [contacts, setContacts] = React.useState<ContactSuggestion[]>([]);
  const [sourceSummaries, setSourceSummaries] = React.useState<
    MailContactSourceSummary[]
  >([]);
  const lists = useContactLists();
  const [highlight, setHighlight] = React.useState(0);
  const [menuOpen, setMenuOpen] = React.useState(false);
  /** True while the writer is in this field: chips stay whole while editing. */
  const [writing, setWriting] = React.useState(false);
  /** Unfolded by hand, and stays unfolded until the field is left. */
  const [unfolded, setUnfolded] = React.useState(false);
  /** Indices of selected chips; empty = typing in the draft input. */
  const [selected, setSelected] = React.useState<Set<number>>(() => new Set());
  /** Anchor for shift-click / shift-arrow range selection. */
  const [anchor, setAnchor] = React.useState<number | null>(null);
  /** Focused chip while navigating with arrows (`null` = draft input). */
  const [focusIndex, setFocusIndex] = React.useState<number | null>(null);
  const blurTimer = React.useRef<number | null>(null);
  const inputElRef = React.useRef<HTMLInputElement | null>(null);
  const fieldElRef = React.useRef<HTMLDivElement | null>(null);
  // Keep latest selection in refs so key handlers never see a stale focusIndex
  // after a chip click in the same tick / before re-render.
  const chipNavRef = React.useRef({
    selected,
    anchor,
    focusIndex,
    valuesLength: values.length,
  });
  chipNavRef.current = {
    selected,
    anchor,
    focusIndex,
    valuesLength: values.length,
  };

  const setInputRef = React.useCallback(
    (el: HTMLInputElement | null) => {
      inputElRef.current = el;
      if (!inputRef) return;
      if (typeof inputRef === "object") {
        (inputRef as React.MutableRefObject<HTMLInputElement | null>).current =
          el;
      }
    },
    [inputRef]
  );

  const reloadContacts = React.useCallback(() => {
    invalidateContactsCache();
    return loadContacts().then((payload) => {
      setContacts(payload.contacts);
      setSourceSummaries(payload.sources);
    });
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void loadContacts().then((payload) => {
      if (!cancelled) {
        setContacts(payload.contacts);
        setSourceSummaries(payload.sources);
      }
    });
    const onChanged = () => {
      void reloadContacts();
    };
    window.addEventListener(CONTACTS_CHANGED_EVENT, onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(CONTACTS_CHANGED_EVENT, onChanged);
    };
  }, [reloadContacts]);

  const hideHistory = async (email: string) => {
    try {
      await apiJson("/api/mail/contact-sources", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hideEmail: email }),
      });
      await reloadContacts();
      toast.success(mailSay("removedFromSuggestions"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't remove");
    }
  };

  // Merge shell-provided mailboxes with API contacts (API wins on same email
  // so a richer name from CRM/history is kept when present).
  const contactsForMenu = React.useMemo(() => {
    const own = selfSuggestionsFromAccounts(ownAccounts);
    if (!own.length) return contacts;
    const byEmail = new Map<string, ContactSuggestion>();
    for (const row of own) byEmail.set(row.email.toLowerCase(), row);
    for (const row of contacts) {
      const key = row.email.toLowerCase();
      const prev = byEmail.get(key);
      if (!prev) {
        byEmail.set(key, row);
        continue;
      }
      // Keep whichever real name there is, and no word standing in for one:
      // an own mailbox that nothing knows a name for is shown by its
      // address, the way every other nameless contact is.
      byEmail.set(key, {
        ...row,
        name: row.name || prev.name,
        recordName: row.recordName || prev.recordName || t("yourMailbox"),
        source: row.source === "self" || prev.source === "self" ? "self" : row.source,
      });
    }
    return [...byEmail.values()];
  }, [contacts, ownAccounts]);

  const menu = filterMenu(draft, contactsForMenu, lists, values);
  const showMenu = menuOpen && menu.length > 0;

  React.useEffect(() => {
    setHighlight(0);
  }, [draft, values.length]);

  React.useEffect(() => {
    if (!values.length) {
      setSelected(new Set());
      setAnchor(null);
      setFocusIndex(null);
      return;
    }
    setSelected((prev) => {
      const next = new Set<number>();
      for (const i of prev) {
        if (i >= 0 && i < values.length) next.add(i);
      }
      return next.size === prev.size ? prev : next;
    });
    setFocusIndex((i) =>
      i == null || i < values.length ? i : values.length - 1
    );
    setAnchor((a) =>
      a == null || a < values.length ? a : values.length - 1
    );
  }, [values.length]);

  const cancelBlurTimer = React.useCallback(() => {
    if (blurTimer.current != null) {
      window.clearTimeout(blurTimer.current);
      blurTimer.current = null;
    }
  }, []);

  const focusDraftInput = React.useCallback(() => {
    cancelBlurTimer();
    const el = inputElRef.current;
    if (!el) return;
    if (document.activeElement !== el) {
      el.focus({ preventScroll: true });
    }
  }, [cancelBlurTimer]);

  const cursorAtDraftStart = React.useCallback(
    (el: HTMLInputElement | null = inputElRef.current) => {
      if (!el) return !draft;
      return el.selectionStart === 0 && el.selectionEnd === 0;
    },
    [draft]
  );

  const clearChipSelection = React.useCallback(() => {
    setSelected(new Set());
    setAnchor(null);
    setFocusIndex(null);
    chipNavRef.current = {
      ...chipNavRef.current,
      selected: new Set(),
      anchor: null,
      focusIndex: null,
    };
  }, []);

  const selectOnly = React.useCallback((index: number) => {
    const next = new Set([index]);
    setSelected(next);
    setAnchor(index);
    setFocusIndex(index);
    setMenuOpen(false);
    chipNavRef.current = {
      ...chipNavRef.current,
      selected: next,
      anchor: index,
      focusIndex: index,
    };
  }, []);

  const selectRange = React.useCallback((from: number, to: number) => {
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const next = new Set<number>();
    for (let i = lo; i <= hi; i++) next.add(i);
    setSelected(next);
    setFocusIndex(to);
    setMenuOpen(false);
    chipNavRef.current = {
      ...chipNavRef.current,
      selected: next,
      focusIndex: to,
    };
  }, []);

  const selectAllChips = React.useCallback(() => {
    if (!values.length) return;
    const next = new Set<number>();
    for (let i = 0; i < values.length; i++) next.add(i);
    setSelected(next);
    setAnchor(0);
    setFocusIndex(values.length - 1);
    setMenuOpen(false);
    chipNavRef.current = {
      ...chipNavRef.current,
      selected: next,
      anchor: 0,
      focusIndex: values.length - 1,
    };
  }, [values.length]);

  const removeSelectedChips = React.useCallback(() => {
    const { selected: sel } = chipNavRef.current;
    if (!sel.size) return;
    const next = values.filter((_, i) => !sel.has(i));
    onChange(next);
    // Where the block began is where the writer was looking.
    const at = chipSelectionAfterRemoval(Math.min(...sel), next.length);
    if (at == null) clearChipSelection();
    else selectOnly(at);
  }, [values, onChange, clearChipSelection, selectOnly]);

  const handleChipSelect = React.useCallback(
    (index: number, e: React.MouseEvent) => {
      const { anchor: currentAnchor } = chipNavRef.current;
      if (e.shiftKey && currentAnchor != null) {
        selectRange(currentAnchor, index);
      } else {
        selectOnly(index);
      }
      // The chip takes focus on mouse-down and hands it back on mouse-up.
      // Focus the input here too, for a selection made without a mouse.
      focusDraftInput();
    },
    [selectOnly, selectRange, focusDraftInput]
  );

  /** Arrow / delete navigation among recipient chips (Gmail-style). */
  const handleChipArrowKey = React.useCallback(
    (e: React.KeyboardEvent, goingLeft: boolean) => {
      const nav = chipNavRef.current;
      const count = nav.valuesLength;
      if (!count) return false;

      const inChipMode = nav.focusIndex != null;
      const canEnterChips =
        !draft &&
        (inChipMode || (goingLeft && cursorAtDraftStart(inputElRef.current)));

      if (!canEnterChips && !inChipMode) return false;

      if (!inChipMode && goingLeft) {
        e.preventDefault();
        selectOnly(count - 1);
        return true;
      }
      if (!inChipMode) return false;

      e.preventDefault();
      const current = nav.focusIndex ?? 0;
      const anchorAt = nav.anchor ?? current;

      if (goingLeft) {
        if (current <= 0) {
          if (!e.shiftKey) selectOnly(0);
          return true;
        }
        const next = current - 1;
        if (e.shiftKey) selectRange(anchorAt, next);
        else selectOnly(next);
        return true;
      }

      // ArrowRight
      if (current >= count - 1) {
        if (!e.shiftKey) {
          clearChipSelection();
        }
        return true;
      }
      const next = current + 1;
      if (e.shiftKey) selectRange(anchorAt, next);
      else selectOnly(next);
      return true;
    },
    [draft, cursorAtDraftStart, selectOnly, selectRange, clearChipSelection]
  );

  const commitDraft = (raw: string) => {
    const added = parseEmails(raw);
    if (!added.length) {
      setDraft("");
      setMenuOpen(false);
      return;
    }
    const next = [...values];
    const seen = new Set(emailsOfRecipients(values));
    for (const email of added) {
      if (seen.has(email)) continue;
      seen.add(email);
      next.push({
        kind: "email",
        email,
        name: nameForEmail(email, contacts),
      });
    }
    onChange(next);
    setDraft("");
    setMenuOpen(false);
    clearChipSelection();
  };

  const pickItem = (item: MenuItem) => {
    cancelBlurTimer();
    clearChipSelection();
    if (item.kind === "list") {
      if (values.some((v) => v.kind === "list" && v.listId === item.list.id)) {
        setDraft("");
        setMenuOpen(false);
        return;
      }
      onChange([
        ...values,
        {
          kind: "list",
          listId: item.list.id,
          name: item.list.name,
          members: item.list.members,
        },
      ]);
    } else {
      const email = item.contact.email.trim().toLowerCase();
      if (!values.some((v) => v.kind === "email" && v.email === email)) {
        onChange([
          ...values,
          {
            kind: "email",
            email,
            name: item.contact.name || undefined,
          },
        ]);
      }
    }
    setDraft("");
    setMenuOpen(false);
  };

  const emailPeople = values.filter(
    (v): v is Extract<MailRecipient, { kind: "email" }> => v.kind === "email"
  );
  const showSaveList = allowSaveList && emailPeople.length >= 2;

  const listItems = menu.filter((i) => i.kind === "list");
  const contactItems = menu.filter((i) => i.kind === "contact");
  /** The list the pencil was pressed on, from wherever it was pressed. */
  const [editingList, setEditingList] = React.useState<MailContactList | null>(
    null
  );
  const openListEditor = (list: MailContactList) => {
    cancelBlurTimer();
    // Whatever was half-typed is not an address, and committing it on the
    // way out would leave a chip nobody asked for behind the editor.
    setDraft("");
    setMenuOpen(false);
    setEditingList(list);
  };
  // A list edited elsewhere, or deleted, must not stay open on the old copy.
  React.useEffect(() => {
    if (!editingList) return;
    const fresh = lists.find((l) => l.id === editingList.id);
    if (!fresh) setEditingList(null);
  }, [lists, editingList]);

  /**
   * How much of the menu there is room for, and which way it opens.
   *
   * It hung a fixed height below the field, which is fine in the middle of a
   * window and runs off the bottom of one anywhere near it — the addresses
   * furthest down the list were the ones nobody could reach.
   */
  const [menuBox, setMenuBox] = React.useState({
    above: false,
    maxHeight: 288,
    /** The whole drop, before the menu's own cap — the editor wants more. */
    room: 288,
  });
  React.useEffect(() => {
    if (!showMenu && !editingList) return;
    const measure = () => {
      const el = fieldElRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const margin = 12;
      // The room is measured in screen pixels and spent in the field's
      // own, and the two differ by whatever `zoom` the composer card is
      // under: at 122% a menu given the room it measured ran a fifth past
      // the bottom of the window. The field's rect against its offset
      // height is that zoom, whatever ancestor carries it.
      const scale = el.offsetHeight ? rect.height / el.offsetHeight : 1;
      const below = (window.innerHeight - rect.bottom - margin) / scale;
      const above = (rect.top - margin) / scale;
      // Downwards by default, which is where a reader expects it. Upwards
      // only when there is really no room and more of it the other way.
      const flip = below < 200 && above > below;
      const drop = flip ? above : below;
      setMenuBox({
        above: flip,
        maxHeight: Math.max(140, Math.min(288, drop)),
        room: Math.max(140, drop),
      });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [showMenu, editingList]);

  /**
   * The chips actually drawn, and how many are folded away.
   *
   * Folded only while the field is at rest: typing in it, or unfolding by
   * hand, shows them all. A chip that cannot be seen cannot be removed, so
   * this never hides one from somebody working on the list.
   */
  const folding =
    collapseAfter != null &&
    !writing &&
    !unfolded &&
    values.length > collapseAfter;
  const shownValues = folding ? values.slice(0, collapseAfter) : values;
  const foldedCount = values.length - shownValues.length;

  /*
    Carrying somebody from this field to another.

    The chip says what it is and how to take it out of here; the field it
    is dropped on adds it and then calls that. So neither field knows the
    other exists — which is what lets To, Cc and Bcc trade without a
    composer standing between them holding all three.
  */
  const carry = React.useContext(RecipientCarry);
  const fieldId = React.useId();
  const [carriedOver, setCarriedOver] = React.useState(false);
  const carriedFromElsewhere =
    carry?.carried != null && carry.carried.fieldId !== fieldId;

  const carryProps = (value: MailRecipient) =>
    carry
      ? {
          draggable: true,
          onDragStart: (event: React.DragEvent) => {
            // Something has to be on the drag or the browser refuses it.
            event.dataTransfer.setData("text/plain", recipientKey(value));
            event.dataTransfer.effectAllowed = "move";
            // The mouse going down selected this chip and no mouse-up will
            // follow; once it has gone the ring would fall on the next
            // chip, and a Backspace would take that one.
            clearChipSelection();
            carry.setCarried({
              fieldId,
              recipient: value,
              takeFromSource: () =>
                onChange(
                  values.filter((v) => recipientKey(v) !== recipientKey(value))
                ),
            });
          },
          onDragEnd: () => carry.setCarried(null),
        }
      : undefined;

  const dropProps = carry
    ? {
        onDragOver: (event: React.DragEvent) => {
          if (!carriedFromElsewhere) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move" as const;
          if (!carriedOver) setCarriedOver(true);
        },
        onDragLeave: (event: React.DragEvent) => {
          // Only when the pointer has left the field, not one of its chips.
          if (event.currentTarget.contains(event.relatedTarget as Node)) return;
          setCarriedOver(false);
        },
        onDrop: (event: React.DragEvent) => {
          setCarriedOver(false);
          const carried = carry.carried;
          if (!carried || carried.fieldId === fieldId) return;
          event.preventDefault();
          carry.setCarried(null);
          // Already here: the move is only a removal from where it was.
          const here = new Set(values.map((v) => recipientKey(v)));
          if (!here.has(recipientKey(carried.recipient))) {
            onChange([...values, carried.recipient]);
          }
          carried.takeFromSource();
        },
      }
    : undefined;

  return (
    <div
      className={cn(
        "relative flex min-w-0 flex-1 flex-wrap items-start gap-1.5",
        className
      )}
      /* On the whole field, not on the box inside it: a chip is let go
         over the row it is meant for, and the gaps between the chips are
         as much a part of that row as the chips are. */
      {...dropProps}
    >
      <div
        ref={fieldElRef}
        className={cn(
          "relative min-w-0 flex-1",
          /* Lit while somebody is being carried over it, so it is plain
             which field they will land in — and read from the carry as
             well as from the pointer, so a drag abandoned outside the
             window does not leave a field lit for a drop that is not
             coming. */
          carriedOver &&
            carriedFromElsewhere &&
            "rounded-xl ring-2 ring-teal-500/60",
          /* Block rather than flex when the field has a box round it, so
             "Save as list…" can float into its top right corner: the chips
             wrap around it on the first line and take the whole width
             below. As a flex item it could only be a column of its own,
             beside the box, which cost more room than the addresses. */
          variant === "boxed"
            ? "rounded-xl border border-stone-200 bg-white px-2.5 py-1.5 focus-within:border-stone-300"
            : "flex flex-wrap items-center gap-1.5",
          /*
            While the suggestions are open, the box and the list are one
            shape: the side where they meet goes square on both, and the
            list starts on the box's own border. A list that floated a few
            pixels off, under round corners, read as a second thing on the
            page and not as what the box is offering.
          */
          variant === "boxed" &&
            showMenu &&
            !editingList &&
            (menuBox.above ? "rounded-t-none" : "rounded-b-none")
        )}
        onMouseDown={(e) => {
          // Clicking empty padding in the field should keep/restore input focus
          // without clearing an existing chip selection.
          if (e.target === e.currentTarget) {
            focusDraftInput();
          }
        }}
      >
        {variant === "boxed" && showSaveList ? (
          <SaveAsListControl
            className="float-right ml-2 mb-1"
            people={emailPeople}
            contacts={contacts}
            onSaved={() => {
              /* recipients stay; list is available next typeahead */
            }}
          />
        ) : null}
        {variant === "boxed" && label ? (
          <span className={cn("text-xs text-muted-foreground", "mr-1.5")}>
            {label}
          </span>
        ) : null}
        {shownValues.map((value, index) => {
          const isSelected = selected.has(index);
          if (value.kind === "list") {
            return (
              <ListChip
                key={recipientKey(value)}
                recipient={value}
                contacts={contacts}
                variant={variant}
                carry={carryProps(value)}
                selected={isSelected}
                onSelect={(e) => handleChipSelect(index, e)}
                onRelease={focusDraftInput}
                onChange={(next) => {
                  const copy = [...values];
                  copy[index] = next;
                  onChange(copy);
                }}
                onExpand={() => {
                  clearChipSelection();
                  const others = values.filter((_, i) => i !== index);
                  const taken = new Set(emailsOfRecipients(others));
                  const expanded: MailRecipient[] = [...others];
                  for (const m of value.members) {
                    const e = m.email.toLowerCase();
                    if (taken.has(e)) continue;
                    taken.add(e);
                    expanded.push({
                      kind: "email",
                      email: e,
                      name: m.name || nameForEmail(e, contacts),
                    });
                  }
                  onChange(expanded);
                }}
                onRemove={() => {
                  clearChipSelection();
                  onChange(values.filter((_, i) => i !== index));
                }}
              />
            );
          }
          return (
            <EmailChip
              key={recipientKey(value)}
              recipient={value}
              contacts={contacts}
              variant={variant}
              carry={carryProps(value)}
              selected={isSelected}
              onSelect={(e) => handleChipSelect(index, e)}
              onRelease={focusDraftInput}
              onRemove={() => {
                clearChipSelection();
                onChange(values.filter((_, i) => i !== index));
              }}
            />
          );
        })}
        {folding ? (
          <button
            type="button"
            className={cn(
              "shrink-0 rounded-full px-1.5 py-0.5 text-[13px] font-medium text-teal-700 hover:underline",
              variant === "boxed" && "mb-1 align-middle"
            )}
            onClick={() => {
              setUnfolded(true);
              focusDraftInput();
            }}
          >
            {t("andMoreCount", { count: foldedCount })}
          </button>
        ) : null}
        <input
          ref={setInputRef}
          value={draft}
          onChange={(e) => {
            const next = e.target.value;
            clearChipSelection();
            if (/[,;]\s*$/.test(next)) commitDraft(next);
            else {
              setDraft(next);
              setMenuOpen(true);
            }
          }}
          onFocus={() => {
            cancelBlurTimer();
            setWriting(true);
            if (chipNavRef.current.focusIndex == null) setMenuOpen(true);
          }}
          /*
            Addresses pasted in become chips at once, not text waiting for
            an Enter. That is what a paste of cut or copied chips expects,
            and a list from a spreadsheet or an email header too. Text with
            no address in it is left to the browser, as typing.
          */
          onPaste={(e) => {
            const text = e.clipboardData.getData("text/plain");
            if (!parseEmails(text).length) return;
            e.preventDefault();
            commitDraft(`${draft} ${text}`);
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
              if (values.length) {
                e.preventDefault();
                selectAllChips();
                const input = e.currentTarget;
                const end = input.value.length;
                input.setSelectionRange(end, end);
              }
              return;
            }

            /**
             * Copy the selected chips.
             *
             * The cursor sits in the input, which has nothing selected, so
             * the browser's own copy would put an empty string on the
             * clipboard and the selection would look ignored.
             */
            if (
              (e.metaKey || e.ctrlKey) &&
              (e.key.toLowerCase() === "c" || e.key.toLowerCase() === "x") &&
              chipNavRef.current.selected.size > 0
            ) {
              e.preventDefault();
              // Cut is copy and then take them out, the way text is cut:
              // the chips are gone from here and waiting on the clipboard
              // for the field they are meant for.
              const cutting = e.key.toLowerCase() === "x";
              const picked = values.filter((_, i) =>
                chipNavRef.current.selected.has(i)
              );
              const text = recipientsToClipboardText(picked);
              if (!text) return;
              void copyTextToClipboard(text).then((ok) => {
                if (!ok) {
                  toast.error(mailSay("couldNotCopy"));
                  return;
                }
                if (cutting) removeSelectedChips();
                const n = text.split(", ").length;
                toast(
                  `${n} address${n === 1 ? "" : "es"} ${cutting ? "cut" : "copied"}`
                );
              });
              return;
            }

            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              if (handleChipArrowKey(e, e.key === "ArrowLeft")) return;
            }

            const nav = chipNavRef.current;
            if (nav.selected.size > 0 || nav.focusIndex != null) {
              if (e.key === "Escape") {
                e.preventDefault();
                clearChipSelection();
                return;
              }
              if (e.key === "Backspace" || e.key === "Delete") {
                e.preventDefault();
                if (nav.selected.size > 0) removeSelectedChips();
                else if (nav.focusIndex != null) {
                  const idx = nav.focusIndex;
                  const next = values.filter((_, i) => i !== idx);
                  onChange(next);
                  const at = chipSelectionAfterRemoval(idx, next.length);
                  if (at == null) clearChipSelection();
                  else selectOnly(at);
                }
                return;
              }
              if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
                clearChipSelection();
              }
            }

            if (showMenu && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              setHighlight((h) => {
                if (e.key === "ArrowDown") return (h + 1) % menu.length;
                return (h - 1 + menu.length) % menu.length;
              });
              return;
            }
            if (e.key === "Escape" && showMenu) {
              e.preventDefault();
              setMenuOpen(false);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              if (showMenu && menu[highlight]) {
                e.preventDefault();
                pickItem(menu[highlight]);
                return;
              }
              if (draft.trim()) {
                e.preventDefault();
                commitDraft(draft);
                return;
              }
              if (e.key === "Tab" && !e.shiftKey && onTabOut) {
                e.preventDefault();
                onTabOut();
                return;
              }
            } else if (
              e.key === "Backspace" &&
              !draft &&
              nav.selected.size === 0 &&
              nav.focusIndex == null &&
              values.length
            ) {
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={(e) => {
            const next = e.relatedTarget as Node | null;
            if (next && fieldElRef.current?.contains(next)) {
              return;
            }
            blurTimer.current = window.setTimeout(() => {
              if (draft.trim()) commitDraft(draft);
              setMenuOpen(false);
              clearChipSelection();
              // Folded again on the way out, and the hand-unfold forgotten:
              // leaving the field is what says the writer is done with it.
              setWriting(false);
              setUnfolded(false);
            }, 120);
          }}
          placeholder={values.length ? "Add…" : placeholder}
          className={cn(
            "min-w-[16ch] bg-transparent outline-none placeholder:text-stone-400",
            variant === "boxed"
              ? // Wide enough to type in, and it takes the rest of the line
                // rather than a line of its own. Empty, it shows the
                // placeholder, which is longer than sixteen letters: it
                // takes the line, less the label and the list button.
                cn(
                  "mb-1 max-w-full align-middle",
                  values.length ? "w-[16ch]" : "w-[calc(100%-4.5rem)]"
                )
              : "flex-1",
            // While the rest are folded away, "Add…" beside "and 24 more"
            // reads as a second thing to press. The field is one click from
            // being whole again, and that click puts the cursor here.
            folding && "sr-only",
            variant === "inline"
              ? "py-0.5 text-[15px] text-stone-800"
              : "py-0.5 text-sm"
          )}
          /*
            The Mac's own suggestions, switched off in this one box.

            Type "peter" and macOS put up its own bubble — "Peter", with a
            cross — to capitalise it, and while that bubble was up the down
            arrow went to it and not to the list underneath. The list is
            the suggestion here: this box holds names and addresses, which
            are neither misspelled nor in want of a capital, and the keys
            have to reach the app's list on the first press. Spellcheck and
            autocapitalize off with it, since each is a way for the system
            to take the keys.
          */
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={showMenu}
          aria-autocomplete="list"
        />
        {lists.length ? (
          <ListsMenu
            lists={lists}
            onPick={(list) => pickItem({ kind: "list", list })}
            onEdit={openListEditor}
            /* The far right of the field, whichever way the field is laid
               out. `ml-auto` reaches it in the inline variant, which is a
               flex row; a boxed field is block flow, where the only way to
               the right edge is to float — the same way "Save as list…"
               gets to the corner above it. */
            className={variant === "boxed" ? "float-right ml-2" : "ml-auto"}
          />
        ) : null}
        {editingList ? (
          <ListEditorCard
            list={editingList}
            contacts={contacts}
            above={menuBox.above}
            /*
              Taller than the suggestions are allowed to be. A name, the
              people, a box to add one and two buttons come to a little
              over their 288 — at which the row holding "Done" fell below
              the fold of a panel nobody expected to scroll.
            */
            maxHeight={Math.min(440, menuBox.room)}
            onClose={() => setEditingList(null)}
            onSaved={(saved) => {
              // A list already in this message follows the edit.
              onChange(
                values.map((v) =>
                  v.kind === "list" && v.listId === saved.id
                    ? { ...v, name: saved.name, members: saved.members }
                    : v
                )
              );
            }}
            onDeleted={(listId) => {
              onChange(
                values.filter((v) => !(v.kind === "list" && v.listId === listId))
              );
            }}
          />
        ) : null}
        {showMenu && !editingList ? (
          <ul
            role="listbox"
            // The reply band clips what hangs out of it; see mail.css.
            data-recipient-menu=""
            className={cn(
              "absolute z-30 overflow-y-auto border border-stone-200 bg-white py-1 shadow-lg",
              /*
                Joined to a boxed field: see the field's own classes. `-px`
                each side puts the list's border over the box's, since
                `left-0` is the inside of that border. With no margin the
                list's first line lies on the box's last one, so there is
                one line between them and not two. The inline field has no
                box to join, and keeps its small gap.
              */
              variant === "boxed"
                ? cn(
                    "-left-px -right-px border-stone-300",
                    menuBox.above
                      ? "bottom-full rounded-t-xl"
                      : "top-full rounded-b-xl"
                  )
                : cn(
                    "left-0 right-0 rounded-lg",
                    menuBox.above ? "bottom-full mb-1" : "top-full mt-1"
                  )
            )}
            style={{ maxHeight: menuBox.maxHeight }}
          >
            {listItems.length ? (
              <>
                <li className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-stone-400">
                  {t("lists")}
                </li>
                {listItems.map((item) => {
                  const i = menu.indexOf(item);
                  return (
                    <li
                      key={item.list.id}
                      role="option"
                      aria-selected={i === highlight}
                      /* The row is a button and the pencil is a button, so
                         the two cannot nest — the pencil rides alongside,
                         on a row that is the hover group. */
                      className={cn(
                        "group flex items-center",
                        i === highlight ? HIGHLIGHT_ROW : "hover:bg-stone-50"
                      )}
                      onMouseEnter={() => setHighlight(i)}
                    >
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2.5 py-2 pl-3 text-left"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          pickItem(item);
                        }}
                      >
                        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-600 text-white">
                          <Users className="h-4 w-4" />
                        </span>
                        <span className="min-w-0">
                          <span
                            className={cn(
                              "block truncate text-sm font-medium",
                              i === highlight
                                ? "text-[var(--mail-chrome-pinned-fg)]"
                                : "text-stone-900"
                            )}
                          >
                            {item.list.name}
                          </span>
                          <span
                            className={cn(
                              "block text-xs",
                              i === highlight
                                ? "text-[var(--mail-chrome-pinned-fg)] opacity-70"
                                : "text-stone-500"
                            )}
                          >
                            {listSubtitle(t, item.list.members.length)}
                          </span>
                        </span>
                      </button>
                      <EditListButton
                        onEdit={() => openListEditor(item.list)}
                        className={cn(
                          "mr-2",
                          i === highlight
                            ? "text-[var(--mail-chrome-pinned-fg)] opacity-70 hover:bg-white/15"
                            : "text-stone-400 hover:text-stone-700"
                        )}
                      />
                    </li>
                  );
                })}
              </>
            ) : null}
            {contactItems.length ? (
              <>
                {listItems.length ? (
                  <li className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-stone-400">
                    {t("people")}
                  </li>
                ) : null}
                {contactItems.map((item) => {
                  const i = menu.indexOf(item);
                  const badgeKey = contactSourceBadge(item.contact);
                  const badge = badgeKey ? t(badgeKey) : null;
                  // The Mac's address book, said with the apple rather than
                  // with a longer word: four things here are called Contacts.
                  const fromMac = item.contact.source === "mac";
                  const isHistory = item.contact.source === "history";
                  // Every row must show the address it will insert. A history
                  // row needs it most: the person is in no contact list, so
                  // the reader cannot know which of their addresses this is.
                  const emailedWhen = isHistory
                    ? historyEmailedWhen(item.contact.lastEmailedAt, t)
                    : null;
                  const subtitle = isHistory
                    ? emailedWhen
                      ? `${item.contact.email} · ${emailedWhen}`
                      : item.contact.email
                    : item.contact.name
                      ? item.contact.email
                      : item.contact.recordName || item.contact.email;
                  return (
                    <li
                      key={item.contact.email}
                      role="option"
                      aria-selected={i === highlight}
                      className="group"
                    >
                      <div
                        className={cn(
                          "flex w-full items-center gap-2 px-3 py-2",
                          i === highlight ? HIGHLIGHT_ROW : "hover:bg-stone-50"
                        )}
                        onMouseEnter={() => setHighlight(i)}
                      >
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            pickItem(item);
                          }}
                        >
                          {isHistory ? (
                            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-500">
                              <Clock className="h-4 w-4" aria-hidden />
                            </span>
                          ) : (
                            <span
                              className={cn(
                                "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                                avatarTone(item.contact.email)
                              )}
                            >
                              {initials(item.contact.name, item.contact.email)}
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span
                              className={cn(
                                "block truncate text-sm font-medium",
                                i === highlight
                                  ? "text-[var(--mail-chrome-pinned-fg)]"
                                  : "text-stone-900"
                              )}
                            >
                              {item.contact.name || item.contact.email}
                            </span>
                            <span
                              className={cn(
                                "block truncate text-xs",
                                i === highlight
                                  ? "text-[var(--mail-chrome-pinned-fg)] opacity-70"
                                  : "text-stone-500"
                              )}
                              title={subtitle}
                            >
                              {subtitle}
                            </span>
                          </span>
                        </button>
                        {isHistory ? (
                          <button
                            type="button"
                            title={t("removeFromSuggestions")}
                            aria-label={`Remove ${item.contact.email} from suggestions`}
                            className="hidden shrink-0 rounded p-1 text-stone-400 hover:bg-stone-200/60 hover:text-stone-700 group-hover:inline-flex"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              void hideHistory(item.contact.email);
                            }}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                        {badge ? (
                          <span
                            className={cn(
                              "flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                              provenanceBadgeClass(item.contact.source)
                            )}
                          >
                            {fromMac ? <AppleMark /> : null}
                            {badge}
                          </span>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </>
            ) : null}
            {sourceSummaries.length ? (
              <li className="mt-1 border-t border-stone-100 px-3 py-2 text-[11px] leading-relaxed text-stone-400">
                {formatSearchingFooter(sourceSummaries)}
                {" · "}
                <button
                  type="button"
                  className="font-medium text-teal-700 hover:underline"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setMenuOpen(false);
                    openContactSourcesDialog();
                  }}
                >
                  {t("manage")}
                </button>
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
      {(showSaveList && variant !== "boxed") || actions ? (
        /* A column, not a row: "Save as list…" is a thing you do to the
           addresses above it, and Cc/Bcc are two more fields to open. Side
           by side they read as three of a kind. */
        <span className="flex shrink-0 flex-col items-end gap-1 self-start pt-0.5">
          {showSaveList && variant !== "boxed" ? (
            <SaveAsListControl
              people={emailPeople}
              contacts={contacts}
              onSaved={() => {
                /* recipients stay; list is available next typeahead */
              }}
            />
          ) : null}
          {actions}
        </span>
      ) : null}
    </div>
  );
}
