import {
  personOfOpenThread,
  isMailPersonPinned,
  listMailPersonPins,
  orderByPersonPin,
  toggleMailPersonPin,
} from "@/lib/mail/person-pins";
import { check, suite } from "./harness.mjs";

// The store reads localStorage on first use and keeps a cached snapshot, the
// way useSyncExternalStore needs. Node has neither, so here is one.
const store = new Map();
globalThis.window = {};
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, v),
  removeItem: (k) => store.delete(k),
};

const rows = (...keys) => keys.map((key) => ({ key }));
const order = (rs) => orderByPersonPin(rs).map((r) => r.key);

suite(async () => {
  const A = "person:a@x.com";
  const B = "person:b@x.com";
  const G = "group:a@x.com,b@x.com";

  check("nothing is pinned to begin with", listMailPersonPins().length === 0);
  check(
    "an unpinned list keeps the order it came in",
    order(rows(A, B, G)).join() === [A, B, G].join()
  );

  // ---- Pinning ------------------------------------------------------------
  check("pinning answers that it is pinned now", toggleMailPersonPin(B) === true);
  check("and it reads back as pinned", isMailPersonPinned(B));
  check("while the others do not", !isMailPersonPinned(A));
  check(
    "a pinned person moves to the top",
    order(rows(A, B, G)).join() === [B, A, G].join(),
    order(rows(A, B, G)).join()
  );

  // Pinning a second one puts it above the first: most recent first, which is
  // what the thread pins do.
  toggleMailPersonPin(G);
  check(
    "the newest pin sits above the older one",
    order(rows(A, B, G)).join() === [G, B, A].join(),
    order(rows(A, B, G)).join()
  );

  // ---- The point of pinning ------------------------------------------------
  // A pinned person with nothing recent still belongs at the top. Falling back
  // to sorting by time would undo the pin exactly when it is most useful.
  check(
    "the unpinned rest keep their own order underneath",
    order(rows(A, "person:c@x.com", B, G)).join() ===
      [G, B, A, "person:c@x.com"].join(),
    order(rows(A, "person:c@x.com", B, G)).join()
  );

  // ---- Unpinning -----------------------------------------------------------
  check("unpinning answers that it is not", toggleMailPersonPin(B) === false);
  check("and it stops being pinned", !isMailPersonPinned(B));
  check(
    "so it drops back among the rest",
    order(rows(A, B, G)).join() === [G, A, B].join(),
    order(rows(A, B, G)).join()
  );

  // ---- Rows that are not on screen ----------------------------------------
  // Someone can be pinned and then have no mail in the current folder. That
  // must not conjure a row, and must not drop the rows there are.
  check(
    "a pin with no row is simply not shown",
    order(rows(A)).join() === [A].join()
  );

  // ---- Surviving a reload --------------------------------------------------
  check(
    "the pin is written down, not just remembered",
    JSON.parse(store.get("redd-plan-mail-person-pins-v1")).some(
      (p) => p.key === G
    )
  );

  // ---- Pinning from the open conversation --------------------------------
  // In the people view the reader's Pin and the P key pin a person: the one
  // opened, or else the one whose row holds the conversation.
  const vera = { key: "person:vera@example.com", threads: [{ account: "me@example.com", threadId: "t1" }] };
  const otto = { key: "person:otto@example.com", threads: [{ account: "me@example.com", threadId: "t2" }] };
  check(
    "the conversation's person is found by its row",
    personOfOpenThread([vera, otto], null, { account: "ME@example.com", threadId: "t2" }) === otto
  );
  check(
    "the person the reader opened comes first",
    personOfOpenThread([vera, otto], vera, { account: "me@example.com", threadId: "t2" }) === vera
  );
  check(
    "a conversation nobody's row holds has no person",
    personOfOpenThread([vera, otto], null, { account: "me@example.com", threadId: "t9" }) === null
  );

  // ---- A broken store ------------------------------------------------------
  // localStorage is shared with everything else on the origin, and can hold
  // anything. A crash here would take the whole mail list with it.
  store.set("redd-plan-mail-person-pins-v1", "not json");
  const { listMailPersonPins: freshList } = await import(
    "@/lib/mail/person-pins?reload=1"
  );
  check("nonsense in storage reads as no pins", freshList().length === 0);
});
