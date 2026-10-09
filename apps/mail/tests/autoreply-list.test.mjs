/**
 * Listing out-of-office settings across mailboxes.
 *
 * One mailbox that cannot answer must not take the feature away from the
 * others — and must say why, rather than leaving a silence where the row
 * should be. A personal Microsoft account is the case this was written for:
 * Graph answers its mailbox settings with 404, and before this the whole
 * request failed, so nobody saw an out-of-office row at all.
 */

import { listMailAutoReplies } from "@/lib/mail/mail-autoreply";
import { check, suite } from "./harness.mjs";

const ROWS = {
  gmail: [
    {
      email: "me@gmail.com",
      ownerId: "local",
      historyId: null,
      lastSyncedAt: null,
      lastSyncError: null,
      inMailTab: true,
    },
  ],
  outlook: [
    {
      email: "parent@outlook.com",
      ownerId: "local",
      historyId: null,
      lastSyncedAt: null,
      lastSyncError: null,
      inMailTab: true,
    },
  ],
};

/**
 * Both providers answer: Gmail with a vacation setting, Graph with whatever
 * `graphStatus` says. Tokens come back for either.
 */
function harness(graphStatus) {
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (cmd, args) => {
          if (cmd === "oauth_token_request") {
            return { status: 200, body: { access_token: "at" } };
          }
          if (cmd !== "mail_store_call") return null;
          if (args.op === "accounts.listForOwner") {
            return ROWS[args.args.provider] ?? [];
          }
          if (args.op === "accounts.getToken") {
            return { refreshToken: "rt", ownerId: "local" };
          }
          if (args.op === "accounts.listOwnedEmails") return args.args.emails;
          return null;
        },
      },
    },
  };
  globalThis.fetch = async (url) => {
    const at = String(url);
    if (at.includes("oauth2") || at.includes("token")) {
      return new Response(
        JSON.stringify({ access_token: "at", expires_in: 3600 }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (at.includes("mailboxSettings")) {
      if (graphStatus !== 200) {
        return new Response(JSON.stringify({ error: { code: "MailboxNotEnabledForRESTAPI" } }), {
          status: graphStatus,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({ automaticRepliesSetting: { status: "disabled" } }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (at.includes("vacation")) {
      return new Response(
        JSON.stringify({ enableAutoReply: true, responseSubject: "Away" }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    return new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

const find = (list, email) => list.find((a) => a.account === email);

suite(async () => {
  // ---- A mailbox Graph will not answer for ---------------------------------
  harness(404);
  let list = await listMailAutoReplies("all", "local");

  check(
    "the request survives a mailbox that cannot answer",
    list.length === 2,
    `${list.length} entries`
  );
  check(
    "the other mailbox keeps its out-of-office, which is the whole point",
    find(list, "me@gmail.com")?.enabled === true &&
      find(list, "me@gmail.com")?.unavailable === undefined
  );
  check(
    "the one that could not answer says so, rather than offering Set up…",
    Boolean(find(list, "parent@outlook.com")?.unavailable),
    find(list, "parent@outlook.com")?.unavailable
  );
  check(
    "and it is still labelled Outlook, not Gmail",
    find(list, "parent@outlook.com")?.provider === "outlook",
    find(list, "parent@outlook.com")?.provider
  );

  // ---- A mailbox that answers ---------------------------------------------
  harness(200);
  list = await listMailAutoReplies("all", "local2");
  check(
    "a mailbox that answers carries no reason at all",
    find(list, "parent@outlook.com")?.unavailable === undefined &&
      find(list, "parent@outlook.com")?.enabled === false
  );

  // ---- A hidden mailbox ---------------------------------------------------
  // Hidden keeps its mail off the screen. Its out-of-office is still the
  // reader's to set, so it is still listed.
  ROWS.gmail[0].inMailTab = false;
  list = await listMailAutoReplies("all", "local3");
  check(
    "a hidden mailbox is still listed, so its reply can be set",
    find(list, "me@gmail.com")?.enabled === true,
    JSON.stringify(list.map((a) => a.account))
  );
});
