/**
 * Exchange Server on-prem over EWS: the calls to the native side.
 *
 * The webview cannot call EWS itself. The server sends no CORS headers, and
 * NTLM signs in a TCP connection, not a request. So the Rust side
 * (`mail-native/src/ews.rs`) sends each SOAP envelope, and this module is
 * the typed door to it. The password goes to Rust once, at connect, and
 * stays in the keychain.
 *
 * In both builds, in the desktop app only: outside it, each call here
 * refuses before it asks.
 *
 * Phase 1 of the Exchange work: the transport and the debug command. No sync worker and no connect form yet.
 */

import { isPublicMailProduct } from "@/lib/mail/product-flavor";
import { SEARCH_KNOWN_SERVERS_KEY } from "@/lib/mail/exchange-connect";
import { tauriInvoke } from "@/lib/mail/store/tauri";

/** The inbox name and counts, as `GetFolder` returns them. */
export type ExchangeFolderSummary = {
  displayName: string;
  totalCount: number;
  unreadCount: number;
  childFolderCount: number;
};

export type ExchangeConnectInput = {
  /** The mailbox address. The account key everywhere else. */
  email: string;
  /** The sign-in name. Not always the address: `DOMAIN\user` also works. */
  username: string;
  password: string;
  /** The EWS endpoint, `https://<server>/EWS/Exchange.asmx`. */
  url: string;
};

/**
 * The kinds of error. Rust starts each message with one of these, so the
 * caller can act on the kind without reading the words.
 */
export type ExchangeErrorCode =
  | "ews:refused"
  | "ews:no-scheme"
  | "ews:busy"
  | "ews:fault"
  | "ews:http"
  | "ews:network"
  | "ews:no-account"
  | "ews:invalid"
  | "ews:parse"
  | "ews:unsupported"
  | "ews:unavailable";

const CODES: readonly ExchangeErrorCode[] = [
  "ews:refused",
  "ews:no-scheme",
  "ews:busy",
  "ews:fault",
  "ews:http",
  "ews:network",
  "ews:no-account",
  "ews:invalid",
  "ews:parse",
  "ews:unsupported",
  "ews:unavailable",
];

export class ExchangeError extends Error {
  readonly code: ExchangeErrorCode | null;

  constructor(message: string, code: ExchangeErrorCode | null = exchangeErrorCode(message)) {
    super(message);
    this.name = "ExchangeError";
    this.code = code;
  }
}

/** The code at the start of a message from the native side, if any. */
export function exchangeErrorCode(message: string): ExchangeErrorCode | null {
  return CODES.find((code) => message.startsWith(`${code}:`)) ?? null;
}

type Invoke = NonNullable<ReturnType<typeof tauriInvoke>>;

function bridge(): Invoke {
  const invoke = tauriInvoke();
  if (!invoke) {
    throw new ExchangeError("ews:unavailable: Exchange accounts need the desktop app.", "ews:unavailable");
  }
  return invoke;
}

/** One EWS command, for the modules that own a command of their own. */
export function invoke<T>(command: string, args: Record<string, unknown>): Promise<T> {
  return call(command, args);
}

