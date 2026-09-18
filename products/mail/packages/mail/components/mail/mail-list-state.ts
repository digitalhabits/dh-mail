"use client";

import type { MailFolder, MailFolderRole } from "@/lib/mail/folder-types";

/*
 * The mail list's stored state and small answers, off the page component:
 * which view and density and tab the reader chose, the pinned threads and
 * people, the custom lists, the tab order, the mailbox scope a search
 * runs in, and the cached list a mount can paint before its fetch lands.
 * Hooks and functions only — what they feed is MailPage's.
 */

import type { MailPageSnapshot } from "@/components/mail/MailPage";

import * as React from "react";
import { listMailPersonPins, subscribeMailPersonPins, type MailPersonPin } from "@/lib/mail/person-pins";
import { mailConnectHref } from "@/lib/mail/connect-mailbox";
import { mailPeopleTabLabel, mailUsesCrmPeople } from "@/lib/mail/product-flavor";
import { customListTabId, MAIL_CUSTOM_LISTS_EVENT, parseCustomListTabId, readCustomLists, scheduledCustomListTabId, type MailCustomList } from "@/lib/mail/custom-lists";
import { listMailPins, subscribeMailPins, type MailPinRecord } from "@/lib/mail/pins";
import { getPageSnapshot, mailPageCacheKey } from "@/lib/page-snapshot-cache";
import { type MailT } from "@/lib/mail/i18n";
import { MAIL_FOLDER_VIEWS } from "@/lib/mail/folder-views";
import { scheduledBuiltinTabId } from "@/lib/mail/tab-schedules";
import type { MailTab, MailThreadSummary } from "@/lib/mail/types";
import { mailListCacheKey, readCachedList, writeCachedList, type MailListCacheEntry } from "@/lib/mail/list-cache";
import { type MailListDensity, type MailViewMode } from "@/components/mail/MailListControls";

export function gmailOauthHref(email?: string): string {
  return mailConnectHref("gmail", email);
}

export function outlookOauthHref(email?: string): string {
  return mailConnectHref("outlook", email);
}


/**
 * The list cursor is a base64url JSON map of account → provider page token
 * (see encodeMailListCursor server-side). Per-account fetches each return a
 * single-entry cursor; decode/merge/re-encode so load-more keeps working.
 */
export function decodeCursorTokens(
  cursor: string | null | undefined
): Record<string, string> {
  if (!cursor) return {};
  try {
    const parsed = JSON.parse(
      atob(cursor.replace(/-/g, "+").replace(/_/g, "/"))
    ) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [email, token] of Object.entries(parsed)) {
      if (typeof token === "string" && token) out[email] = token;
    }
    return out;
  } catch {
    return {};
  }
}

