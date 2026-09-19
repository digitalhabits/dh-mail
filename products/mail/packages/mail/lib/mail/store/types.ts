/**
 * The storage boundary for mail.
 *
 * Mail states the operations that it needs. Each host implements them:
 *
 * - The planner implements them against the team Postgres, as today.
 * - The standalone product implements them against local SQLite, through
 *   Tauri `invoke`.
 *
 * Do not add a `query()` method here. Every data module in the mail package
 * starts with `import "server-only"`, and the standalone product has no server.
 * Those modules cannot run there in any SQL dialect. The operation is the seam.
 *
 * This file has no runtime imports, so any host can read it.
 *
 * Migration state: `listSync` only. See `docs/mail-product-plan.md` for the
 * remaining modules and the order to take them in.
 */

import type { MailProvider, MailThreadSummary } from "@/lib/mail/types";

/** One thread row of a cached provider list page. */
export type MailListSyncRow = {
  threadId: string;
  listSnippet: string;
  latestRfcId: string;
  /** References + In-Reply-To of the newest message. Adoption reads them. */
  latestReferences?: string;
  summary: MailThreadSummary;
};

/** A cached list page for one mailbox, with its provider sync position. */
export type MailListSyncEntry = {
  rows: MailListSyncRow[];
  historyId: string | null;
  nextPageToken: string | null;
};

/**
 * Durable list page state for incremental polls.
 *
 * This is a cache. Every operation is best-effort. A failure costs one slow
 * poll, never a wrong inbox, so implementations must swallow their errors.
 */
export type MailListSyncStore = {
  /** Stored pages for these mailboxes, keyed by account email. */
  load(
    ownerId: string,
    folder: string,
    accounts: string[]
  ): Promise<Map<string, MailListSyncEntry>>;

  /** Write one mailbox's page. Unchanged rows must only move the position. */
  save(
    ownerId: string,
    folder: string,
    account: string,
    entry: {
      rows: MailListSyncRow[];
      historyId?: string | null;
      nextPageToken?: string | null;
    }
  ): Promise<void>;

  /** Drop every stored page. Account connect and folder moves call this. */
  clear(): Promise<void>;
};

/**
 * Named string values that outlive a session, such as the signature settings.
 *
 * The store holds strings only. Defaults, parsing, and every fallback stay in
 * mail, so each host implements two operations and no rules. Keep this split
 * for the modules still to migrate: the store moves data, mail decides meaning.
 */
export type MailSettingsStore = {
  /** The stored value, or null when the key is absent. */
  get(key: string): Promise<string | null>;
  /** Write the value, and replace any earlier one. */
  set(key: string, value: string): Promise<void>;
};

/** Which mail provider a stored account belongs to. */
export type MailStoreProvider = MailProvider;

/** A connected mailbox, without its token. */
export type MailAccountRecord = {
  email: string;
  ownerId: string;
  /** Gmail sync checkpoint. Always null for Outlook. */
  historyId: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  /** Shown in the mail list. A hidden mailbox stays connected. */
  inMailTab: boolean;
  /**
   * The scopes the provider said it granted, space-separated. The planner
   * host records it, because it asks for more than mail and needs to know
   * which mailboxes hold an older grant. The local store has no use for it
   * and reads it as absent.
   */
  grantedScopes?: string | null;
};

/**
 * A stored refresh token, with the owner row it came from. Microsoft rotates
 * refresh tokens, and the new one belongs on the row whose grant produced it.
 */
export type MailStoredToken = {
  refreshToken: string;
  ownerId: string;
};

/**
 * Connected mailboxes and their refresh tokens.
 *
 * **This interface carries plaintext tokens, and each host protects them at
 * rest its own way.** The planner encrypts them into a Postgres column with
 * `GMAIL_TOKEN_SECRET`. The standalone product hands them to the operating
 * system keychain. Protection is a storage concern, so it does not appear here.
 *
 * Callers pass a lowercase email. Normalization is a rule, so it stays in mail.
 */
