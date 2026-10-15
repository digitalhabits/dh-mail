/**
 * Back online, every mailbox's worker looks at once, and so sends what the
 * reader did offline. A worker that failed while the network was gone was
 * otherwise left to wait out its back-off, up to five minutes.
 */

import { startLocalStoreSync, stopLocalStoreSync, wakeEverySyncWhenOnline } from "../src/local-store";

import { check, suite } from "./harness.mjs";

const commands = [];
globalThis.window = {
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
  __TAURI__: {
    core: {
      invoke: async (cmd, args) => {
        commands.push({ cmd, ...args });
        if (cmd === "mail_sync_start") return args.accounts;
        return null;
      },
    },
  },
};

/** A window of its own, to fire "online" on. */
function target() {
  const listeners = new Map();
  return {
    addEventListener: (name, fn) => listeners.set(name, [...(listeners.get(name) ?? []), fn]),
    removeEventListener: (name, fn) => listeners.set(name, (listeners.get(name) ?? []).filter((f) => f !== fn)),
    fire: (name) => (listeners.get(name) ?? []).forEach((fn) => fn()),
    count: (name) => (listeners.get(name) ?? []).length,
  };
}

const wakes = () => commands.filter((c) => c.cmd === "mail_sync_wake").map((c) => c.account).sort().join(",");

suite(async () => {
  await startLocalStoreSync([
    { email: "Vera@gmail.example", provider: "gmail", inMailTab: true },
    { email: "ann@gmail.example", provider: "gmail", inMailTab: true },
  ]);
  const win = target();
  const stop = wakeEverySyncWhenOnline(win);
  check("nothing is woken before the network comes back", wakes() === "");
  win.fire("online");
  await new Promise((r) => setTimeout(r, 0));
  check("back online, every Gmail worker is woken", wakes() === "ann@gmail.example,vera@gmail.example", wakes());

  commands.length = 0;
  await stopLocalStoreSync("ann@gmail.example");
  win.fire("online");
  await new Promise((r) => setTimeout(r, 0));
  check("a removed mailbox is not", wakes() === "vera@gmail.example", wakes());

  stop();
  check("and the listener can be taken off", win.count("online") === 0);
});