export function encodeCursorTokens(tokens: Record<string, string>): string | null {
  const entries = Object.entries(tokens).filter(([email, token]) =>
    Boolean(email && token)
  );
  if (!entries.length) return null;
  try {
    return btoa(JSON.stringify(Object.fromEntries(entries)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  } catch {
    return null;
  }
}

/** Stable empty list for SSR — getServerSnapshot must not allocate each call. */
const EMPTY_MAIL_PINS: MailPinRecord[] = [];

function getServerMailPins(): MailPinRecord[] {
  return EMPTY_MAIL_PINS;
}

/** Pins are local; subscribe so every list/toolbar updates together. */
export function useMailPins(): MailPinRecord[] {
  return React.useSyncExternalStore(
    subscribeMailPins,
    listMailPins,
    getServerMailPins
  );
}

const EMPTY_PERSON_PINS: MailPersonPin[] = [];

function getServerMailPersonPins(): MailPersonPin[] {
  return EMPTY_PERSON_PINS;
}

/** Pinned correspondents, for the by-person view. Also local. */
export function useMailPersonPins(): MailPersonPin[] {
  return React.useSyncExternalStore(
    subscribeMailPersonPins,
    listMailPersonPins,
    getServerMailPersonPins
  );
}


/** How the left list is organised: one row per thread, or one per person. */

const MAIL_VIEW_MODE_KEY = "redd-plan-mail-view-mode";

const MAIL_LIST_DENSITY_KEY = "redd-plan-mail-list-density";

/**
 * Builtin list tabs, or `custom:<id>` for user-defined people filters.
 * Snoozed is ephemeral (only when something is snoozed) and not reordered.
 */
export type MailListTab = MailTab | "all" | "sent" | "snoozed" | string;

const MAIL_TAB_KEY = "redd-plan-mail-tab";
const MAIL_TAB_ORDER_KEY = "redd-plan-mail-tab-order";

/**
 * Builtin tabs that always exist (custom lists append after these by default).
 *
 * Sent is not among them: it lives at the top of the folders menu, with
 * Drafts, rather than taking a permanent chip beside the lists you read. It is
 * still a selectable view — see MAIL_OFF_TAB_VIEWS — and shows a chip of its
 * own while it is the one open, the way Snoozed does.
 */
export const MAIL_LIST_TABS: MailListTab[] = ["all", "people", "other"];

/** Views that are selectable but keep no permanent chip in the tab row. */
export const MAIL_OFF_TAB_VIEWS = [
  "sent",
  "drafts",
  "trash",
  "junk",
  "archived",
  "snoozed",
];

/**
 * Views the provider holds in a folder of its own, so the list has to ask for
 * it by name. Snoozed is ours and Drafts has its own endpoint, so neither is
 * here.
 */
export const SERVER_FOLDER_VIEWS: readonly string[] = MAIL_FOLDER_VIEWS;

export function mailBuiltinTabLabels(t: MailT): Record<string, string> {
  return {
    all: t("tabAll"),
    people: mailPeopleTabLabel(t),
    other: t("tabOther"),
    sent: t("viewSent"),
    drafts: t("viewDrafts"),
    trash: t("viewTrash"),
    junk: t("viewJunk"),
    archived: t("viewArchived"),
    snoozed: t("viewSnoozed"),
  };
}

/**
 * What the search box offers to search, which is whatever is open.
 *
 * The field used to name the mailboxes — "Search all mail", "Search in
 * this mailbox · gmail" — and say nothing about the view, back when a search
 * ignored the view entirely. Now that a search stays inside it, this is the
 * half that changes and the mailboxes are named by the menu beside it.
 */
export function mailSearchPlaceholder(input: {
  folderName: string | null;
  customListName: string | null;
  tab: string;
  t: MailT;
}): string {
  const { t } = input;
  if (input.folderName) return t("searchIn", { name: input.folderName });
  if (input.customListName) {
    return t("searchIn", { name: input.customListName });
  }
  switch (input.tab) {
    case "people":
      // The word the tab uses, in a sentence: "In Contacts" and "In CRM"
      // name a pile, and this has to name where the mail came from.
      return t(mailUsesCrmPeople() ? "searchFromCrm" : "searchFromContacts");
    case "other":
      return t("searchFromOthers");
    case "sent":
      return t("searchSent");
    case "drafts":
      return t("searchDrafts");
    case "trash":
      return t("searchTrash");
    case "junk":
      return t("searchJunk");
    case "archived":
      return t("searchArchived");
    case "snoozed":
      return t("searchSnoozed");
    default:
      return t("searchAll");
  }
}

/**
 * What an empty list shows while it is being fetched.
 *
 * Not a skeleton. Grey bars shaped like rows are a promise that rows are
 * about to appear in a moment, which is a fair thing to say about a render
 * and an unfair one about a round trip to Google — a big folder takes
 * seconds, and for all of them the reader is watching something that looks
 * like mail it cannot read. A spinner does not pretend to be the content,
 * and the line under it says where the wait is: not that the app is stuck,
 * but that a server is being asked.
 */
function subscribeCustomLists(onChange: () => void): () => void {
  window.addEventListener(MAIL_CUSTOM_LISTS_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(MAIL_CUSTOM_LISTS_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

const EMPTY_CUSTOM_LISTS_SNAPSHOT: MailCustomList[] = [];

export function useMailCustomLists(): MailCustomList[] {
  return React.useSyncExternalStore(
    subscribeCustomLists,
    readCustomLists,
    () => EMPTY_CUSTOM_LISTS_SNAPSHOT
  );
}

/**
 * Which filter the list opens on.
 *
 * All, unless the reader last left it somewhere else or a list is
 * scheduled to take over. It used to be In contacts, which is a filter —
 * a first run, or a reader who has never touched the row, was shown part
 * of their mail with nothing to say that the rest was being held back.
 * A mail app opens on the mail.
 */
function readStoredMailListTab(customLists: MailCustomList[]): MailListTab {
  if (typeof window === "undefined") return "all";
  // Scheduled lists win when you open Mail during their window, and so do
  // the built-in filters, which can now be scheduled the same way.
  const scheduled =
    scheduledCustomListTabId(customLists) ??
    scheduledBuiltinTabId(MAIL_LIST_TABS);
  if (scheduled) return scheduled;
  try {
    const stored = localStorage.getItem(MAIL_TAB_KEY);
    if (!stored) return "all";
    if (MAIL_OFF_TAB_VIEWS.includes(stored) || MAIL_LIST_TABS.includes(stored)) {
      return stored;
    }
    const listId = parseCustomListTabId(stored);
    if (listId && customLists.some((l) => l.id === listId)) return stored;
  } catch {
    /* private mode */
  }
  return "all";
}

/** Keep known tabs (builtins + existing custom lists), append any missing. */
function normalizeMailListTabOrder(
  raw: unknown,
  customLists: MailCustomList[]
): MailListTab[] {
  const customTabs = customLists.map((l) => customListTabId(l.id));
  const allowed = new Set<string>([...MAIL_LIST_TABS, ...customTabs]);
  const seen = new Set<string>();
  const next: MailListTab[] = [];
  if (Array.isArray(raw)) {
    for (const id of raw) {
      if (typeof id === "string" && allowed.has(id) && !seen.has(id)) {
        seen.add(id);
        next.push(id);
      }
    }
  }
  for (const id of MAIL_LIST_TABS) {
    if (!seen.has(id)) next.push(id);
  }
  for (const id of customTabs) {
    if (!seen.has(id)) next.push(id);
  }
  return next;
}

function readStoredMailListTabOrder(
  customLists: MailCustomList[]
): MailListTab[] {
  if (typeof window === "undefined") return MAIL_LIST_TABS;
  try {
    const stored = localStorage.getItem(MAIL_TAB_ORDER_KEY);
    if (!stored) return normalizeMailListTabOrder(null, customLists);
    return normalizeMailListTabOrder(JSON.parse(stored), customLists);
  } catch {
    return normalizeMailListTabOrder(null, customLists);
  }
}

/** Drag-reorderable tab order (builtins + custom lists), persisted. */
export function useMailListTabOrder(
  customLists: MailCustomList[]
): [MailListTab[], (order: MailListTab[]) => void] {
  const [order, setOrder] = React.useState<MailListTab[]>(MAIL_LIST_TABS);
  const customKey = customLists.map((l) => l.id).join("|");

  React.useLayoutEffect(() => {
    setOrder(readStoredMailListTabOrder(customLists));
    // customLists identity changes every read; key on ids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customKey]);

  const update = React.useCallback(
    (next: MailListTab[]) => {
      const normalized = normalizeMailListTabOrder(next, customLists);
      setOrder(normalized);
      try {
        localStorage.setItem(MAIL_TAB_ORDER_KEY, JSON.stringify(normalized));
      } catch {
        /* private mode */
      }
    },
    [customLists]
  );

  return [order, update];
}

/**
 * One filter, on the row the funnel opens.
 *
 * Lit when it is the one narrowing the list. The row holds the built-in
 * four, the reader's own lists, whichever of Sent/Drafts/Trash/Junk is open,
 * and the deleted-mail switch — so they all wear the same shape.
 */
export function peekMountCachedList(viewerId: string): MailListCacheEntry | null {
  if (typeof window === "undefined") return null;
  const tab = readStoredMailListTab(readCustomLists());
  // Don't paint a snoozed cache before we know the tab is available.
  if (tab === "snoozed") return null;
  const folder =
    tab === "sent"
      ? "sent"
      : tab === "trash"
        ? "trash"
        : tab === "junk"
          ? "junk"
          : tab === "archived"
            ? "archived"
            : "inbox";
  const keyed = readCachedList(viewerId, mailListCacheKey(folder, ""));
  if (keyed?.threads.length) return keyed;
  // Fall back to this viewer's page snapshot only (never another admin's).
  const snap = getPageSnapshot<MailPageSnapshot>(mailPageCacheKey(viewerId));
  if (snap?.ownerId === viewerId && snap.threads?.length) {
    return { threads: snap.threads, nextCursor: snap.listCursor ?? null };
  }
  return null;
}

/** Update threads in the cache while keeping the existing pagination cursor. */
export function patchCachedThreads(
  viewerId: string,
  key: string,
  threads: MailThreadSummary[]
): void {
  const prev = readCachedList(viewerId, key);
  writeCachedList(viewerId, key, {
    threads,
    nextCursor: prev?.nextCursor ?? null,
  });
}

/** Threads/People list mode, persisted across sessions. */
export function useMailViewMode(): [MailViewMode, (mode: MailViewMode) => void] {
  const [mode, setMode] = React.useState<MailViewMode>("threads");

  React.useEffect(() => {
    try {
      const stored = localStorage.getItem(MAIL_VIEW_MODE_KEY);
      if (stored === "people" || stored === "threads") setMode(stored);
    } catch {
      /* private mode */
    }
  }, []);

  const update = React.useCallback((next: MailViewMode) => {
    setMode(next);
    try {
      localStorage.setItem(MAIL_VIEW_MODE_KEY, next);
    } catch {
      /* private mode */
    }
  }, []);

  return [mode, update];
}

/** List row density, persisted across sessions. Default is comfortable. */
export function useMailListDensity(): [
  MailListDensity,
  (density: MailListDensity) => void,
] {
  const [density, setDensity] =
    React.useState<MailListDensity>("comfortable");

  React.useEffect(() => {
    try {
      const stored = localStorage.getItem(MAIL_LIST_DENSITY_KEY);
      if (stored === "comfortable" || stored === "compact") setDensity(stored);
    } catch {
      /* private mode */
    }
  }, []);

  const update = React.useCallback((next: MailListDensity) => {
    setDensity(next);
    try {
      localStorage.setItem(MAIL_LIST_DENSITY_KEY, next);
    } catch {
      /* private mode */
    }
  }, []);

  return [density, update];
}


/** Selected list tab, persisted so a refresh keeps you where you were. */
export function useMailListTab(
  customLists: MailCustomList[]
): [MailListTab, (tab: MailListTab) => void] {
  // Default matches SSR; restore localStorage / schedule in layout effect.
  const [tab, setTab] = React.useState<MailListTab>("all");
  // Include schedule fields so editing "default at set times" re-evaluates.
  const customKey = customLists
    .map(
      (l) =>
        `${l.id}:${l.scheduleDefault ? "1" : "0"}:${l.scheduleFrom ?? ""}:${l.scheduleTo ?? ""}:${(l.scheduleDays ?? []).join(",")}`
    )
    .join("|");

  React.useLayoutEffect(() => {
    setTab(readStoredMailListTab(customLists));
    // Re-validate when custom lists / schedules change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customKey]);

  const update = React.useCallback((next: MailListTab) => {
    setTab(next);
    try {
      localStorage.setItem(MAIL_TAB_KEY, next);
    } catch {
      /* private mode */
    }
  }, []);

  return [tab, update];
}

export function isMailboxScopeAll(selected: string[], accounts: string[]): boolean {
  return selected.length === 0 || selected.length >= accounts.length;
}

export function accountPassesMailboxScope(
  account: string,
  selected: string[],
  accounts: string[]
): boolean {
  if (isMailboxScopeAll(selected, accounts)) return true;
  const key = account.toLowerCase();
  return selected.some((email) => email.toLowerCase() === key);
}

/**
 * Local search, for the wait before the server answers.
 *
 * The provider searches whole message bodies and widens the query on the way
 * out (see `expandMailSearchQuery`). This cannot do either, so it must never
 * run over a result the server has already returned — it would hide real hits
 * whose match is in the body rather than the snippet. It runs only while the
 * rows on screen belong to an older query.
 */
export function searchTokens(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export function matchesTokens(haystack: string, tokens: string[]): boolean {
  const hay = haystack.toLowerCase();
  return tokens.every((token) => hay.includes(token));
}

export function threadHaystack(t: MailThreadSummary): string {
  return [t.fromName, t.fromEmail, t.subject, t.snippet]
    .filter(Boolean)
    .join(" ");
}

/** `kasper.hornbaek@…` also answers to "kasper hornbaek". */
export function emailLocalWords(email: string): string {
  const at = email.indexOf("@");
  return at > 0 ? email.slice(0, at).replace(/[._+\-]+/g, " ") : "";
}

export function mailboxScopeKey(selected: string[], accounts: string[]): string {
  if (isMailboxScopeAll(selected, accounts)) return "all";
  return [...selected]
    .map((e) => e.toLowerCase())
    .sort()
    .join(",");
}

/** Single-account API ops only when exactly one mailbox is selected. */
export function mailboxScopeApiAccount(
  selected: string[],
  accounts: string[]
): string | undefined {
  if (isMailboxScopeAll(selected, accounts)) return undefined;
  if (selected.length === 1) return selected[0];
  return undefined;
}

/**
 * What searching does, from inside the search field.
 *
 * One thing so far, and it belongs here rather than among the filters: those
 * say which pile of mail to show, and this says whether a search reaches into
 * mail that was thrown away. Nobody goes looking for it until they are
 * already typing, which is exactly where this is.
 */

/**
 * The folder the list is showing.
 *
 * `account` is the mailbox it was opened from, or null for every mailbox at
 * once — which is what the old merged folder menu has always meant, and
 * still means.
 */
export type ActiveMailFolder = MailFolder & {
  account: string | null;
  /** Set when the provider manages it — see `MailFolderRole`. */
  role?: MailFolderRole;
  /**
   * The row stands for a search rather than a folder.
   *
   * Gmail's Archived, Sent and Bin. There is no label to ask for, so the
   * list is asked for the view by name instead — the same views the tabs
   * already use, narrowed to one mailbox.
   */
  virtual?: boolean;
};

/** A virtual row's role, as the view the thread list already knows. */
export const ROLE_VIEW: Record<MailFolderRole, string> = {
  // Gmail has no inbox label to ask for either: it is the view everything
  // else is defined against, and the list already knows it by name.
  inbox: "inbox",
  archive: "archived",
  drafts: "drafts",
  sent: "sent",
  junk: "junk",
  trash: "trash",
};

/**
 * What names this folder view apart from another.
 *
 * The mailbox as well as the name. Two accounts can each hold an Archive
 * and they are two different lists; keyed by the name alone, opening one
 * painted the other's rows until the fetch came back and replaced them.
 */
export function folderViewToken(folder: ActiveMailFolder | null): string {
  if (!folder) return "";
  return folder.account ? `${folder.account}|${folder.name}` : folder.name;
}