export type MailAccountStore = {
  /** Accounts for one owner, in the order that owner chose. */
  listForOwner(
    provider: MailStoreProvider,
    ownerId: string
  ): Promise<MailAccountRecord[]>;

  /**
   * One record per mailbox across every owner, for org-wide reads. Several
   * owners can connect the same mailbox, so prefer a row that already holds a
   * sync checkpoint.
   */
  listAll(provider: MailStoreProvider): Promise<MailAccountRecord[]>;

  /** Which of these emails this owner connected. */
  listOwnedEmails(
    provider: MailStoreProvider,
    ownerId: string,
    emails: string[]
  ): Promise<string[]>;

  /** True when any owner connected this mailbox. */
  exists(provider: MailStoreProvider, email: string): Promise<boolean>;

  /** Add the mailbox, or replace its token and clear its sync state. */
  save(
    provider: MailStoreProvider,
    input: {
      email: string;
      ownerId: string;
      refreshToken: string;
      grantedScopes?: string | null;
    }
  ): Promise<void>;

  /** The freshest stored token for this mailbox, or null. */
  getToken(
    provider: MailStoreProvider,
    email: string
  ): Promise<MailStoredToken | null>;

  /** Write a rotated token back to one owner's row. */
  replaceToken(
    provider: MailStoreProvider,
    email: string,
    ownerId: string,
    refreshToken: string
  ): Promise<void>;

  /**
   * Keep the latest grant the provider reported for one owner's row.
   *
   * Optional, and the one method that is: the planner host implements it,
   * the local store does not, and a caller skips it when it is absent. It is
   * not an operation Rust must answer, so it stays off MAIL_STORE_OPERATIONS.
   */
  setGrantedScopes?(
    provider: MailStoreProvider,
    email: string,
    ownerId: string,
    grantedScopes: string
  ): Promise<void>;

  /** False when this owner has no such mailbox. */
  setInMailTab(
    provider: MailStoreProvider,
    ownerId: string,
    email: string,
    inMailTab: boolean
  ): Promise<boolean>;

  /** Store the list order. The array index is the position. */
  setSortOrder(
    provider: MailStoreProvider,
    ownerId: string,
    emails: string[]
  ): Promise<void>;

  /** False when this owner has no such mailbox. */
  remove(
    provider: MailStoreProvider,
    ownerId: string,
    email: string
  ): Promise<boolean>;

  /**
   * Update the sync checkpoint for every owner of this mailbox. The checkpoint
   * is mailbox state, not owner state, so the rows must stay in step.
   */
  setSyncState(
    provider: MailStoreProvider,
    email: string,
    update: { historyId?: string | null; error?: string | null }
  ): Promise<void>;
};

/** A thread that stays out of the list until its wake time. */
export type MailSnoozeRecord = {
  accountEmail: string;
  threadId: string;
  /** ISO timestamp of the wake time. */
  snoozedUntil: string;
  /**
   * RFC Message-ID of the thread tip when the snooze started. It hides the
   * copies of one thread that sit in other mailboxes.
   */
  tipMessageId: string | null;
};

/**
 * Snoozed threads.
 *
 * "Active" means the wake time has not passed. The store decides that, because
 * the comparison belongs with the clock that stores the rows.
 */
export type MailSnoozeStore = {
  /** Active snoozes, soonest wake first. Omit the limit for all of them. */
  listActive(limit?: number): Promise<MailSnoozeRecord[]>;

  /** How many active snoozes these mailboxes hold. */
  countActive(accounts: string[]): Promise<number>;

  /** Add a snooze, or move an existing one. A null tip keeps the stored one. */
  set(record: MailSnoozeRecord): Promise<void>;

  /** Wake the thread now. */
  remove(accountEmail: string, threadId: string): Promise<void>;
};

/** Where a mirrored contact came from. */
/**
 * Where a mirrored address came from.
 *
 * `mac` is the Mac address book, and it belongs to the machine rather than to
 * a mailbox. Its rows carry an empty account for that reason.
 */
export type MailContactSourceKind = "google" | "outlook" | "history" | "mac";

/** Last sync result for one source on one mailbox. */
export type MailContactSourceState = {
  source: string;
  account: string;
  /** ISO timestamp of the last successful sync, or null. */
  syncedAt: string | null;
  itemCount: number;
  lastError: string | null;
};

