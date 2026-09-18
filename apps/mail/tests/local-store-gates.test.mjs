/**
 * The gates that decide whether the copy answers, fed the shape the
 * store's JSON door hands over — the same key names the Rust test
 * `the_json_door_answers_in_the_shape_the_interface_reads` pins down.
 */

import { forgetSyncStates, localStoreComplete, localStoreServes, stateServes } from "@/lib/mail/local-store";
import { setMailStore } from "@/lib/mail/store";

import { check, suite } from "./harness.mjs";

let rows = [];
setMailStore({
  settings: { get: async () => null, set: async () => {} },
  sync: { list: async () => rows, set: async () => {} },
});

const set = (next) => {
  rows = next;
  forgetSyncStates();
};

suite(async () => {
  check("no state: the provider answers", stateServes(undefined) === false);
  check("a first sync with no rows yet answers from the copy", stateServes({ phase: "full", fullSyncDone: 0 }) === true);
  check("a live copy answers", stateServes({ phase: "live" }) === true);
  check("a paused copy does not", stateServes({ phase: "paused" }) === false);
  check("nor an expired or stopped one", stateServes({ phase: "expired" }) === false && stateServes({ phase: "none" }) === false);

  set([{ account: "Vera@Example.com", folder: "", phase: "full", fullSyncDone: 600, fullSyncTotal: 1000 }]);
  check("the list reads the copy during the first sync", (await localStoreServes("vera@example.com")) === true);
  check("a thread waits for the whole copy", (await localStoreComplete("vera@example.com")) === false);
  check("the mailbox address is matched whatever its case", (await localStoreServes("VERA@example.com")) === true);
  check("another mailbox is not served", (await localStoreServes("bo@example.com")) === false);

  set([{ account: "vera@example.com", folder: "", phase: "live" }, { account: "vera@example.com", folder: "trash", phase: "full" }]);
  check("once live the whole copy answers", (await localStoreComplete("vera@example.com")) === true);
  check("the overall row decides, not a side folder's", (await localStoreServes("vera@example.com")) === true);
});
