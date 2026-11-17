/**
 * The two databases that a send handover uses, kept in Maps: the drafts
 * and the handover rows. Node has no IndexedDB. Every other database fails
 * to open, as in the other mounted suites.
 *
 * A transaction says that it is complete on the next turn of the event
 * loop, after the requests in it answered.
 */

function database(rows, keyPath) {
  const request = (result) => {
    const req = { result, onsuccess: null, onerror: null };
    queueMicrotask(() => req.onsuccess?.({ target: req }));
    return req;
  };
  const copy = (value) => (value === undefined ? undefined : structuredClone(value));
  const store = {
    get: (key) => request(copy(rows.get(key))),
    getAll: () => request([...rows.values()].map(copy)),
    put: (value) => request(rows.set(value[keyPath], copy(value))),
    delete: (key) => request(rows.delete(key)),
  };
  return {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => store,
    transaction: () => {
      const tx = { objectStore: () => store, oncomplete: null, onerror: null, onabort: null, error: null, abort: () => {} };
      setTimeout(() => tx.oncomplete?.(), 0);
      return tx;
    },
    close: () => {},
  };
}

export function installStores() {
  const draftRows = new Map();
  const handoverRows = new Map();
  const databases = {
    "redd-plan-mail-drafts": database(draftRows, "key"),
    "dh-mail-send-handover": database(handoverRows, "id"),
  };
  globalThis.indexedDB = {
    open: (name) => {
      const req = { result: databases[name], error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      queueMicrotask(() => {
        if (databases[name]) req.onsuccess?.({ target: req });
        else {
          req.error = new Error("no such database in this suite");
          req.onerror?.({ target: req });
        }
      });
      return req;
    },
  };
  return { draftRows, handoverRows };
}