/** One mirrored contact. */
export type MailSourceContact = {
  source: MailContactSourceKind;
  account: string;
  email: string;
  name: string;
  /** ISO timestamp of the most recent message, for history contacts. */
  lastEmailedAt: string | null;
  /**
   * The address book's own id for the card this address is on. Two
   * addresses on one card are one person — see person-identity. Absent on
   * history rows, and on rows mirrored before the book gave it.
   */
  card?: string | null;
};

/**
 * Contacts mirrored from the address books and from send history.
 *
 * `replaceContacts` must be atomic. A reader must never see the gap between
 * the delete and the insert. How the host reaches that is its own business, so
 * transactions do not appear in this contract.
 */
export type MailContactSourceStore = {
  /** Every source state row. Returns empty when nothing synced yet. */
  listState(): Promise<MailContactSourceState[]>;

  /** Record a sync result. Only `synced` moves the timestamp. */
  saveState(
    source: string,
    account: string,
    update: { count?: number; error?: string | null; synced?: boolean }
  ): Promise<void>;

  /** Drop a stored error, after the user reconnects. */
  clearError(source: string, account: string): Promise<void>;

  /**
   * Replace every mirrored row for one address book, in one step.
   *
   * The Mac book passes an empty account: it belongs to the machine, and there
   * is only ever one of it.
   */
  replaceContacts(
    source: "google" | "outlook" | "mac",
    account: string,
    contacts: { email: string; name: string; card?: string }[]
  ): Promise<void>;

  /**
   * Add history contacts without losing what is already stored. A stored name
   * wins over an empty one, and the latest send time wins.
   */
  mergeHistoryContacts(
    account: string,
    contacts: { email: string; name: string; lastEmailedAt: string | null }[]
  ): Promise<void>;

  /** How many history contacts this mailbox shows. */
  countVisibleHistory(account: string): Promise<number>;

  /**
   * Visible contacts for these mailboxes, and every Mac address book row.
   *
   * The Mac book belongs to the machine, not to a mailbox, so it is not
   * filtered by account. Address books come before history, so the caller can
   * keep the first row it sees for an address.
   */
  listVisible(accounts: string[]): Promise<MailSourceContact[]>;

  /** Hide one history contact for good. */
  hideHistoryContact(email: string): Promise<void>;
};

/**
 * A provider thread joined to the conversation part it belongs to.
 *
 * A conversation is one thread of talk. It splits into parts, because a mail
 * thread that grows without limit becomes slow in every client. Each part is a
 * separate provider thread, and a binding ties the two together.
 */
export type MailChatBinding = {
  chatId: string;
  title: string;
  partIndex: number;
  partCount: number;
  subject: string;
  partStatus: string;
  rotateAt: number;
  messageCount: number;
  participantEmails: string[];
  noQuote: boolean;
};

/** The part that new messages go to. */
export type MailChatOpenPart = {
  partId: string;
  partIndex: number;
  subject: string;
  messageCount: number;
};

/** One part, as the part switcher shows it. */
export type MailChatPartRow = {
  partIndex: number;
  subject: string;
  status: "open" | "closed";
  providerThreadId: string;
  /** ISO timestamps. */
  openedAt: string | null;
  closedAt: string | null;
  messageCount: number;
};

/**
 * Conversations, their parts, and the provider threads bound to them.
 *
 * Mail generates every id and decides when to rotate a part. The store writes
 * what it is given, so the same decisions hold on every host.
 */