async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const invoke = bridge();
  try {
    return (await invoke(command, args)) as T;
  } catch (err) {
    throw new ExchangeError(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Sign in, keep the password in the keychain, and write the account row.
 * Returns the inbox. If the sign-in fails, nothing is kept. The owner is
 * `local` in the desktop apps.
 */
export function connectExchange(input: ExchangeConnectInput, ownerId = "local"): Promise<ExchangeFolderSummary> {
  return call("mail_ews_connect", { ...input, ownerId });
}

/** A mail folder on the server. */
export type ExchangeFolder = {
  id: string;
  parentId: string | null;
  name: string;
  folderClass: string | null;
  total: number;
  unread: number;
  childCount: number;
};

/** The folder changes since a sync state, or every mail folder without one. */
export type ExchangeHierarchy = {
  folders: ExchangeFolder[];
  deleted: string[];
  /** On the first call only: folder id by EWS name (`inbox`, `sentitems`, ...). */
  wellKnown: Record<string, string> | null;
  syncState: string;
};

export type ExchangeAddress = { name: string; email: string };

/** The row fields of one item, as Rust reads them from `GetItem`. */
export type ExchangeItemRow = {
  id: string;
  conversationId: string | null;
  internetMessageId: string | null;
  itemClass: string | null;
  subject: string;
  from: ExchangeAddress | null;
  sender: ExchangeAddress | null;
  to: ExchangeAddress[];
  cc: ExchangeAddress[];
  receivedAt: number | null;
  sentAt: number | null;
  isRead: boolean;
  isDraft: boolean;
  flagStatus: string | null;
  preview: string;
  hasAttachments: boolean;
  size: number | null;
};

/** One page of changes in a folder. */
export type ExchangeItemsPage = {
  items: ExchangeItemRow[];
  deleted: string[];
  syncState: string;
  lastPage: boolean;
  /** Changed items whose row the copy has as it is (`known`): not read again. */
  kept?: string[];
};

/** The newest items of a folder, newest first, with their change keys. */
export type ExchangeNewestItems = {
  items: ExchangeItemRow[];
  keys: Record<string, string>;
};

/** The folder list since `syncState` (null or empty: all of it). */
export function syncExchangeHierarchy(account: string, syncState: string | null): Promise<ExchangeHierarchy> {
  return call("mail_ews_sync_hierarchy", { account, syncState });
}

/**
 * One page of changes in a folder since `syncState`. `known` is the change
 * key of each row the copy has as it is now; those are not read again.
 */
export function syncExchangeItems(
  account: string,
  folderId: string,
  syncState: string | null,
  known?: Record<string, string>
): Promise<ExchangeItemsPage> {
  return call("mail_ews_sync_items", known ? { account, folderId, syncState, known } : { account, folderId, syncState });
}

/** The newest `count` items of a folder, newest first, for a first read. */
export function newestExchangeItems(account: string, folderId: string, count: number): Promise<ExchangeNewestItems> {
  return call("mail_ews_newest_items", { account, folderId, count });
}

/** Get the bodies of these items and keep them in the store. */
export function fetchExchangeBodies(account: string, itemIds: string[]): Promise<number> {
  return call("mail_ews_fetch_bodies", { account, itemIds });
}

/** One attachment of an item, by its MIME section. */
export function fetchExchangePart(
  account: string,
  itemId: string,
  section: string
): Promise<{ bytesBase64: string; mimeType: string; filename: string | null }> {
  return call("mail_ews_fetch_part", { account, itemId, section });
}

/** The whole message of an item, base64, for Show original (section 16.1). */
export function fetchExchangeSource(account: string, itemId: string): Promise<string> {
  return call("mail_ews_fetch_source", { account, itemId });
}

/** Send one SOAP envelope for a connected account. Returns the XML answer. */
export function callExchange(account: string, body: string): Promise<string> {
  return call("mail_ews_call", { account, body });
}

/** The inbox name and counts for a connected account. */
export function exchangeInbox(account: string): Promise<ExchangeFolderSummary> {
  return call("mail_ews_inbox", { account });
}

/** One id the server did not change, and why. */
export type ExchangeFailure = { id: string; error: string };

/** The answer to a change: the ids done, and the ids that failed. */
export type ExchangeChanged = { done: string[]; failed: ExchangeFailure[] };

/** The answer to a move: each item's id before and after. Null: already gone. */
export type ExchangeMoved = { moved: { id: string; newId: string | null }[]; failed: ExchangeFailure[] };

/** Mark items read or unread on the server. */
export function setExchangeRead(account: string, itemIds: string[], isRead: boolean): Promise<ExchangeChanged> {
  return call("mail_ews_set_read", { account, itemIds, isRead });
}

/** Flag or unflag items on the server. */
export function setExchangeFlag(account: string, itemIds: string[], flagged: boolean): Promise<ExchangeChanged> {
  return call("mail_ews_set_flag", { account, itemIds, flagged });
}

/** Move items to a folder. Answers the new id of each item. */
export function moveExchangeItems(account: string, itemIds: string[], toFolderId: string): Promise<ExchangeMoved> {
  return call("mail_ews_move", { account, itemIds, toFolderId });
}

/** Make a mail folder under a folder. Answers the new folder. */
export function createExchangeFolder(account: string, parentId: string, name: string): Promise<ExchangeFolder> {
  return call("mail_ews_create_folder", { account, parentId, name });
}

/** Give a folder a new name. */
export function renameExchangeFolder(account: string, folderId: string, name: string): Promise<void> {
  return call("mail_ews_rename_folder", { account, folderId, name });
}

/**
 * Move a folder under another folder, or to Deleted Items with `toFolderId`
 * null. The app never deletes a folder: a delete is this move.
 */
export function moveExchangeFolder(account: string, folderId: string, toFolderId: string | null): Promise<void> {
  return call("mail_ews_move_folder", { account, folderId, toFolderId });
}

/**
 * Delete these items for good (`HardDelete`). Only the items named: Rust
 * refuses a request with none, and any request that empties a folder.
 */
export function deleteExchangeForever(account: string, itemIds: string[]): Promise<ExchangeChanged> {
  if (!itemIds.length) {
    return Promise.reject(new ExchangeError("ews:invalid: No item was named. Nothing was sent to the server.", "ews:invalid"));
  }
  return call("mail_ews_delete_forever", { account, itemIds });
}

/** One background batch of bodies, for rows sent since `since` (ms). */
export function fetchExchangeMissingBodies(account: string, since: number): Promise<{ kept: number; more: boolean }> {
  return call("mail_ews_fetch_missing_bodies", { account, since });
}

/** The names and counts of these folders, as the server has them now. */
export function exchangeFolderCounts(account: string, folderIds: string[]): Promise<ExchangeFolder[]> {
  return call("mail_ews_folder_counts", { account, folderIds });
}

/**
 * True when the keychain has a password for the account, and the server has
 * not refused it since the last connect. No call to the server.
 */
export function exchangeReady(account: string): Promise<boolean> {
  return call("mail_ews_ready", { account });
}

/** Remove the account's password from the keychain. */
export function disconnectExchange(account: string): Promise<void> {
  return call("mail_ews_disconnect", { account });
}

/** One line for the console: the inbox name and its counts. */
export function describeInbox(summary: ExchangeFolderSummary): string {
  return (
    `${summary.displayName}: ${summary.totalCount} messages, ` +
    `${summary.unreadCount} unread, ${summary.childFolderCount} subfolders`
  );
}

export type ExchangeDebug = {
  connect(input: Omit<ExchangeConnectInput, "password"> & { password?: string }): Promise<ExchangeFolderSummary>;
  inbox(account: string): Promise<ExchangeFolderSummary>;
  call(account: string, body: string): Promise<string>;
  disconnect(account: string): Promise<void>;
  /** Treat ku.dk as unknown, so "Find server" can be tried on KU. */
  testDiscovery(on: boolean): void;
};

/**
 * Ask for the password in a small box on the page. The Mac web view does not
 * show `window.prompt()`: it returns nothing at once. Without a document (in
 * the tests), fall back to `prompt()`. Returns null if the user cancels.
 */
function askPassword(target: Window, label: string): Promise<string | null> {
  const doc = (target as Partial<Window>).document;
  if (!doc) return Promise.resolve(target.prompt(label));
  return new Promise((resolve) => {
    const form = doc.createElement("form");
    form.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;" +
      "background:rgba(0,0,0,.4);font:14px system-ui";
    const box = doc.createElement("div");
    box.style.cssText =
      "display:flex;flex-direction:column;gap:8px;padding:16px;border-radius:8px;background:#fff;color:#000;min-width:280px";
    const text = doc.createElement("label");
    text.textContent = label;
    const input = doc.createElement("input");
    input.type = "password";
    input.autocomplete = "off";
    input.style.cssText = "padding:6px;border:1px solid #999;border-radius:4px";
    const buttons = doc.createElement("div");
    buttons.style.cssText = "display:flex;gap:8px;justify-content:flex-end";
    const cancel = doc.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    const ok = doc.createElement("button");
    ok.type = "submit";
    ok.textContent = "Sign in";
    buttons.append(cancel, ok);
    box.append(text, input, buttons);
    form.append(box);
    const done = (value: string | null) => {
      form.remove();
      resolve(value);
    };
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      done(input.value);
    });
    cancel.addEventListener("click", () => done(null));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") done(null);
    });
    doc.body.append(form);
    input.focus();
  });
}

