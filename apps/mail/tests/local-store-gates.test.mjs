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
  // Offline, a sync pauses. The copy on disk is then the only source there is.
  check("a paused copy that never read anything does not", stateServes({ phase: "paused" }) === false);
  check(
    "a paused copy that has read before answers (offline)",
    stateServes({ phase: "paused", lastOkAt: 1_700_000_000_000, lastError: "error sending request" }) === true
  );
  check(
    "a first read paused partway answers with what it holds",
    stateServes({ phase: "paused", fullSyncDone: 400, fullSyncTotal: 5000 }) === true
  );
  check("nor an expired or stopped one", stateServes({ phase: "expired" }) === false && stateServes({ phase: "none" }) === false);

  set([{ account: "Vera@Example.com", folder: "", phase: "full", fullSyncDone: 600, fullSyncTotal: 1000 }]);
  check("the list reads the copy during the first sync", (await localStoreServes("vera@example.com")) === true);
  check("a thread waits for the whole copy", (await localStoreComplete("vera@example.com")) === false);
  check("the mailbox address is matched whatever its case", (await localStoreServes("VERA@example.com")) === true);
  check("another mailbox is not served", (await localStoreServes("bo@example.com")) === false);

  set([{ account: "vera@example.com", folder: "", phase: "live" }, { account: "vera@example.com", folder: "trash", phase: "full" }]);
  check("once live the whole copy answers", (await localStoreComplete("vera@example.com")) === true);
  check("the overall row decides, not a side folder's", (await localStoreServes("vera@example.com")) === true);

  // Offline after a finished first read: the list, a search and a thread all read the copy.
  set([
    { account: "vera@example.com", folder: "trash", phase: "live" },
    { account: "vera@example.com", folder: "", phase: "paused", fullSyncDone: 4685, fullSyncTotal: 4685, lastOkAt: 1_700_000_000_000, lastError: "Can't assign requested address (os error 49)" },
  ]);
  check("offline, the list reads the copy", (await localStoreServes("vera@example.com")) === true);
  check("offline, a thread opens from the whole copy", (await localStoreComplete("vera@example.com")) === true);
  check("the mailbox's own row is found even after a folder's", (await localStoreServes("VERA@example.com")) === true);

  // Offline partway through the first read: the list answers, a thread still waits.
  set([{ account: "vera@example.com", folder: "", phase: "paused", fullSyncDone: 600, fullSyncTotal: 1000, lastError: "offline" }]);
  check("offline mid-read, the list reads what is in", (await localStoreServes("vera@example.com")) === true);
  check("offline mid-read, a thread does not trust a half copy", (await localStoreComplete("vera@example.com")) === false);

  // An Exchange mailbox keeps no count, only that a pass went well.
  set([{ account: "kim@uni.example", folder: "", phase: "paused", lastOkAt: 1_700_000_000_000, lastError: "ews:network" }]);
  check("offline Exchange reads the copy", (await localStoreServes("kim@uni.example")) === true);
  check("offline Exchange opens threads from the copy", (await localStoreComplete("kim@uni.example")) === true);

  // Paused before anything was read: nothing on disk, so the provider is asked as before.
  set([{ account: "new@example.com", folder: "", phase: "paused", lastError: "offline" }]);
  check("a mailbox with nothing read yet is not served", (await localStoreServes("new@example.com")) === false);
  check("nor are its threads", (await localStoreComplete("new@example.com")) === false);
});
