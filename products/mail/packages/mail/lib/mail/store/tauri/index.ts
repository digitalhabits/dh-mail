/**
 * The store for the standalone product: local SQLite, through Tauri.
 *
 * This is the second implementation of `MailStore`, and it is the one that
 * proves the contract. It runs in the webview, so it holds no SQL and no
 * database driver. Every operation is one call across the Tauri boundary, and
 * Rust owns the file and the keychain.
 *
 * **One command, many operations.** Every call goes to `mail_store_call` with
 * an operation name. Rust answers with one match. Thirty-nine separate commands
 * would mean thirty-nine places for the two sides to drift, and the operation
 * names here are the whole specification of what Rust must implement.
 *
 * **Tokens.** `accounts.getToken` and `accounts.save` carry refresh tokens in
 * plaintext, which is what the contract says. Rust must put them in the
 * keychain, not in the SQLite file. See `@/lib/mail/store/types`.
 *
 * Nothing registers this yet. `apps/mail` calls `setMailStore(tauriMailStore)`
 * at its entry point once the Rust side exists.
 */

import type {
  MailAccountRecord,
  MailChatBinding,
  MailChatOpenPart,
  MailChatPartRow,
  MailContactSourceState,
  MailListSyncEntry,
  MailSnoozeRecord,
  MailStoredBody,
  MailStoredMessage,
  MailSourceContact,
  MailStore,
  MailStoredToken,
} from "@/lib/mail/store/types";

type TauriInvoke = (
  command: string,
  args?: Record<string, unknown>
) => Promise<unknown>;

type BridgeWindow = {
  __TAURI__?: { core?: { invoke?: TauriInvoke } };
  __TAURI_INTERNALS__?: { invoke?: TauriInvoke };
};

function ownBridge(w: BridgeWindow | null | undefined): TauriInvoke | null {
  return w?.__TAURI__?.core?.invoke ?? w?.__TAURI_INTERNALS__?.invoke ?? null;
}

/**
 * The invoke bridge, or null outside a desktop shell.
 *
 * A page shown in a planner tile is a frame inside the shell's page and has
 * no bridge of its own; the shell's is on the top window. Without looking
 * there, a tile offered Open in Mail (the planner's own check looks up) and
 * then said "Opening Outlook needs the desktop app". A top window of another
 * origin throws on the read, and counts as none.
 */
export function tauriInvoke(): TauriInvoke | null {
  if (typeof window === "undefined") return null;
  const own = ownBridge(window as unknown as BridgeWindow);
  if (own) return own;
  if (window.top === window) return null;
  try {
    return ownBridge(window.top as unknown as BridgeWindow);
  } catch {
    return null;
  }
}

const COMMAND = "mail_store_call";

/**
 * The clock, for the operations that compare or record a time.
 *
 * Postgres uses its own with `NOW()`. This host has no server, so the caller
 * sends one. An operation that needs it and does not send it silently records
 * nothing: a sync time stays null, and everything downstream reads it as never
 * synced. Rust names these in the tests.
 */
function now(): string {
  return new Date().toISOString();
}

/** Every operation Rust must implement, in the order the contract states them. */
export const MAIL_STORE_OPERATIONS = [
  "listSync.load",
  "listSync.save",
  "listSync.clear",
  "settings.get",
  "settings.set",
  "accounts.listForOwner",
  "accounts.listAll",
  "accounts.listOwnedEmails",
  "accounts.exists",
  "accounts.save",
  "accounts.getToken",
  "accounts.replaceToken",
  "accounts.setInMailTab",
  "accounts.setSortOrder",
  "accounts.remove",
  "accounts.setSyncState",
  "snoozes.listActive",
  "snoozes.countActive",
  "snoozes.set",
  "snoozes.remove",
  "contactSources.listState",
  "contactSources.saveState",
  "contactSources.clearError",
  "contactSources.replaceContacts",
  "contactSources.mergeHistoryContacts",
  "contactSources.countVisibleHistory",
  "contactSources.listVisible",
  "contactSources.hideHistoryContact",
  "chats.findBinding",
  "chats.findBindings",
  "chats.createConversation",
  "chats.setNoQuote",
  "chats.findOpenPart",
  "chats.findPartThreadId",
  "chats.rotatePart",
  "chats.addMessageToPart",
  "chats.reconcilePartCount",
  "chats.rememberMessageIds",
  "chats.findByMessageIds",
  "chats.bindThread",
  "chats.touch",
  "chats.listParts",
  "messages.list",
  "messages.counts",
  "messages.thread",
  "messages.search",
  "messages.upsertMany",
  "messages.putBody",
  "messages.removeAccount",
  "messages.setUnread",
  "messages.recipients",
  "messages.labelCounts",
  "messages.applyAction",
  "messages.removeMessages",
  "sync.list",
  "sync.set",
] as const;

