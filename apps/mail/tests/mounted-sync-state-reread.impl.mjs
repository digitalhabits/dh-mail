/**
 * The walk itself — see mounted-sync-state-reread.test.mjs.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { useMailSyncStates } from "@/lib/mail/use-sync-states";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ACCOUNT = "ana@kollektiv.example";
let phase = "paused";
window.__TAURI_INTERNALS__ = {
  invoke: async (cmd, args) => {
    if (cmd === "mail_store_call" && args?.op === "sync.list") {
      return [{ account: ACCOUNT, folder: "", phase, lastError: phase === "paused" ? "token refresh failed (401)" : null }];
    }
    return null;
  },
};

let seen = [];
function Probe() {
  seen = useMailSyncStates();
  return null;
}

async function main() {
  try {
    document.body.innerHTML = '<div id="r"></div>';
    const root = createRoot(document.getElementById("r"));
    root.render(React.createElement(Probe));
    await sleep(300);
    assert.equal(seen[0]?.phase, "paused", JSON.stringify(seen));

    // Signed in again: the store says live, and nothing told the window.
    phase = "live";
    window.dispatchEvent(new window.Event("focus"));
    await sleep(300);
    assert.equal(seen[0]?.phase, "live", JSON.stringify(seen));
    pass("back in the window, the states are read again, and a mended mailbox is no longer paused");

    root.unmount();
    process.exit(0);
  } catch (err) {
    console.error("the sync-state walk failed:", err);
    process.exit(1);
  }
}

void main();
