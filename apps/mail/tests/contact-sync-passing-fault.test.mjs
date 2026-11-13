/**
 * A fault at the mail server during the start-up contact sync is quiet.
 *
 * When Outlook was down, Mail showed two messages: the "sync paused" notice
 * in the list, and a red one with the whole failed request ("Graph GET
 * /me/contacts?%24select=… failed (502): {"error":…"). The reader can do
 * nothing about a server fault, and the list's notice says it already. The
 * sync now marks such a fault as passing, so the app shows no message, and
 * Contact sources gets plain words in place of the request text.
 *
 * Every address here is invented.
 */

import { syncAllContactSources } from "@/lib/mail/contact-sources";
import { setCachedConnectedMailAccounts } from "@/lib/mail/connected-accounts-cache";
import { setMailStore } from "@/lib/mail/store";
import { isPassingFault, syncPauseKind } from "@/lib/mail/sync-pause";

import { check, suite } from "./harness.mjs";

const VIEWER = "contact-sync-passing-viewer";
const OLA = "ola@example.com";

const GRAPH_502 =
  'Graph GET /me/contacts?%24select=id%2CdisplayName%2CemailAddresses&%24top=100 failed (502): {"error":{"code":"UnknownError","message":""}}';

// The token comes over the desktop bridge; every other call is Graph, down.
globalThis.window = globalThis;
globalThis.__TAURI__ = {
  core: {
    invoke: async (command) =>
      command === "oauth_token_request"
        ? { status: 200, ok: true, body: { access_token: "t", expires_in: 3600 } }
        : null,
  },
};
globalThis.fetch = async () => {
  return new Response('{"error":{"code":"UnknownError","message":""}}', {
    status: 502,
    headers: { "content-type": "application/json" },
  });
};

const saved = [];
setMailStore({
  settings: { get: async () => null, set: async () => {} },
  sync: { list: async () => [], set: async () => {} },
  accounts: {
    getToken: async () => ({
      refreshToken: "r",
      accessToken: "t",
      expiresAt: Date.now() + 3_600_000,
    }),
    saveToken: async () => {},
  },
  contactSources: {
    listState: async () => [],
    saveState: async (...args) => {
      saved.push(args);
    },
    replaceContacts: async () => {},
  },
});

suite(async () => {
  check("a 502 is a passing fault", isPassingFault(syncPauseKind(GRAPH_502)));
  check("a lost connection is too", isPassingFault(syncPauseKind("Load failed")));
  check(
    "a sign-in fault is not",
    !isPassingFault(syncPauseKind("Reconnect this account to grant contacts access"))
  );

  setCachedConnectedMailAccounts(VIEWER, [
    { email: OLA, provider: "outlook", inMailTab: true, clerkUserId: VIEWER },
  ]);
  const results = await syncAllContactSources({
    clerkUserId: VIEWER,
    includeHistory: false,
  });
  const row = results.find((r) => r.account === OLA);
  check("the Outlook address book failed", row?.ok === false, JSON.stringify(results));
  check("it is marked as passing", row?.passing === true, JSON.stringify(row));
  check(
    "the words are plain: no request text, no code",
    row?.error === "The mail server did not answer. Mail tries again later.",
    String(row?.error)
  );
  check(
    "Contact sources is given the same plain words",
    JSON.stringify(saved).includes("did not answer") &&
      !JSON.stringify(saved).includes("Graph GET"),
    JSON.stringify(saved)
  );
});
