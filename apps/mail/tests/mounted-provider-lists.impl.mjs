/**
 * The walk itself — see mounted-provider-lists.test.mjs.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { setMailApiTransport } from "@/lib/mail/api";
import {
  forgetMailProviderLists,
  mailProviderFor,
  useIsOutlookAccount,
  useSenderProvider,
} from "@/lib/mail/use-outlook-accounts";

import { waitFor } from "./mounted-dom.mjs";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const act = async (fn, ms = 80) => {
  fn();
  await sleep(ms);
};

const NEW = "dana@uni.example.com";
let exchange = [];
window.__TAURI_INTERNALS__ = { invoke: async () => null };
setMailApiTransport(async (path) => {
  const json = (b) => new Response(JSON.stringify(b), { status: 200 });
  if (path.startsWith("/api/exchange/accounts")) return json({ accounts: exchange.map((email) => ({ email })) });
  if (path.startsWith("/api/outlook/accounts")) return json({ accounts: [{ email: "otto@example.com" }] });
  return json({});
});

function Marks() {
  const isOutlook = useIsOutlookAccount();
  const sender = useSenderProvider(NEW);
  return React.createElement("p", { id: "marks" }, `${mailProviderFor(NEW, isOutlook)} ${sender}`);
}

async function main() {
  try {
    document.body.innerHTML = '<div id="r"></div>';
    const root = createRoot(document.getElementById("r"));
    await act(() => root.render(React.createElement(Marks)));
    const marks = () => document.getElementById("marks").textContent;
    assert.equal(marks(), "gmail gmail", "not connected yet: the default");
    pass("a mailbox the lists do not know is taken for Gmail");

    // The connect: the server now has it as an Exchange mailbox.
    exchange = [NEW];
    forgetMailProviderLists();
    await waitFor(() => marks() === "exchange exchange");
    assert.equal(marks(), "exchange exchange", marks());
    pass("after a connect, the open window knows it as Exchange, with no reload");

    root.unmount();
    process.exit(0);
  } catch (err) {
    console.error("the provider-lists walk failed:", err);
    process.exit(1);
  }
}

void main();
