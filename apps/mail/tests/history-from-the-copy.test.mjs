/**
 * Mail history refreshes behind a reader who starts a message.
 *
 * "Who you have written to" is the source that makes a person you emailed
 * last week offerable this week. It was read only when somebody pressed
 * Sync now: the pass that fires from compose asked one question — has any
 * source never synced? — and once every source had synced once the answer
 * was no for good. The rows then stood still, and an address written to
 * after that day was offered by nothing.
 *
 * Reading sent mail over the provider's API is hundreds of calls, which is
 * why it was held back. The local copy answers the same question with one
 * query, so for a mailbox the copy serves there is nothing to save by
 * waiting. That is what `hasStaleCopyHistory` decides.
 *
 * Every address here is invented.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { hasStaleCopyHistory } from "@/lib/mail/contact-sources";
import { setCachedConnectedMailAccounts } from "@/lib/mail/connected-accounts-cache";
import { forgetSyncStates } from "@/lib/mail/local-store";
import { setMailStore } from "@/lib/mail/store";

import { check, suite } from "./harness.mjs";

const VIEWER = "copy-history-viewer";
/** Served by the copy. */
const VERA = "vera@example.com";
/** Not served: its history is Sync now's work. */
const BO = "bo@example.test";

let syncRows = [];
let stateRows = [];
let disabled = null;

setMailStore({
  settings: { get: async () => disabled, set: async () => {} },
  sync: { list: async () => syncRows, set: async () => {} },
  contactSources: { listState: async () => stateRows },
});

const ago = (ms) => new Date(Date.now() - ms).toISOString();
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const setUp = ({ served = [VERA], states = [], off = false } = {}) => {
  syncRows = served.map((account) => ({ account, folder: "", phase: "live" }));
  stateRows = states;
  disabled = off ? JSON.stringify({ disabled: ["history"] }) : null;
  forgetSyncStates();
  setCachedConnectedMailAccounts(VIEWER, [
    { email: VERA, provider: "gmail", inMailTab: true, clerkUserId: VIEWER },
    { email: BO, provider: "outlook", inMailTab: true, clerkUserId: VIEWER },
  ]);
};

const history = (account, syncedAt) => ({
  source: "history",
  account,
  syncedAt,
  itemCount: 12,
  lastError: null,
});

suite(async () => {
  setUp({ states: [history(VERA, ago(3 * HOUR))] });
  check(
    "history the copy can refresh, and has not for hours, is read again",
    (await hasStaleCopyHistory(VIEWER)) === true
  );

  setUp({ states: [history(VERA, ago(2 * MINUTE))] });
  check(
    "but not twice in a minute, for a compose opened twice",
    (await hasStaleCopyHistory(VIEWER)) === false
  );

  setUp({ states: [] });
  check(
    "a mailbox whose history was never read is read now",
    (await hasStaleCopyHistory(VIEWER)) === true
  );

  setUp({ states: [history(VERA, "not a date")] });
  check(
    "and so is one whose last time cannot be read",
    (await hasStaleCopyHistory(VIEWER)) === true
  );

  /*
    The mailbox the copy does not serve is the whole point of the gate: its
    sent mail is hundreds of calls to the provider, and a reader starting a
    message must not wait for that.
  */
  setUp({ served: [], states: [history(BO, ago(30 * 24 * HOUR))] });
  check(
    "a mailbox the copy does not serve waits for Sync now, however old",
    (await hasStaleCopyHistory(VIEWER)) === false
  );

  setUp({ served: [VERA], states: [history(VERA, ago(3 * HOUR))], off: true });
  check(
    "and history turned off is not read at all",
    (await hasStaleCopyHistory(VIEWER)) === false
  );

  /*
    The two ends of the change, read as text: the copy answers first for
    either provider, and the background pass lets only those mailboxes
    through.
  */
  const src = readFileSync(
    join(
      process.cwd(),
      "../../products/mail/packages/mail/lib/mail/contact-sources.ts"
    ),
    "utf8"
  );
  /* The copy first, then whichever provider the mailbox belongs to. */
  const asks = src.slice(
    src.indexOf("async function syncHistory("),
    src.indexOf("upsertHistoryRows(account, entries)")
  );
  check(
    "the copy is asked before either provider's API",
    asks.indexOf("collectFromLocalCopy(account)") <
      asks.indexOf("collectGmailHistory(account)") &&
      asks.indexOf("collectFromLocalCopy(account)") <
        asks.indexOf("collectOutlookHistory(account)"),
    asks.includes("collectFromLocalCopy") ? "asked first" : "missing"
  );
  check(
    "and the background pass takes only mailboxes the copy serves",
    src.includes(
      "if (!includeHistory && !(await localStoreServes(account.email)))"
    )
  );

  const route = readFileSync(
    join(process.cwd(), "src/standalone-api.ts"),
    "utf8"
  );
  check(
    "the compose pass runs for stale copy history, without the slow scan",
    route.includes("hasStaleCopyHistory(OWNER_ID)") &&
      route.includes("includeHistory: !staleCopy"),
    route.includes("hasStaleCopyHistory") ? "wired" : "not wired"
  );
  check(
    "and still does nothing when neither reason holds",
    route.includes("if (ifStale && !firstRun && !staleCopy)") &&
      route.includes("skipped: true")
  );
});
