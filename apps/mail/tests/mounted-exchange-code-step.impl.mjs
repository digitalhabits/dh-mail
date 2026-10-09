/**
 * The walk itself — see mounted-exchange-code-step.test.mjs.
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

const KNOWN = "kim@uni.example.com";
const shellCalls = [];
window.__TAURI_INTERNALS__ = {
  invoke: async (cmd, args) => {
    shellCalls.push(cmd === "mail_store_call" ? `${cmd}:${args.op}` : cmd);
    if (cmd === "mail_store_call" && args.op === "accounts.exists") return args.args.email === KNOWN;
    return null;
  },
};
setMailApiTransport(async () => new Response(JSON.stringify({ accounts: [] }), { status: 200 }));
const codes = [];
globalThis.fetch = async (_url, init) => {
  const { code } = JSON.parse(init.body);
  codes.push(code);
  return new Response(null, { status: code === "good-code-1" ? 204 : 403 });
};

const labels = () => [...document.querySelectorAll("label")].map((l) => l.textContent || "");
const hasField = (name) => labels().some((l) => l.startsWith(name));
const codeInput = () => document.querySelector("input");
function type(input, value) {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  set.call(input, value);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}
const submit = () => document.querySelector("form").requestSubmit();

async function main() {
  try {
    document.body.innerHTML = '<div id="r"></div>';
    const root = createRoot(document.getElementById("r"));
    const request = { done: () => {} };
    await act(() => root.render(React.createElement(ExchangeConnectForm, { request, onClose: () => {} })));
    assert(hasField("Access code"), labels().join(" | "));
    assert(!hasField("Email address") && !hasField("Password"), "no mailbox fields yet");
    pass("a new connect shows the access code, and nothing else");

    await act(() => type(codeInput(), "wrong-code-1"));
    await act(() => submit());
    assert.deepEqual(codes, ["wrong-code-1"]);
    assert(/not right/.test(document.body.textContent || ""), "the form says the code is wrong");
    assert(!hasField("Email address"), "the fields stay hidden");
    assert(!shellCalls.some((c) => c.startsWith("mail_ews_")), shellCalls.join(", "));
    pass("a wrong code keeps the fields hidden, and asks the shell nothing");

    await act(() => type(codeInput(), "good-code-1"));
    await act(() => submit());
    assert(hasField("Email address") && hasField("Password") && hasField("Server"), labels().join(" | "));
    assert(!hasField("Access code"), "the code is not asked again");
    pass("the right code opens the mailbox fields");

    root.unmount();
    document.body.innerHTML = '<div id="r2"></div>';
    const again = createRoot(document.getElementById("r2"));
    await act(() => again.render(React.createElement(ExchangeConnectForm, { request: { email: KNOWN, done: () => {} }, onClose: () => {} })));
    assert(hasField("Password") && !hasField("Access code"), labels().join(" | "));
    assert.equal(codes.length, 2, "no code check for a reconnect");
    pass("a mailbox connected already goes straight to its fields");

    again.unmount();
    process.exit(0);
  } catch (err) {
    console.error("the code-step walk failed:", err);
    process.exit(1);
  }
}

void main();
