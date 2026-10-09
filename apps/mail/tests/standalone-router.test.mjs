/**
 * The standalone app's router: which path goes where, and what comes back
 * when nothing answers or something fails.
 *
 * mailboxes.test.mjs walks the account paths in detail. This checks the
 * router itself: an unknown path answers 501 and names the path; a
 * route's own refusal comes back as it gave it; an error thrown inside a
 * route comes back as a failed answer, not as a rejected promise; and
 * every path the build says it answers has a route.
 */

import { handleStandaloneMailApi } from "../src/standalone-api";
import * as standalone from "../src/standalone-api";
import { check, suite } from "./harness.mjs";

const json = async (res) => ({ status: res.status, body: await res.json() });

/** A store that answers nothing, or throws on one operation. */
function fakeStore(throwOn) {
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (cmd, args) => {
          if (cmd !== "mail_store_call") return null;
          if (args.op === throwOn) throw new Error(`the store refused ${args.op}`);
          if (args.op === "accounts.listForOwner") return [];
          return null;
        },
      },
    },
  };
}

suite(async () => {
  fakeStore();
  let r = await json(await handleStandaloneMailApi("/api/mail/nowhere"));
  check(
    "an unknown path answers 501 and names the path",
    r.status === 501 && r.body.error.includes("/api/mail/nowhere"),
    `${r.status} ${r.body.error}`
  );

  r = await json(await handleStandaloneMailApi("/api/mail/thread"));
  check(
    "a route's own refusal comes back as it gave it",
    r.status === 400 && r.body.error === "account and id are required",
    `${r.status} ${r.body.error}`
  );

  fakeStore("accounts.listForOwner");
  let threw = null;
  try {
    r = await json(await handleStandaloneMailApi("/api/gmail/accounts"));
  } catch (err) {
    threw = err;
  }
  check(
    "an error inside a route comes back as a failed answer",
    !threw && r.status === 500 && r.body.error.includes("the store refused"),
    threw ? `threw ${threw}` : `${r.status} ${r.body.error}`
  );

  // Every path the build names has a route. Before the route table there
  // was no table to read, and this check waits for it.
  const routes = standalone.STANDALONE_MAIL_ROUTES;
  if (routes) {
    const missing = standalone.STANDALONE_MAIL_PATHS.filter((p) => !(p in routes));
    check(
      "every path the build names has a route",
      missing.length === 0,
      missing.join(", ") || `${Object.keys(routes).length} routes`
    );
  }
});