/**
 * The debug command: `dhExchange` on the window, for the web inspector.
 *
 *   await dhExchange.connect({ email, username, url })
 *   await dhExchange.inbox(email)
 *   dhExchange.testDiscovery(true)   // "Find server" for ku.dk too
 *
 * Each prints the inbox name and counts. `connect` asks for the password in
 * a box on the page if it is not given, so that it does not stay in the
 * console history. Internal flavor only: in the public build this does nothing.
 */
export function installExchangeDebug(target: Window = window): void {
  if (isPublicMailProduct()) return;
  const log = (summary: ExchangeFolderSummary) => {
    console.info(`[exchange] ${describeInbox(summary)}`);
    return summary;
  };
  const debug: ExchangeDebug = {
    async connect(input) {
      const password = input.password ?? (await askPassword(target, `Password for ${input.username}`));
      if (!password) {
        throw new ExchangeError("ews:invalid: No password. Nothing was sent to the server.", "ews:invalid");
      }
      return log(await connectExchange({ ...input, password }));
    },
    async inbox(account) {
      return log(await exchangeInbox(account));
    },
    call: callExchange,
    disconnect: disconnectExchange,
    testDiscovery(on) {
      try {
        if (on) target.localStorage.setItem(SEARCH_KNOWN_SERVERS_KEY, "1");
        else target.localStorage.removeItem(SEARCH_KNOWN_SERVERS_KEY);
      } catch {
        /* private mode: the switch cannot be kept */
      }
      console.info(
        on
          ? "[exchange] Autodiscover test on: no server is filled in, and Connect Exchange offers Find server for every domain. Off with dhExchange.testDiscovery(false)."
          : "[exchange] Autodiscover test off: the KU server is filled in again."
      );
    },
  };
  (target as unknown as { dhExchange?: ExchangeDebug }).dhExchange = debug;
}