export type MailChatStore = {
  /** The binding for one provider thread, or null. */
  findBinding(
    account: string,
    threadId: string
  ): Promise<MailChatBinding | null>;

  /** Bindings for many threads at once, keyed `account|threadId`. */
  findBindings(
    keys: { account: string; threadId: string }[]
  ): Promise<Map<string, MailChatBinding>>;

  /**
   * Create a conversation, its first part, and the binding. All three must
   * land together, or none of them.
   */
  createConversation(input: {
    chatId: string;
    title: string;
    createdByAccount: string;
    participantFingerprint: string;
    participantEmails: string[];
    rotateAt: number;
    noQuote: boolean;
    partId: string;
    subject: string;
    messageCount: number;
    provider: string;
    threadId: string;
  }): Promise<void>;

  /** Set the sticky no-quote preference. */
  setNoQuote(chatId: string, noQuote: boolean): Promise<void>;

  /** The highest open part, or null when the conversation is broken. */
  findOpenPart(chatId: string): Promise<MailChatOpenPart | null>;

  /** This mailbox's provider thread for one part, or null. */
  findPartThreadId(partId: string, account: string): Promise<string | null>;

  /** Close the current part and open the next. Both must land together. */
  rotatePart(input: {
    chatId: string;
    closePartId: string;
    nextPartId: string;
    nextIndex: number;
    nextSubject: string;
  }): Promise<void>;

  /** Count one more message on a part. */
  addMessageToPart(partId: string): Promise<void>;

  /**
   * Set a part's count to what the provider's thread actually holds.
   *
   * `addMessageToPart` counts our sends, and nobody else's. The provider
   * sees every message, so its count wins whenever a bound thread is read.
   * Rotation reads this count, and rotating on sends alone fires far too
   * late — see docs/mail-chat-architecture.md.
   *
   * A no-op when the thread is not bound to any part.
   */
  reconcilePartCount(input: {
    account: string;
    threadId: string;
    messageCount: number;
  }): Promise<void>;

  /**
   * Remember which RFC Message-IDs a bound thread holds.
   *
   * The conversation's continuity lives in these ids: a thread the provider
   * split off references them, and that reference is how it finds its way
   * back — see docs/mail-chat-architecture.md. A no-op for unbound threads.
   */
  rememberMessageIds(input: {
    account: string;
    threadId: string;
    messageIds: string[];
  }): Promise<void>;

  /**
   * The conversation that holds any of these Message-IDs, or null.
   *
   * Scoped by account. The planner's store is shared by a team, and one
   * person's reply chain must never capture another person's thread.
   */
  findByMessageIds(
    account: string,
    messageIds: string[]
  ): Promise<{
    chatId: string;
    title: string;
    participantEmails: string[];
    noQuote: boolean;
  } | null>;

  /** Bind a provider thread to a part, or move an existing binding. */
  bindThread(input: {
    partId: string;
    account: string;
    provider: string;
    threadId: string;
    tipMessageId: string | null;
  }): Promise<void>;

  /** Mark the conversation as changed. */
  touch(chatId: string): Promise<void>;

  /** Every part of a conversation, oldest first. */
  listParts(account: string, chatId: string): Promise<MailChatPartRow[]>;
};

/** Everything mail stores. Grows as each module migrates. */
// ---------------------------------------------------------------------------
// The local copy of the mail — see docs/mail-local-store.md
// ---------------------------------------------------------------------------

export type MailStoredAddress = { name: string; email: string };

/** A view of a mailbox, as the list asks for one. */
export type MailStoredView =
  | "inbox"
  | "sent"
  | "drafts"
  | "starred"
  | "trash"
  | "junk"
  | "archived"
  | "all"
  | "label";

/** One message's headers, as the sync worker wrote them. Times are ms since the epoch. */
export type MailStoredMessage = {
  messageId: string;
  threadId: string;
  /** "" for All Mail, else "trash" or "spam": where its UID belongs. */
  folder?: string;
  uid?: number | null;
  modseq?: number | null;
  rfcMessageId?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  fromName: string;
  fromEmail: string;
  to: MailStoredAddress[];
  cc: MailStoredAddress[];
  bcc: MailStoredAddress[];
  subject: string;
  snippet: string;
  sentAt: number;
  sizeEstimate?: number | null;
  hasAttachments: boolean;
  unread: boolean;
  starred: boolean;
  isDraft: boolean;
  labels: string[];
};

/** A fetched body. Immutable once written. */
export type MailStoredBody = {
  text?: string | null;
  html?: string | null;
  inlineImages?: Record<string, string>;
  attachments?: unknown[];
};

/** A thread as the list draws it: its newest message and what the others add. */
export type MailStoredThread = {
  account: string;
  threadId: string;
  subject: string;
  lastAt: number;
  messageCount: number;
  unread: boolean;
  hasAttachments: boolean;
  starred: boolean;
  isDraft: boolean;
  labels: string[];
  latest: {
    messageId: string;
    fromName: string;
    fromEmail: string;
    to: MailStoredAddress[];
    snippet: string;
    sentAt: number;
    unread: boolean;
    rfcMessageId?: string | null;
    inReplyTo?: string | null;
    references?: string | null;
  };
  participants: MailStoredAddress[];
  /** Who wrote each visible message, in order. */
  senders: MailStoredAddress[];
  /** From a search: the message that matched best. */
  focusMessageId?: string;
};

