/**
 * The walk itself — see mounted-exchange-server-search.test.mjs.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { setMailApiTransport } from "@/lib/mail/api";
import { ExchangeConnectForm } from "@/components/mail/ExchangeConnectForm";
import { fillServer, needsSearch } from "@/lib/mail/exchange-autodiscover";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const act = async (fn, ms = 120) => {
  fn();
  await sleep(ms);
};

const FOUND = "https://mail.example.com/EWS/Exchange.asmx";
const calls = [];
/** What the next autodiscover answers: a Discovery, or an error text. */
let answers = [];
window.__TAURI_INTERNALS__ = {
  invoke: async (cmd, args) => {
    if (cmd === "mail_store_call") return args.op === "accounts.exists" ? false : null;
    calls.push({ cmd, args });
    if (cmd === "mail_ews_autodiscover") {
      const next = answers.shift() ?? { url: null, source: null, ask: null };
      if (typeof next === "string") throw new Error(next);
      return next;
    }
    if (cmd === "mail_ews_connect") return { displayName: "Inbox", totalCount: 1, unreadCount: 0, childFolderCount: 0 };
    return null;
  },
};
setMailApiTransport(async () => new Response(JSON.stringify({ accounts: [] }), { status: 200 }));
globalThis.fetch = async () => new Response(null, { status: 204 });

const text = () => document.body.textContent || "";
function input(label) {
  const l = [...document.querySelectorAll("label")].find((x) => (x.textContent || "").startsWith(label));
  assert(l, `no field ${label}`);
  return l.querySelector("input");
}
function type(el, value) {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  set.call(el, value);
  el.dispatchEvent(new window.Event("input", { bubbles: true }));
}
const button = (name) => [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === name);
const submit = () => document.querySelector("form").requestSubmit();
const ews = (cmd) => calls.filter((c) => c.cmd === cmd);

/** A new form, past the access code, with these fields typed. */
async function openForm(email, password = "correct horse") {
  document.body.innerHTML = '<div id="r"></div>';
  const root = createRoot(document.getElementById("r"));
  await act(() => root.render(React.createElement(ExchangeConnectForm, { request: { done: () => {} }, onClose: () => {} })));
  assert(!text().includes("Server (EWS address)"), "the access code comes first");
  await act(() => type(document.querySelector("input"), "good-code-1"));
  await act(() => submit());
  await act(() => type(input("Email address"), email));
  await act(() => type(input("Username"), "sam"));
  await act(() => type(input("Password"), password));
  return root;
}

async function main() {
  try {
    assert.equal(fillServer("", true, FOUND), FOUND, "an empty field takes what was found");
    assert.equal(fillServer("https://typed.example.com/EWS/Exchange.asmx", true, FOUND), "https://typed.example.com/EWS/Exchange.asmx");
    assert.equal(needsSearch({ email: "@ku.dk", url: "" }), false, "ku.dk is known");
    pass("what the person typed wins, and ku.dk needs no search");

    // The known server depends on the domain alone. The domain is typed with
    // no name before it: the published tree has no address at a real domain.
    let root = await openForm("@sub.ku.dk");
    assert.equal(input("Server").value, "https://mail.ku.dk/EWS/Exchange.asmx");
    assert(!button("Find server"), "no Find server for a known domain");
    // Connect is not pressed: "@sub.ku.dk" is not a whole address, and the
    // field's own check stops the form. needsSearch above says no search.
    assert.equal(ews("mail_ews_autodiscover").length, 0, "no search for ku.dk");
    root.unmount();
    pass("a ku.dk address fills the known server, with no search");

    root = await openForm("sam@example.com");
    assert(!button("Find server"), "no Find server: Connect finds the server");
    assert.equal(document.querySelector("details")?.open, false, "the server field waits under Advanced");
    answers = [{ url: FOUND, source: "example.com", ask: null }];
    const before = ews("mail_ews_connect").length;
    await act(() => submit(), 250);
    const asked = ews("mail_ews_autodiscover").at(-1).args;
    assert.deepEqual([asked.email, asked.username, asked.allowHost], ["sam@example.com", "sam", null]);
    assert.equal(ews("mail_ews_connect").length, before + 1);
    assert.equal(ews("mail_ews_connect").at(-1).args.url, FOUND);
    root.unmount();
    pass("Connect with an empty server field searches first, then connects to what was found");

    root = await openForm("sam@example.com");
    await act(() => type(input("Server"), "https://typed.example.com/EWS/Exchange.asmx"));
    const searches = ews("mail_ews_autodiscover").length;
    await act(() => submit(), 200);
    assert.equal(ews("mail_ews_autodiscover").length, searches, "a typed server is not searched over");
    assert.equal(ews("mail_ews_connect").at(-1).args.url, "https://typed.example.com/EWS/Exchange.asmx");
    root.unmount();
    pass("a server the person typed under Advanced is used as it is");

    root = await openForm("sam@example.com");
    answers = [{ url: null, source: null, ask: "autodiscover.hoster.example.net" }];
    let connects = ews("mail_ews_connect").length;
    await act(() => submit(), 200);
    assert(text().includes("autodiscover.hoster.example.net"), "the form asks about the host");
    assert.equal(ews("mail_ews_connect").length, connects, "and connects nowhere before the answer");
    answers = [{ url: FOUND, source: "http redirect", ask: null }];
    await act(() => button("Yes, send it").click(), 250);
    assert.equal(ews("mail_ews_autodiscover").at(-1).args.allowHost, "autodiscover.hoster.example.net");
    assert.equal(ews("mail_ews_connect").length, connects + 1, "yes goes on to connect");
    assert.equal(ews("mail_ews_connect").at(-1).args.url, FOUND);
    root.unmount();

    root = await openForm("sam@example.com");
    answers = [{ url: null, source: null, ask: "autodiscover.hoster.example.net" }];
    connects = ews("mail_ews_connect").length;
    await act(() => submit(), 200);
    const count = ews("mail_ews_autodiscover").length;
    await act(() => button("No").click());
    assert.equal(ews("mail_ews_autodiscover").length, count, "No asks nothing more");
    assert.equal(ews("mail_ews_connect").length, connects, "and connects nowhere");
    assert(!text().includes("autodiscover.hoster.example.net"));
    root.unmount();
    pass("a host outside the domain is asked about, and only a yes sends the password there and connects");

    root = await openForm("sam@example.com");
    answers = [{ url: null, source: null, ask: null }];
    await act(() => submit(), 200);
    assert(text().includes("Your server was not found"), text());
    assert.equal(document.querySelector("details")?.open, true, "Advanced opens, for the address to be typed");
    answers = ["ews:refused: The server refused the username or password."];
    await act(() => submit(), 200);
    assert(!text().includes("Your server was not found"));
    assert(text().includes("The server refused the password"), text());
    root.unmount();
    pass("nothing found opens Advanced for the address; a refused password says so and stops");

    process.exit(0);
  } catch (err) {
    console.error("the server-search walk failed:", err);
    process.exit(1);
  }
}

void main();
