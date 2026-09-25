"use client";

/*
 * The rows of the people view, off MailPage: one row per correspondent,
 * pinned people first, narrowed by a search, under the same day headings
 * the thread list uses.
 *
 * Owns: who an address belongs to (read from the address books while the
 * people view is shown, and again when the mailboxes change), the rows,
 * and their groups.
 *
 * Does not own: the list's threads (`visible`) or the search words
 * (`pendingTokens`). Both come from the page.
 *
 * One effect, the address-book read. The page calls this hook where it
 * stood. The page keeps `personRowOrderRef`, which reads the rows.
 */

import * as React from "react";

import type { MailViewMode } from "@/components/mail/MailListControls";
import {
  emailLocalWords,
  matchesTokens,
  threadHaystack,
  useMailPersonPins,
} from "@/components/mail/mail-list-state";
import { dayBucket } from "@/lib/mail/date-format";
import type { MailStringKey } from "@/lib/mail/i18n";
import {
  buildPersonIdentity,
  type PersonIdentity,
} from "@/lib/mail/person-identity";
import {
  groupThreadsByPerson,
  type PersonRow,
} from "@/lib/mail/person-participants";
import { isMailPersonPinned, orderByPersonPin } from "@/lib/mail/person-pins";
import { mailStore } from "@/lib/mail/store";
import type { MailThreadSummary } from "@/lib/mail/types";

export function usePersonRows({
  viewMode,
  accountEmails,
  visible,
  pendingTokens,
  debouncedSearch,
}: {
  viewMode: MailViewMode;
  accountEmails: string[];
  /** The list's threads, before a search narrows them. */
  visible: MailThreadSummary[];
  /** The search words still waiting for the server's answer. */
  pendingTokens: string[];
  debouncedSearch: string;
}) {
  const personPins = useMailPersonPins();
  /**
   * By-person list, narrowed by the same waiting rule as the thread list.
   *
   * Grouped from the unnarrowed rows, then matched on the person as well as
   * their mail: someone found by CRM name or by the words in their address
   * must survive even when no thread text carries the query.
   */
  /*
    Who an address belongs to, from the address books — see person-identity.

    Read when the People view is shown, and again when the mailboxes
    change. A host without the contact mirrors (the web planner) answers
    with nothing, and every address stands for itself as before.
  */
  const [personIdentity, setPersonIdentity] =
    React.useState<PersonIdentity | null>(null);
  React.useEffect(() => {
    if (viewMode !== "people") return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await mailStore().contactSources.listVisible(accountEmails);
        if (!cancelled) setPersonIdentity(() => buildPersonIdentity(rows));
      } catch {
        if (!cancelled) setPersonIdentity(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [viewMode, accountEmails]);

  const personRows = React.useMemo(() => {
    if (viewMode !== "people") return [];
    const grouped = orderByPersonPin(
      groupThreadsByPerson(visible, personIdentity ?? undefined)
    );
    if (!pendingTokens.length) return grouped;
    return grouped.filter((row) =>
      matchesTokens(
        [
          row.name,
          row.email,
          row.crmName ?? "",
          emailLocalWords(row.email),
          // Every address the person has written from, not only the newest.
          ...row.people.flatMap((p) => [p.email, emailLocalWords(p.email)]),
          ...row.threads.map(threadHaystack),
        ].join(" "),
        pendingTokens
      )
    );
    // pendingTokens is derived from search + resultsQuery each render.
  }, [viewMode, visible, pendingTokens, personIdentity]);
  /**
   * The same day headings the thread list uses.
   *
   * A person row is still mail from a day. Search stays flat, because
   * the hits are not a day. Pinned people stay above the days, so a
   * pin does not land under Earlier.
   */
  const personGroups: {
    label: MailStringKey | "";
    items: PersonRow[];
  }[] = [];
  if (debouncedSearch) {
    if (personRows.length) personGroups.push({ label: "", items: personRows });
  } else {
    const pinnedPeople: PersonRow[] = [];
    const flowPeople: PersonRow[] = [];
    for (const row of personRows) {
      if (isMailPersonPinned(row.key)) pinnedPeople.push(row);
      else flowPeople.push(row);
    }
    if (pinnedPeople.length) {
      personGroups.push({ label: "", items: pinnedPeople });
    }
    for (const row of flowPeople) {
      const label = dayBucket(row.lastAt);
      const last = personGroups[personGroups.length - 1];
      if (last && last.label === label) last.items.push(row);
      else personGroups.push({ label, items: [row] });
    }
  }
  // Read so the list re-sorts the moment a pin changes.
  void personPins;

  return { personRows, personGroups };
}
