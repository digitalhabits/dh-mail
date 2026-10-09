/**
 * The walk itself — see mounted-exchange-no-gate.test.mjs.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { setMailApiTransport } from "@/lib/mail/api";
import { ExchangeConnectForm } from "@/components/mail/ExchangeConnectForm";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const act = async (fn, ms = 80) => {
  fn();
  await sleep(ms);
};

window.__TAURI_INTERNALS__ = { invoke: async () => null };
setMailApiTransport(async () => new Response(JSON.stringify({ accounts: [] }), { status: 200 }));
/** Every request the page makes on its own. There must be none. */
const fetched = [];
globalThis.fetch = async (url) => {
  fetched.push(String(url));
  return new Response(null, { status: 404 });
};

const labels = () => [...document.querySelectorAll("label")].map((l) => l.textContent || "");
const hasField = (name) => labels().some((l) => l.startsWith(name));

async function main() {
  try {
    document.body.innerHTML = '<div id="r"></div>';
    const root = createRoot(document.getElementById("r"));
    await act(() => root.render(React.createElement(ExchangeConnectForm, { request: { done: () => {} }, onClose: () => {} })));
    assert(hasField("Email address") && hasField("Username") && hasField("Password"), labels().join(" | "));
    assert(!/access code/i.test(document.body.textContent || ""), "no access code is asked for");
    assert.deepEqual(fetched, [], "and no server is asked about the connect");
    pass("a new connect opens on the mailbox fields, with no access code and no other server");

    root.unmount();
    process.exit(0);
  } catch (err) {
    console.error("the no-gate walk failed:", err);
    process.exit(1);
  }
}

void main();
