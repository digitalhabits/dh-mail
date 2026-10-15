/**
 * The store's action queue (`actions.*`), faked as the Rust store keeps it:
 * in order, oldest first; a transient failure not counted; given up after
 * five counted tries. For the suites that fake the store at the shell.
 *
 * `call(op, args)` answers an `actions.*` store call and is undefined for
 * any other op, so a suite's own store switch can start with it. `store` is
 * the same as a `MailActionQueueStore`, for a suite that sets its own store.
 * With `apply` (Outlook's way) the real store changes the copy; here the
 * suite gives `onApply`, or nothing changes. Without it (Exchange's way)
 * the caller's `rows` are written with the action: the suite's `onRows`.
 * `cancel` and `doneRenaming` do what the Rust store does, in one step.
 */

export const MAX_ATTEMPTS = 5;

export function fakeActionQueue({ onApply, onRestore, onReplay, onRows } = {}) {
  let next = 1;
  const rows = [];
  const restored = [];
  const cancelled = [];
  const copy = (r) => JSON.parse(JSON.stringify(r));

  const store = {
    async enqueue({ account, threadId, kind, payload = {}, apply = true, rows: written = null }) {
      const row = { id: next++, account, threadId, kind, payload: copy(payload), attempts: 0, lastError: null, apply };
      rows.push(row);
      if (apply) await onApply?.(row);
      else if (written?.length) await onRows?.(account, copy(written));
      return row.id;
    },
    async pending(account) {
      return rows.filter((r) => r.account === account).map(({ apply: _apply, ...r }) => copy(r));
    },
    async done(id) {
      const at = rows.findIndex((r) => r.id === id);
      if (at >= 0) rows.splice(at, 1);
    },
    async failed(id, error, transient) {
      const row = rows.find((r) => r.id === id);
      if (!row) return { givenUp: false };
      row.lastError = error;
      if (transient) return { givenUp: false };
      row.attempts += 1;
      if (row.attempts < MAX_ATTEMPTS) return { givenUp: false };
      await store.done(id);
      return { givenUp: true };
    },
    async doneRenaming(id, newIds) {
      const at = rows.findIndex((r) => r.id === id);
      if (at < 0) return;
      const [done] = rows.splice(at, 1);
      for (const later of rows) {
        if (later.account !== done.account || later.id < id) continue;
        const p = later.payload;
        if (Array.isArray(p.ids)) p.ids = p.ids.map((x) => newIds[x] ?? x);
        if (p.before) p.before = Object.fromEntries(Object.entries(p.before).map(([k, v]) => [newIds[k] ?? k, v]));
      }
    },
    async cancel(id) {
      const at = rows.findIndex((r) => r.id === id);
      if (at < 0) return false;
      const [gone] = rows.splice(at, 1);
      cancelled.push(gone);
      if (gone.payload.before) {
        restored.push({ account: gone.account, before: copy(gone.payload.before) });
        await onRestore?.(gone.account, gone.payload.before);
      }
      return true;
    },
    async replay(account) {
      const mine = rows.filter((r) => r.account === account);
      for (const row of mine) await onReplay?.(row);
      return mine.length;
    },
    async restore(account, before) {
      restored.push({ account, before: copy(before) });
      await onRestore?.(account, before);
    },
  };

  async function call(op, args) {
    switch (op) {
      case "actions.enqueue":
        return store.enqueue(args);
      case "actions.pending":
        return store.pending(args.account);
      case "actions.done":
        return store.done(args.id);
      case "actions.failed":
        return store.failed(args.id, args.error, args.transient);
      case "actions.doneRenaming":
        return store.doneRenaming(args.id, args.newIds);
      case "actions.cancel":
        return store.cancel(args.id);
      case "actions.replay":
        return store.replay(args.account);
      case "actions.restore":
        return store.restore(args.account, args.before);
      default:
        return undefined;
    }
  }

  return { rows, restored, cancelled, store, call, isQueueOp: (op) => op.startsWith("actions.") };
}
