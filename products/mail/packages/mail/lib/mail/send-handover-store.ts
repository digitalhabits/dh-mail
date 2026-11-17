/*
 * The rows of send-handover.ts, in IndexedDB.
 *
 * All windows of the app share one IndexedDB, and a read-write transaction
 * on one store does not run at the same time as another one, in this window
 * or in a different one. So `update` reads and writes in one transaction,
 * with no wait between the two, and it is the atomic step that the
 * handover needs.
 *
 * A database of its own, not the drafts database: a handover is not a
 * draft, and the Drafts list reads every row of that store. A message with
 * files is too large for localStorage or for an event between windows.
 */

import type { SendHandoverRow, SendHandoverRows } from "@/lib/mail/send-handover";

const DB_NAME = "dh-mail-send-handover";
const DB_VERSION = 1;
const STORE = "handovers";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Couldn't open the handover database"));
    req.onblocked = () => reject(new Error("The handover database is blocked"));
  });
}

/** Resolves when the transaction is kept, and rejects when it is not. */
function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export function idbHandoverRows<P>(): SendHandoverRows<P> {
  return {
    async update(id, change) {
      const db = await openDb();
      try {
        const tx = db.transaction(STORE, "readwrite");
        const done = txDone(tx);
        const store = tx.objectStore(STORE);
        const get = store.get(id) as IDBRequest<SendHandoverRow<P> | undefined>;
        // The write is asked for in the read's own callback, so the
        // transaction stays open from the read to the write.
        get.onsuccess = () => {
          try {
            const next = change(get.result ?? null);
            if (next) store.put(next);
          } catch {
            tx.abort();
          }
        };
        await done;
      } finally {
        db.close();
      }
    },
    async read(id) {
      const db = await openDb();
      try {
        const tx = db.transaction(STORE, "readonly");
        const get = tx.objectStore(STORE).get(id) as IDBRequest<SendHandoverRow<P> | undefined>;
        await txDone(tx);
        return get.result ?? null;
      } finally {
        db.close();
      }
    },
    async prune(before) {
      const db = await openDb();
      try {
        const tx = db.transaction(STORE, "readwrite");
        const done = txDone(tx);
        const store = tx.objectStore(STORE);
        const all = store.getAll() as IDBRequest<SendHandoverRow<P>[]>;
        all.onsuccess = () => {
          for (const row of all.result ?? []) {
            if (!row || typeof row.id !== "string") continue;
            if (typeof row.at !== "number" || row.at < before) store.delete(row.id);
          }
        };
        await done;
      } finally {
        db.close();
      }
    },
  };
}
