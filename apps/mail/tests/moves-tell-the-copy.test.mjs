/**
 * A mail the reader moves is in the view it went to at once.
 *
 * The list of a view reads the local copy, so the copy has to be told the
 * moment the reader acts, and not learn of it from the next sync. Two places
 * did not do this for an Outlook mailbox:
 *
 * - A move to a named folder changed the server and said nothing to the
 *   copy. The folder's view showed the mail up to a minute later.
 * - Trash and Junk were not read from the copy at all. They were listed from
 *   Graph, which can still be without a mail whose move is in flight.
 */

import { moveMailThreadToFolder } from "@/lib/mail/folders";
import { forgetSyncStates, localStoreServesFolder } from "@/lib/mail/local-store";
import { forgetOutlookMoves } from "@/lib/mail/outlook-moves";

import { check, suite } from "./harness.mjs";

const OUTLOOK = "vera@outlook.com";
const GMAIL = "vera@gmail.com";

const account = (email) => ({
  email,
  ownerId: "local",
  historyId: null,
  lastSyncedAt: null,
  lastSyncError: null,
  inMailTab: true,
});
const ROWS = { gmail: [account(GMAIL)], outlook: [account(OUTLOOK)] };

function harness(states) {
  const log = { applied: [], sent: [] };
  globalThis.window = {
    dispatchEvent: () => true,
    setTimeout: () => 0,
    clearTimeout: () => {},
    __TAURI__: {
      core: {
        invoke: async (cmd, args) => {
          if (cmd === "oauth_token_request") {
            return { status: 200, body: { access_token: "at", expires_in: 3600 } };
          }
          if (cmd !== "mail_store_call") return null;
          const { op, args: a } = args;
          if (op === "accounts.listForOwner") return ROWS[a.provider] ?? [];
          if (op === "accounts.exists") return (ROWS[a.provider] ?? []).some((r) => r.email === a.email);
          if (op === "accounts.getToken") return { refreshToken: "rt", ownerId: "local" };
          if (op === "accounts.listOwnedEmails") return a.emails;
          if (op === "sync.list") return states;
          if (op === "messages.applyAction") {
            log.applied.push(a);
            return null;
          }
          return null;
        },
      },
    },
  };
  globalThis.fetch = async (url, init) => {
    const at = decodeURIComponent(String(url).replace(/\+/g, " "));
    const json = (body, status = 200) =>
      new Response(status === 204 ? null : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    if (at.includes("oauth2") || at.includes("/token")) return json({ access_token: "at", expires_in: 3600 });
    log.sent.push({ method: init?.method ?? "GET", url: at, body: init?.body ? JSON.parse(init.body) : null });
    if (/\/messages\/[^/]+\/move$/.test(at)) return json({ id: "new-id-in-the-folder" });
    if (at.includes("/mailFolders") && !at.includes("/messages")) {
      return json({
        value: [
          { id: "f-receipts", displayName: "Receipts", childFolderCount: 0, totalItemCount: 3, unreadItemCount: 0 },
        ],
      });
    }
    if (at.includes("/messages")) {
      return json({ value: [{ id: "om-1", conversationId: "conv-1", receivedDateTime: "2026-09-19T10:00:00Z" }] });
    }
    return json({});
  };
  forgetSyncStates();
  forgetOutlookMoves();
  return log;
}

suite(async () => {
  // ---- An Outlook mail filed in a named folder -----------------------------
  {
    const log = harness([{ account: OUTLOOK, folder: "", phase: "live" }]);
    const out = await moveMailThreadToFolder({ account: OUTLOOK, threadId: "conv-1", folderName: "Receipts" });
    const moved = log.sent.filter((r) => r.url.endsWith("/move"));
    check(
      "the server is told: the message is moved into the folder",
      moved.length === 1 && moved[0].body?.destinationId === "f-receipts",
      JSON.stringify(log.sent.map((r) => `${r.method} ${r.url}`))
    );
    check(
      "and the copy is told at once, under the folder's own label",
      log.applied.length === 1 &&
        log.applied[0].account === OUTLOOK &&
        log.applied[0].threadId === "conv-1" &&
        log.applied[0].kind === "move" &&
        log.applied[0].payload?.label === out.folderName,
      JSON.stringify(log.applied)
    );
  }

  // ---- Which mailbox's Trash and Junk the copy answers for ------------------
  {
    harness([{ account: OUTLOOK, folder: "", phase: "live" }]);
    check(
      "Outlook, first read done: the copy answers for Trash and for Junk",
      (await localStoreServesFolder(OUTLOOK, "trash")) && (await localStoreServesFolder(OUTLOOK, "spam"))
    );
  }
  {
    harness([{ account: OUTLOOK, folder: "", phase: "full" }]);
    check(
      "Outlook, first read still under way: the provider answers, since the copy may not hold Trash yet",
      (await localStoreServesFolder(OUTLOOK, "trash")) === false
    );
  }
  {
    harness([
      { account: GMAIL, folder: "", phase: "live" },
      { account: GMAIL, folder: "trash", phase: "live" },
    ]);
    check(
      "Gmail is judged by its side folder, as before: Trash is live and Junk is not",
      (await localStoreServesFolder(GMAIL, "trash")) === true &&
        (await localStoreServesFolder(GMAIL, "spam")) === false
    );
  }
});
