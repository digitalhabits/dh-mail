/**
 * "Delete forever" across mailboxes: each conversation goes to its own
 * provider, by its own account, and to nobody else's.
 *
 * In the by-person view one person's pile can hold a conversation from a
 * Gmail mailbox and one from an Outlook mailbox. One press deletes both, so
 * the press becomes one call for each conversation. These check where every
 * one of those calls goes: a Gmail thread id must never reach Graph, an
 * Outlook conversation id must never reach Gmail, and a mailbox that the
 * local copy serves must go through the worker's queue and not the network.
 */

import { deleteMailThreadForever } from "@/lib/mail/inbox";
import { forgetSyncStates } from "@/lib/mail/local-store";

import { check, suite } from "./harness.mjs";

const GMAIL = "vera@gmail.com";
const GMAIL_SERVED = "studio@gmail.com";
const OUTLOOK = "vera@outlook.com";

const account = (email) => ({
  email,
  ownerId: "local",
  historyId: null,
  lastSyncedAt: null,
  lastSyncError: null,
  inMailTab: true,
});

const ROWS = {
  gmail: [account(GMAIL), account(GMAIL_SERVED)],
  outlook: [account(OUTLOOK)],
};

function harness() {
  const log = { invoked: [], tokensFor: [], sent: [] };
  globalThis.window = {
    dispatchEvent: () => true,
    __TAURI__: {
      core: {
        invoke: async (cmd, args) => {
          if (cmd === "oauth_token_request") {
            return { status: 200, body: { access_token: "at", expires_in: 3600 } };
          }
          if (cmd === "mail_sync_action") {
            log.invoked.push(args);
            return 1;
          }
          if (cmd !== "mail_store_call") return null;
          const { op, args: a } = args;
          if (op === "accounts.listForOwner") return ROWS[a.provider] ?? [];
          if (op === "accounts.exists") {
            return (ROWS[a.provider] ?? []).some((row) => row.email === a.email);
          }
          if (op === "accounts.getToken") {
            log.tokensFor.push(a.email);
            return { refreshToken: "rt", ownerId: "local" };
          }
          if (op === "accounts.listOwnedEmails") return a.emails;
          // The copy serves one Gmail mailbox and neither of the others.
          if (op === "sync.list") {
            return [{ account: GMAIL_SERVED, folder: "", phase: "live" }];
          }
          if (op === "messages.applyAction") {
            log.invoked.push({ applyLocal: a });
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
    if (at.includes("oauth2") || at.includes("/token")) {
      return json({ access_token: "at", expires_in: 3600 });
    }
    log.sent.push({
      method: init?.method ?? "GET",
      url: at,
      body: init?.body ? JSON.parse(init.body) : null,
    });
    if (at.includes("/threads/g-1")) {
      return json({
        id: "g-1",
        messages: [
          { id: "gm-a", labelIds: ["TRASH"] },
          { id: "gm-b", labelIds: ["INBOX"] },
        ],
      });
    }
    if (at.includes("/mailFolders/deleteditems/messages")) {
      const first = !log.sent.some((r) => r.url.endsWith("/permanentDelete"));
      return json({ value: first ? [{ id: "om-a" }] : [] });
    }
    return json(null, 204);
  };
  forgetSyncStates();
  return log;
}

suite(async () => {
  const log = harness();

  // One person's pile in Trash: a Gmail conversation, an Outlook one, and
  // one in a Gmail mailbox that the local copy serves.
  await Promise.all([
    deleteMailThreadForever(GMAIL, "g-1", "trash"),
    deleteMailThreadForever(OUTLOOK, "o-1", "trash"),
    deleteMailThreadForever(GMAIL_SERVED, "1f", "trash"),
  ]);

  const toGmail = log.sent.filter((r) => r.url.includes("gmail.googleapis.com"));
  const toGraph = log.sent.filter((r) => r.url.includes("graph.microsoft.com"));

  check(
    "the Gmail conversation goes to Gmail: its Trash messages, by id, in one batchDelete",
    toGmail.some(
      (r) => r.url.endsWith("/messages/batchDelete") && JSON.stringify(r.body) === '{"ids":["gm-a"]}'
    ),
    JSON.stringify(toGmail.map((r) => `${r.method} ${r.url} ${JSON.stringify(r.body)}`))
  );
  check(
    "the Outlook conversation goes to Graph: Deleted Items, that conversation, permanentDelete",
    toGraph.some((r) => r.url.includes("/mailFolders/deleteditems/messages") && r.url.includes("conversationId eq 'o-1'")) &&
      toGraph.some((r) => r.method === "POST" && r.url.endsWith("/messages/om-a/permanentDelete")),
    JSON.stringify(toGraph.map((r) => `${r.method} ${r.url}`))
  );
  check(
    "no id crosses over: nothing of Outlook's reaches Gmail, nothing of Gmail's reaches Graph",
    !toGmail.some((r) => /o-1|om-a/.test(r.url + JSON.stringify(r.body))) &&
      !toGraph.some((r) => /g-1|gm-a|gm-b|1f/.test(r.url + JSON.stringify(r.body))),
    JSON.stringify(log.sent.map((r) => r.url))
  );
  check(
    "the inbox message of the Gmail thread is not touched",
    !JSON.stringify(log.sent).includes("gm-b")
  );
  check(
    "each mailbox is asked for its own token, and the served one for none",
    log.tokensFor.includes(GMAIL) && log.tokensFor.includes(OUTLOOK) && !log.tokensFor.includes(GMAIL_SERVED),
    log.tokensFor.join(",")
  );

  const queued = log.invoked.filter((a) => a.account === GMAIL_SERVED);
  check(
    "the mailbox the copy serves goes through the worker's queue, with the folder named",
    queued.length === 1 &&
      queued[0].kind === "deleteForever" &&
      queued[0].threadId === "1f" &&
      queued[0].payload?.from === "trash",
    JSON.stringify(queued)
  );
  check(
    "and makes no network call of its own",
    !log.sent.some((r) => (r.url + JSON.stringify(r.body)).includes("1f")),
    JSON.stringify(log.sent.map((r) => r.url))
  );
  check(
    "only that one mailbox is queued: the other two were not served by the copy",
    log.invoked.filter((a) => a.kind === "deleteForever").length === 1
  );
});
