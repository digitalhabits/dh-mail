/**
 * The walk itself — see mounted-offline-line.test.mjs.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { OfflineLine } from "@/components/mail/OfflineLine";
import { useMailT } from "@/lib/mail/i18n";
import { useOffline } from "@/lib/mail/use-offline";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ANA = "ana@kollektiv.example";
const BO = "bo@kollektiv.example";
let browserOnline = true;
Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => browserOnline });

let states = [];
let queued = { [ANA]: 0, [BO]: 0 };
const queue = (account, n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, account, threadId: `t${i}`, kind: "archive", payload: {}, attempts: 0, lastError: null }));
window.__TAURI_INTERNALS__ = {
  invoke: async (cmd, args) => {
    if (cmd !== "mail_store_call") return null;
    if (args?.op === "sync.list") return states;
    if (args?.op === "actions.pending") return queue(args.args.account, queued[args.args.account] ?? 0);
    return null;
  },
};

function Probe() {
  const t = useMailT();
  const { offline, waiting } = useOffline();
  return React.createElement(OfflineLine, { offline, waiting, t });
}

const text = () => document.querySelector("[data-offline-line]")?.textContent ?? "";
const fire = (name) => window.dispatchEvent(new window.Event(name));

async function main() {
  try {
    states = [
      { account: ANA, folder: "", phase: "live" },
      { account: BO, folder: "", phase: "live" },
    ];
    document.body.innerHTML = '<div id="r"></div>';
    const root = createRoot(document.getElementById("r"));
    root.render(React.createElement(Probe));
    await sleep(300);
    assert.equal(text(), "", "online: no line");
    pass("online, there is no offline line");

    // The network goes, and the reader archives three things meanwhile.
    browserOnline = false;
    queued = { [ANA]: 2, [BO]: 1 };
    fire("offline");
    await sleep(300);
    assert.match(text(), /You are offline/);
    assert.match(text(), /Mail keeps what you do and sends it when you are online again\./);
    assert.match(text(), /3 changes wait to be sent\./, text());
    assert.equal(document.querySelectorAll("[data-offline-line]").length, 1, "one line, not one per mailbox");
    pass("offline, one line says so, that actions are kept, and that 3 changes wait");

    queued = { [ANA]: 1, [BO]: 0 };
    fire("redd-mail-sync-changed");
    await sleep(300);
    assert.match(text(), /1 change waits to be sent\./, text());
    pass("the count follows the queue, and says one change in the singular");

    // A network that reaches no mail server: the browser says online.
    browserOnline = true;
    states = states.map((s) => ({ ...s, phase: "paused", lastError: "ews:network: Could not reach the server." }));
    fire("online");
    await sleep(300);
    assert.match(text(), /Mail cannot reach your mail servers/, text());
    pass("with a network that reaches no mail server, the line says that instead");

    // Only one mailbox stopped: that mailbox's own line says so, not this one.
    states = [{ account: ANA, folder: "", phase: "paused", lastError: "ews:network: no" }, { account: BO, folder: "", phase: "live" }];
    queued = { [ANA]: 0, [BO]: 0 };
    fire("focus");
    await sleep(300);
    assert.equal(text(), "", text());
    pass("back online with one mailbox reachable, the line goes");

    root.unmount();
    process.exit(0);
  } catch (err) {
    console.error("the offline-line walk failed:", err);
    process.exit(1);
  }
}

void main();