export type MailStoreOperation = (typeof MAIL_STORE_OPERATIONS)[number];

async function call<T>(
  op: MailStoreOperation,
  args: Record<string, unknown> = {}
): Promise<T> {
  const invoke = tauriInvoke();
  if (!invoke) {
    throw new Error(`Mail store is unavailable outside the desktop app (${op})`);
  }
  return (await invoke(COMMAND, { op, args })) as T;
}

/**
 * Build the store over a given bridge. Pass one in for tests. The default
 * reads the bridge from the window at call time, so it works after the shell
 * finishes loading.
 */
export function createTauriMailStore(): MailStore {
  return {
    listSync: {
      async load(ownerId, folder, accounts) {
        const rows = await call<Record<string, MailListSyncEntry>>(
          "listSync.load",
          { ownerId, folder, accounts }
        );
        return new Map(Object.entries(rows ?? {}));
      },
      save: (ownerId, folder, account, entry) =>
        call("listSync.save", { ownerId, folder, account, entry }),
      clear: () => call("listSync.clear"),
    },

    settings: {
      get: (key) => call<string | null>("settings.get", { key }),
      set: (key, value) => call("settings.set", { key, value }),
    },

    accounts: {
      listForOwner: (provider, ownerId) =>
        call<MailAccountRecord[]>("accounts.listForOwner", {
          provider,
          ownerId,
        }),
      listAll: (provider) =>
        call<MailAccountRecord[]>("accounts.listAll", { provider }),
      listOwnedEmails: (provider, ownerId, emails) =>
        call<string[]>("accounts.listOwnedEmails", {
          provider,
          ownerId,
          emails,
        }),
      exists: (provider, email) =>
        call<boolean>("accounts.exists", { provider, email }),
      save: (provider, input) => call("accounts.save", { provider, input }),
      getToken: (provider, email) =>
        call<MailStoredToken | null>("accounts.getToken", { provider, email }),
      replaceToken: (provider, email, ownerId, refreshToken) =>
        call("accounts.replaceToken", {
          provider,
          email,
          ownerId,
          refreshToken,
        }),
      setInMailTab: (provider, ownerId, email, inMailTab) =>
        call<boolean>("accounts.setInMailTab", {
          provider,
          ownerId,
          email,
          inMailTab,
        }),
      setSortOrder: (provider, ownerId, emails) =>
        call("accounts.setSortOrder", { provider, ownerId, emails }),
      remove: (provider, ownerId, email) =>
        call<boolean>("accounts.remove", { provider, ownerId, email }),
      setSyncState: (provider, email, update) =>
        call("accounts.setSyncState", { provider, email, update, now: now() }),
    },

    snoozes: {
      // "Active" is a comparison against a clock. Postgres has its own. This
      // host has none, so the caller sends one and the store never invents it.
      listActive: (limit) =>
        call<MailSnoozeRecord[]>("snoozes.listActive", {
          limit: limit ?? null,
          now: now(),
        }),
      countActive: (accounts) =>
        call<number>("snoozes.countActive", { accounts, now: now() }),
      set: (record) => call("snoozes.set", { record }),
      remove: (accountEmail, threadId) =>
        call("snoozes.remove", { accountEmail, threadId }),
    },

    contactSources: {
      listState: () =>
        call<MailContactSourceState[]>("contactSources.listState"),
      saveState: (source, account, update) =>
        call("contactSources.saveState", { source, account, update, now: now() }),
      clearError: (source, account) =>
        call("contactSources.clearError", { source, account }),
      replaceContacts: (source, account, contacts) =>
        call("contactSources.replaceContacts", {
          source,
          account,
          contacts,
          now: now(),
        }),
      mergeHistoryContacts: (account, contacts) =>
        call("contactSources.mergeHistoryContacts", {
          account,
          contacts,
          now: now(),
        }),
      countVisibleHistory: (account) =>
        call<number>("contactSources.countVisibleHistory", { account }),
      listVisible: (accounts) =>
        call<MailSourceContact[]>("contactSources.listVisible", { accounts }),
      hideHistoryContact: (email) =>
        call("contactSources.hideHistoryContact", { email }),
    },

    messages: {
      list: (input) =>
        call("messages.list", {
          accounts: input.accounts,
          view: input.view,
          label: input.label ?? null,
          before: input.before ?? null,
          limit: input.limit ?? null,
        }),
      counts: (input) =>
        call("messages.counts", {
          accounts: input.accounts,
          view: input.view,
          label: input.label ?? null,
        }),
      thread: async (account, threadId) => {
        const out = await call<{ messages: (MailStoredMessage & { body: MailStoredBody | null })[] }>(
          "messages.thread",
          { account, threadId }
        );
        return out.messages;
      },
      search: (input) =>
        call("messages.search", {
          accounts: input.accounts,
          q: input.q,
          limit: input.limit ?? null,
          includeDeleted: input.includeDeleted ?? false,
          view: input.view ?? null,
          label: input.label ?? null,
        }),
      recipients: (account, since) => call("messages.recipients", { account, since }),
      labelCounts: (account) => call("messages.labelCounts", { account }),
      applyAction: (input) =>
        call("messages.applyAction", {
          account: input.account,
          threadId: input.threadId,
          kind: input.kind,
          payload: input.payload ?? {},
        }),
      upsertMany: (account, rows) => call("messages.upsertMany", { account, rows }),
      putBody: (account, messageId, body) =>
        call("messages.putBody", { account, messageId, body }),
      removeAccount: (account) => call("messages.removeAccount", { account }),
      removeMessages: (account, messageIds) =>
        call("messages.removeMessages", { account, messageIds }),
      setUnread: (account, threadId, unread) =>
        call("messages.setUnread", { account, threadId, unread }),
    },

    sync: {
      list: () => call("sync.list"),
      set: (state) => call("sync.set", { state }),
    },

    chats: {
      findBinding: (account, threadId) =>
        call<MailChatBinding | null>("chats.findBinding", {
          account,
          threadId,
        }),
      async findBindings(keys) {
        const rows = await call<Record<string, MailChatBinding>>(
          "chats.findBindings",
          { keys }
        );
        return new Map(Object.entries(rows ?? {}));
      },
      createConversation: (input) =>
        call("chats.createConversation", { input, now: now() }),
      setNoQuote: (chatId, noQuote) =>
        call("chats.setNoQuote", { chatId, noQuote }),
      findOpenPart: (chatId) =>
        call<MailChatOpenPart | null>("chats.findOpenPart", { chatId }),
      findPartThreadId: (partId, account) =>
        call<string | null>("chats.findPartThreadId", { partId, account }),
      rotatePart: (input) => call("chats.rotatePart", { input, now: now() }),
      addMessageToPart: (partId) =>
        call("chats.addMessageToPart", { partId }),
      reconcilePartCount: (input) =>
        call("chats.reconcilePartCount", { input }),
      rememberMessageIds: (input) =>
        call("chats.rememberMessageIds", { input }),
      findByMessageIds: (account, messageIds) =>
        call<{
          chatId: string;
          title: string;
          participantEmails: string[];
          noQuote: boolean;
        } | null>("chats.findByMessageIds", { account, messageIds }),
      bindThread: (input) => call("chats.bindThread", { input }),
      touch: (chatId) => call("chats.touch", { chatId }),
      listParts: (account, chatId) =>
        call<MailChatPartRow[]>("chats.listParts", { account, chatId }),
    },
  };
}

/** The store the standalone shell registers. */
export const tauriMailStore: MailStore = createTauriMailStore();
