/**
 * Client-safe types for mail folders — a Gmail label or an Outlook folder,
 * depending on the account.
 */

/**
 * A folder the provider manages, rather than one somebody made.
 *
 * Carried so the rail can treat them unlike the rest: they sort to the top
 * of their mailbox, and Sent and Drafts refuse a dropped conversation the
 * same way the unified rows above them do. Absent on an ordinary folder.
 */
export type MailFolderRole =
  | "inbox"
  | "archive"
  | "drafts"
  | "sent"
  | "junk"
  | "trash";

/**
 * One folder, on one mailbox.
 *
 * What the provider actually holds. Two accounts can each have a folder
 * called Archive, and they are two folders: a conversation files into one
 * of them, on its own account, and never into the other.
 */
export type MailAccountFolder = {
  /** The mailbox this folder is on. */
  account: string;
  /**
   * Display name. `/` separates a nested folder, the way Gmail writes a
   * nested label: `Clients/2026`.
   */
  name: string;
  /** Thread count on this account (messages on Outlook). */
  count: number;
  /** Set when the provider manages this folder — see `MailFolderRole`. */
  role?: MailFolderRole;
  /**
   * No folder of this name exists; the row stands for a search.
   *
   * Gmail has no Archive folder — archiving is taking the inbox label off a
   * conversation — so "Archived" is everything without that label, and Sent
   * and Bin are system labels reached with `in:sent` rather than `label:`.
   * A row like this is opened by what it is, not by its name, and nothing
   * can be filed into it.
   */
  virtual?: boolean;
};

/**
 * The same folder name across every account, counts added.
 *
 * What a *view* is about: opening Academia opens what is in Academia,
 * wherever it is. The rail shows the accounts apart because filing has to
 * pick one; a list of mail does not.
 */
export type MailFolder = {
  /**
   * Display name. `/` separates a nested folder, the way Gmail writes a
   * nested label: `Clients/2026`.
   */
  name: string;
  /** Thread count across connected accounts (messages on Outlook). */
  count: number;
  /**
   * What the provider keeps this folder for, when it keeps it for anything.
   *
   * Carried so a list of names can still tell Inbox from Invoices: the menu
   * that files a conversation offers the folders somebody made, and the
   * provider's own places are offered above it or not at all.
   */
  role?: MailFolderRole;
  /** No folder of this name exists; the row stands for a search. */
  virtual?: boolean;
};

/**
 * IMAP namespace containers, which are plumbing and not filing.
 *
 * IMAP keeps Gmail's own special folders under a `[Gmail]` prefix —
 * `[Gmail]/Bin`, `[Gmail]/All Mail` — and a client or an import that has
 * touched the mailbox over IMAP leaves them behind: as folders on an
 * Exchange mailbox synced from Gmail, and as real labels on the Gmail
 * account itself. `[Imap]` is the same for whatever could not be mapped.
 *
 * Neither is a folder anybody made, and both providers hand them over
 * looking exactly like ones that were. Gmail's own web sidebar does not
 * show them and neither does Outlook.
 *
 * This is not a rule about square brackets — `[Notion]` is a label somebody
 * made, and it stays.
 */
const IMAP_NAMESPACE_ROOTS = new Set(["[gmail]", "[google mail]", "[imap]"]);

/** Is this folder the IMAP plumbing, or inside it? */
export function isImapNamespaceFolder(name: string): boolean {
  const root = name.split("/")[0]?.trim().toLowerCase() ?? "";
  return IMAP_NAMESPACE_ROOTS.has(root);
}

/** Fold the per-account rows into one list, the way the old menu shows them. */
/**
 * The folders of every mailbox as one list, by name.
 *
 * What each row *is* travels with it. Without that, a list of names cannot
 * tell Inbox from Invoices, and the menu that files a conversation offered
 * both — Inbox, Sent and Drafts among the folders, under the four places
 * that already name them.
 */
export function mergeFoldersByName(rows: MailAccountFolder[]): MailFolder[] {
  const byName = new Map<string, MailFolder>();
  for (const row of rows) {
    if (!row.name) continue;
    const key = row.name.trim().toLowerCase();
    const prev = byName.get(key);
    if (prev) {
      prev.count += row.count;
      // One account calling it a system folder is enough: the same name
      // under another is the same place to a reader.
      if (!prev.role && row.role) prev.role = row.role;
      if (row.virtual) prev.virtual = true;
    } else {
      byName.set(key, {
        name: row.name,
        count: row.count,
        ...(row.role ? { role: row.role } : null),
        ...(row.virtual ? { virtual: true } : null),
      });
    }
  }
  return [...byName.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
}

/** Every account that has at least one folder, in the order they arrived. */
export function accountsWithFolders(rows: MailAccountFolder[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const key = row.account.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row.account);
  }
  return out;
}
