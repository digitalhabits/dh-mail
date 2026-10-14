/**
 * A Gmail on an app password has no address book that Google's API gives.
 *
 * The start-up sync asked Google's People API for it anyway, the token call
 * refused, and the reader saw "… is connected with an app password, which
 * Google's Gmail API does not take" in red each time Mail opened. The sync
 * now passes over that mailbox's address book without a call or an error.
 *
 * Every address here is invented.
 */

import { syncAllContactSources } from "@/lib/mail/contact-sources";
import { setCachedConnectedMailAccounts } from "@/lib/mail/connected-accounts-cache";
import { setMailStore } from "@/lib/mail/store";

import { check, suite } from "./harness.mjs";

const VIEWER = "app-password-contacts-viewer";
const PAM = "pam@example.com";

const fetched = [];
globalThis.fetch = async (url) => {
  fetched.push(String(url));
  throw new Error(`no network in this test: ${url}`);
};

setMailStore({
  settings: { get: async () => null, set: async () => {} },
  sync: { list: async () => [], set: async () => {} },
  accounts: {
    getToken: async (_provider, email) =>
      email === PAM ? { refreshToken: "app-password:abcdefghijklmnop" } : null,
  },
  contactSources: {
    listState: async () => [],
    saveState: async () => {},
    replaceContacts: async () => {},
  },
});

suite(async () => {
  setCachedConnectedMailAccounts(VIEWER, [
    { email: PAM, provider: "gmail", inMailTab: true, clerkUserId: VIEWER },
  ]);
  const results = await syncAllContactSources({
    clerkUserId: VIEWER,
    includeHistory: false,
  });
  check(
    "no red line for the app-password mailbox",
    results.every((r) => r.ok),
    JSON.stringify(results)
  );
  check(
    "and nothing asked of Google for it",
    !fetched.some((u) => /googleapis|oauth2/.test(u)),
    fetched.join(", ")
  );
});
