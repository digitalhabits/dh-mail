/** Client-safe types for mail contact lists (no server-only imports). */

export type MailContactListMember = {
  email: string;
  name: string;
  /** Optional 1–2 letter avatar override (e.g. ML for mlarsen@…). */
  initials?: string;
};

export type MailContactList = {
  id: string;
  name: string;
  members: MailContactListMember[];
  updatedAt: string;
};

/** A chip in the To/Cc/Bcc field — a person or a saved list. */
export type MailRecipient =
  | { kind: "email"; email: string; name?: string }
  | {
      kind: "list";
      listId: string;
      /** Snapshot so drafts don't change when the saved list is edited elsewhere. */
      name: string;
      members: MailContactListMember[];
      sendAsBcc?: boolean;
    };

export function recipientKey(r: MailRecipient): string {
  return r.kind === "email" ? `e:${r.email.toLowerCase()}` : `l:${r.listId}`;
}

export function emailsOfRecipients(recipients: MailRecipient[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of recipients) {
    if (r.kind === "email") {
      const e = r.email.toLowerCase();
      if (!seen.has(e)) {
        seen.add(e);
        out.push(e);
      }
    } else {
      for (const m of r.members) {
        const e = m.email.toLowerCase();
        if (!seen.has(e)) {
          seen.add(e);
          out.push(e);
        }
      }
    }
  }
  return out;
}

/** Flatten for send: list chips with sendAsBcc go to bcc, others to to/cc. */
export function flattenRecipientsForSend(recipients: MailRecipient[]): {
  emails: string[];
  bccEmails: string[];
} {
  const emails: string[] = [];
  const bccEmails: string[] = [];
  const seen = new Set<string>();
  const push = (bucket: string[], email: string) => {
    const e = email.toLowerCase();
    if (seen.has(e)) return;
    seen.add(e);
    bucket.push(e);
  };
  for (const r of recipients) {
    if (r.kind === "email") {
      push(emails, r.email);
    } else if (r.sendAsBcc) {
      for (const m of r.members) push(bccEmails, m.email);
    } else {
      for (const m of r.members) push(emails, m.email);
    }
  }
  return { emails, bccEmails };
}

export function recipientsFromEmails(
  emails: string[],
  nameByEmail?: Map<string, string>
): MailRecipient[] {
  const out: MailRecipient[] = [];
  const seen = new Set<string>();
  for (const raw of emails) {
    const email = raw.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    const name = nameByEmail?.get(email);
    out.push(name ? { kind: "email", email, name } : { kind: "email", email });
  }
  return out;
}

export function formatRecipientSummary(recipients: MailRecipient[]): string {
  if (!recipients.length) return "";
  return recipients
    .map((r) =>
      r.kind === "email" ? r.name || r.email : `${r.name} (${r.members.length})`
    )
    .join(", ");
}
