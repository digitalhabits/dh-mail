/**
 * The walk itself — see mounted-recipient-field.test.mjs. Fixtures
 * invented, as every fixture here must be.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { setMailApiTransport } from "@/lib/mail/api";
import { RecipientField } from "@/components/mail/RecipientField";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const OWN = "ulla@aavang.example";
const CONTACTS = [
  { email: "asta@holm.example", name: "Asta Holm", recordName: "", source: "google" },
  { email: "asger@holm.example", name: "Asger Holm", recordName: "", source: "history" },
  { email: "aase@holm.example", name: "Aase Holm", recordName: "", source: "google" },
  { email: "otto@berg.example", name: "Otto Berg", recordName: "", source: "google" },
];
const LISTS = [
  {
    id: "l1",
    name: "Choir altos",
    updatedAt: "2026-03-01T10:00:00Z",
    members: [
      { email: "merle@alto.example", name: "Merle Alto" },
      { email: "tea@aavang.example", name: "Tea Aavang" },
    ],
  },
];

let contactsServed = false;
setMailApiTransport(async (path) => {
  const json = (b) => new Response(JSON.stringify(b), { status: 200 });
  const p = path.split("?")[0];
  if (p === "/api/mail/contacts") {
    contactsServed = true;
    return json({ contacts: CONTACTS, sources: [] });
  }
  if (p === "/api/mail/contact-lists") return json({ lists: LISTS });
  if (p === "/api/mail/contact-sources/sync") return json({ skipped: true });
  return json({});
});

let values = [];
let root;
function Field() {
  const [v, setV] = React.useState([]);
  values = v;
  return React.createElement(RecipientField, {
    label: "To",
    values: v,
    onChange: setV,
    placeholder: "To",
    allowSaveList: true,
    ownAccounts: [OWN],
  });
}

const input = () => document.querySelector("input[role=combobox]");
const options = () => [...document.querySelectorAll("[role=option]")];
const typeInto = (value) => {
  const el = input();
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, value);
  el.dispatchEvent(new window.Event("input", { bubbles: true }));
};
const key = (k) =>
  input().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
const emails = () => values.map((r) => (r.kind === "list" ? `list:${r.name}` : r.email));
const act = async (fn, ms = 60) => {
  fn();
  await sleep(ms);
};

async function main() {
  try {
    document.body.innerHTML = '<div id="r"></div>';
    root = createRoot(document.getElementById("r"));
    root.render(React.createElement(Field));
    await sleep(100);
    input().focus();
    await sleep(50);

    await act(() => typeInto("ulla"));
    assert(options().some((o) => (o.textContent || "").includes(OWN)), "your own mailbox is offered");
    await act(() => typeInto(""));
    pass("your own mailbox is suggested");

    await act(() => typeInto("otto@berg.example,"));
    assert.deepEqual(emails(), ["otto@berg.example"]);
    assert.equal(input().value, "", "the box is empty again");
    pass("a typed address and a comma make a chip");

    await act(() => typeInto("new@person.example"));
    await act(() => key("Enter"));
    assert.deepEqual(emails(), ["otto@berg.example", "new@person.example"]);
    pass("a typed address and Enter make a chip");

    await sleep(200);
    assert(contactsServed, "the contacts were read");
    await act(() => typeInto("asta"));
    assert((options()[0]?.textContent || "").includes("Asta Holm"), `Asta comes first: ${options().map((o) => o.textContent).join(" | ")}`);
    await act(() => key("Enter"));
    const asta = values.find((r) => r.email === "asta@holm.example");
    assert(asta, "Asta is on the message");
    assert.equal(asta.name, "Asta Holm", "with her name");
    pass("a name typed finds the contact, and Enter takes it with its name");

    await act(() => typeInto("asta"));
    assert(
      !options().some((o) => (o.textContent || "").includes("asta@holm.example")),
      "Asta is not offered twice"
    );
    await act(() => typeInto(""));
    pass("a contact already on the message is not offered again");

    await act(() => typeInto("holm"));
    assert(options().length >= 2, "two Holms are left to choose from");
    const first = options()[0]?.textContent || "";
    await act(() => key("ArrowDown"));
    await act(() => key("Enter"));
    const taken = values[values.length - 1];
    assert(taken && !first.includes(taken.email), `ArrowDown took the second: first was ${first}, took ${taken?.email}`);
    pass("the arrow keys move down the suggestions");

    await act(() => typeInto("choir"));
    assert(options().some((o) => (o.textContent || "").includes("Choir altos")), "the list is offered");
    await act(() => key("Enter"));
    const list = values.find((r) => r.kind === "list");
    assert(list && list.name === "Choir altos", "the list is one chip");
    assert.deepEqual(list.members.map((m) => m.email), ["merle@alto.example", "tea@aavang.example"]);
    pass("a list's name finds the list, and it becomes one chip with its people");

    const before = values.length;
    const paste = new window.Event("paste", { bubbles: true, cancelable: true });
    paste.clipboardData = { getData: () => "kaj@one.example, lis@two.example" };
    await act(() => input().dispatchEvent(paste));
    assert.equal(values.length, before + 2, `two chips from the paste: ${emails()}`);
    assert.deepEqual(emails().slice(-2), ["kaj@one.example", "lis@two.example"]);
    pass("a pasted run of addresses becomes chips at once");

    await act(() => key("Backspace"));
    assert.equal(values.length, before + 1, "Backspace took one");
    assert(!emails().includes("lis@two.example"), "the last one");
    const remove = [...document.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Remove Otto Berg" || b.getAttribute("aria-label") === "Remove otto@berg.example"
    );
    assert(remove, "Otto's chip has its own remove button");
    await act(() => remove.click());
    assert(!emails().includes("otto@berg.example"), "and it took Otto");
    pass("Backspace takes the last chip; a chip's own button takes that chip");

    assert(
      [...document.querySelectorAll("button")].some((b) => /Save as list/i.test(b.textContent || "")),
      "Save as list is offered for several people"
    );
    pass("two people or more offer Save as list");

    root.unmount();
    process.exit(0);
  } catch (err) {
    console.error("the address field walk failed:", err);
    console.error("chips:", JSON.stringify(emails()));
    process.exit(1);
  }
}

void main();
