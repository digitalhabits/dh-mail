import { forgetAccountEverywhere, readCachedList, writeCachedList } from "@/lib/mail/list-cache";
import { listMailPins, pinMailThread, unpinAccount } from "@/lib/mail/pins";
import { check, suite } from "./harness.mjs";

// A removed mailbox's senders and subjects must not stay in the saved lists
// or the pins. Node has no localStorage, so here is one, with key(i) and
// length, which the list cache walks to find every viewer's lists.
const store = new Map();
globalThis.window = {};
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  key: (i) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
};

const row = (account, threadId) => ({
  account,
  threadId,
  subject: `Subject ${threadId}`,
  snippet: "",
  lastAt: 1,
  unread: false,
});

suite(async () => {
  const gone = "ada.lind@uni.example";
  const kept = "ada@home.example";

  writeCachedList("viewer-1", "inbox|", {
    threads: [row(gone, "t1"), row(kept, "t2")],
    nextCursor: null,
  });
  writeCachedList("viewer-1", "archive|", { threads: [row(gone, "t3")], nextCursor: null });
  writeCachedList("viewer-2", "inbox|", { threads: [row("Ada.Lind@uni.example", "t4")], nextCursor: null });

  pinMailThread(row(gone, "t1"));
  pinMailThread(row(kept, "t2"));

  forgetAccountEverywhere(gone);
  unpinAccount(gone);

  const inbox = readCachedList("viewer-1", "inbox|");
  check(
    "the removed mailbox's rows leave the list on screen",
    inbox.threads.map((t) => t.threadId).join() === "t2",
    inbox.threads.map((t) => t.threadId).join()
  );
  check(
    "and every other saved list",
    readCachedList("viewer-1", "archive|").threads.length === 0
  );
  check(
    "for every viewer, whatever the case of the address",
    readCachedList("viewer-2", "inbox|").threads.length === 0
  );
  const saved = Object.values(JSON.parse(store.get([...store.keys()].find((k) => k.endsWith(":viewer-1")))));
  check(
    "the saved copy holds no subject of the removed mailbox",
    !JSON.stringify(saved).includes("Subject t1") && !JSON.stringify(saved).includes("Subject t3")
  );
  check(
    "its pins go, the other mailbox's stay",
    listMailPins().map((p) => p.threadId).join() === "t2",
    listMailPins().map((p) => p.threadId).join()
  );
});
