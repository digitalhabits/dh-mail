/**
 * The copy a handover leaves behind.
 *
 * Sending happens in Outlook, usually in a mailbox this app holds no token
 * for — that is what the handover is for — so nothing here can know the
 * message went. What it can know is that the words were handed over, and
 * on what day, which is enough for a list of drafts to tell a letter
 * nobody finished from one that left by another door.
 *
 * What is checked is the record: the mark goes on, the sweep finds exactly
 * the marked ones, and a draft nobody handed over is left alone.
 */

import {
  deleteDraft,
  getDraft,
  listHandedOverDraftKeys,
  markDraftHandedOver,
  setDraft,
} from "@/lib/mail/local-drafts";

import { check, suite } from "./harness.mjs";

/** An IndexedDB of one object store, kept in a Map. */
function fakeIndexedDb() {
  const rows = new Map();
  const request = (result) => {
    const req = { result, onsuccess: null, onerror: null };
    queueMicrotask(() => req.onsuccess?.({ target: req }));
    return req;
  };
  const store = {
    get: (key) => request(rows.get(key) ?? undefined),
    getAll: () => request([...rows.values()]),
    put: (value) => request(rows.set(value.key, value)),
    delete: (key) => request(rows.delete(key)),
  };
  globalThis.indexedDB = {
    open: () => {
      const req = {
        result: {
          objectStoreNames: { contains: () => true },
          createObjectStore: () => store,
          transaction: () => ({ objectStore: () => store }),
          close: () => {},
        },
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      queueMicrotask(() => req.onsuccess?.({ target: req }));
      return req;
    },
  };
  return rows;
}

const compose = (key, subject) => ({
  key,
  kind: "compose",
  from: "vera@example.org",
  subject,
  body: "<p>words</p>",
  toList: [],
  ccList: [],
  bccList: [],
  showCc: false,
  showBcc: false,
  includeSignature: true,
  attachments: [],
  updatedAt: Date.now(),
});

suite(async () => {
  const rows = fakeIndexedDb();
  globalThis.window = { localStorage: { getItem: () => null, setItem: () => {} } };

  await setDraft(compose("compose:a", "Handed over"));
  await setDraft(compose("compose:b", "Still being written"));

  await markDraftHandedOver("compose:a", "vera@example.org");
  const marked = await getDraft("compose:a");
  check(
    "the draft records that it went to Outlook, and from which address",
    marked?.handedOver?.account === "vera@example.org" &&
      typeof marked?.handedOver?.at === "number",
    JSON.stringify(marked?.handedOver)
  );
  check(
    "and it says nothing about having been sent, which nobody here knows",
    !("sent" in (marked?.handedOver ?? {}))
  );

  const untouched = await getDraft("compose:b");
  check("a draft nobody handed over is not marked", !untouched?.handedOver);

  const keys = await listHandedOverDraftKeys();
  check(
    "the sweep finds the handed-over one and only it",
    keys.join() === "compose:a",
    keys.join()
  );

  for (const key of keys) await deleteDraft(key);
  check("and discarding them leaves the one still being written", rows.size === 1);
  check(
    "which is the right one",
    [...rows.keys()].join() === "compose:b",
    [...rows.keys()].join()
  );

  await markDraftHandedOver("compose:gone", "vera@example.org");
  check(
    "a handover from a composer that has saved nothing records nothing",
    rows.size === 1
  );
});