export type MailSyncPhase = "none" | "full" | "live" | "expired" | "paused";

/** Where a mailbox's sync has got to. One row per mailbox and folder. */
export type MailSyncState = {
  account: string;
  folder: string;
  phase: MailSyncPhase | string;
  uidValidity?: number | null;
  highestUid?: number | null;
  highestModseq?: number | null;
  deltaLink?: string | null;
  fullSyncCursor?: number | null;
  fullSyncTotal?: number | null;
  fullSyncDone?: number | null;
  lastOkAt?: number | null;
  lastError?: string | null;
};

export type MailMessageStore = {
  /** The threads of a view, newest first, from `before` (exclusive, ms) down. */
  list(input: {
    accounts: string[];
    view: MailStoredView;
    label?: string;
    before?: number | null;
    limit?: number;
  }): Promise<{ threads: MailStoredThread[]; nextBefore: number | null }>;

  /** How many threads a view holds, and how many of them are unread. */
  counts(input: {
    accounts: string[];
    view: MailStoredView;
    label?: string;
  }): Promise<{ threads: number; unread: number }>;

  /** One thread, every message, bodies where fetched. */
  thread(
    account: string,
    threadId: string
  ): Promise<(MailStoredMessage & { body: MailStoredBody | null })[]>;

  /**
   * Full-text search over the copy. Threads, newest first; inside one view
   * when asked. Reads the words Gmail reads: `from:`, `to:`, `subject:`,
   * `has:attachment`, `before:`, `after:`, quotes, `-word`, `OR`.
   * `handled` is false when the query asks something only the provider
   * can answer — `in:`, `label:`, `is:` — and the caller asks the provider.
   */
  search(input: {
    accounts: string[];
    q: string;
    limit?: number;
    includeDeleted?: boolean;
    view?: MailStoredView;
    label?: string;
  }): Promise<{ threads: MailStoredThread[]; handled?: boolean }>;

  /** Who the mailbox wrote to since `since` (ms), newest first. */
  recipients(account: string, since: number): Promise<{ email: string; name: string; lastAt: number }[]>;

  /** Threads and unread threads per user label, Trash and Junk left out. */
  labelCounts(account: string): Promise<{ label: string; threads: number; unread: number }[]>;

  /**
   * Apply an action to the copy only — archive, trash, read, a label — for
   * a provider whose own call has already been made.
   */
  applyAction(input: {
    account: string;
    threadId: string;
    kind: string;
    payload?: Record<string, unknown>;
  }): Promise<void>;

  /** Write or refresh these messages. Bodies are untouched. */
  upsertMany(account: string, rows: MailStoredMessage[]): Promise<number>;

  /** Keep a fetched body. */
  putBody(account: string, messageId: string, body: MailStoredBody): Promise<void>;

  /** Every message of a mailbox, gone. */
  removeAccount(account: string): Promise<void>;

  /** These messages, gone, with their labels and bodies. */
  /**
   * Rows by message id, gone. With `leftFolder`, only the rows the copy still
   * has in that folder: the label the folder gives its rows, or "" for a
   * folder whose rows wear none. For a "left this folder" report, which can
   * arrive after the message has been delivered to the folder it went to.
   */
  removeMessages(account: string, messageIds: string[], options?: { leftFolder?: string }): Promise<void>;

  /** Mark a thread read (every message) or unread (its newest). */
  setUnread(account: string, threadId: string, unread: boolean): Promise<void>;
};

export type MailSyncStore = {
  list(): Promise<MailSyncState[]>;
  set(state: MailSyncState): Promise<void>;
};

export type MailStore = {
  listSync: MailListSyncStore;
  settings: MailSettingsStore;
  accounts: MailAccountStore;
  snoozes: MailSnoozeStore;
  contactSources: MailContactSourceStore;
  chats: MailChatStore;
  messages: MailMessageStore;
  sync: MailSyncStore;
};
