/**
 * The walk itself — see mounted-recipient-carry.test.mjs. Fixtures
 * invented, as every fixture here must be.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { setMailApiTransport } from "@/lib/mail/api";
import { RecipientCarryProvider, RecipientField } from "@/components/mail/RecipientField";
import { RecipientDropZone, withRecipient } from "@/components/mail/recipient-carry";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

setMailApiTransport(async (path) => {
  const json = (b) => new Response(JSON.stringify(b), { status: 200 });
  const p = path.split("?")[0];
  if (p === "/api/mail/contacts") return json({ contacts: [], sources: [] });
  if (p === "/api/mail/contact-lists") return json({ lists: [] });
  return json({});
});

const person = (email) => ({ kind: "email", email, name: "" });
const lists = { to: [], cc: [], bcc: [] };
let bccShown = true;

function Fields({ start }) {
  const [to, setTo] = React.useState(start.to);
  const [cc, setCc] = React.useState(start.cc);
  const [bcc, setBcc] = React.useState(start.bcc);
  const [showBcc, setShowBcc] = React.useState(start.showBcc);
  Object.assign(lists, { to, cc, bcc });
  bccShown = showBcc;
  const field = (label, values, onChange) =>
    React.createElement(RecipientField, { key: label, label, values, onChange, placeholder: label });
  return React.createElement(
    RecipientCarryProvider,
    null,
    field("To", to, setTo),
    field("Cc", cc, setCc),
    showBcc
      ? field("Bcc", bcc, setBcc)
      : React.createElement(
          RecipientDropZone,
          {
            onDropRecipient: (r) => {
              setShowBcc(true);
              setBcc(withRecipient(bcc, r));
            },
          },
          React.createElement("button", { type: "button", id: "bcc-button" }, "Bcc")
        )
  );
}

const fieldEl = (i) => document.querySelectorAll("[data-recipient-drop]")[i];
const chip = (email) =>
  [...document.querySelectorAll("[aria-selected]")].find((el) => (el.textContent || "").includes(email));
const emails = (list) => list.map((r) => r.email);
const pointer = (type, target, x, y) =>
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: x,
      clientY: y,
    })
  );

/** Press on the chip, move onto the target, let go there. */
async function carry(email, target) {
  const from = chip(email);
  assert(from, `the chip for ${email} is there`);
  pointer("pointerdown", from, 10, 10);
  await sleep(10);
  pointer("pointermove", target, 40, 40);
  await sleep(10);
  pointer("pointermove", target, 50, 50);
  await sleep(10);
  pointer("pointerup", target, 50, 50);
  await sleep(40);
}

let root;
async function mount(start) {
  root?.unmount();
  document.body.innerHTML = '<div id="r"></div>';
  root = createRoot(document.getElementById("r"));
  root.render(React.createElement(Fields, { start: { showBcc: true, ...start } }));
  await sleep(80);
}

async function main() {
  try {
    await mount({ to: [person("asta@holm.example"), person("otto@berg.example")], cc: [], bcc: [] });

    await carry("asta@holm.example", fieldEl(1));
    assert.deepEqual(emails(lists.to), ["otto@berg.example"]);
    assert.deepEqual(emails(lists.cc), ["asta@holm.example"]);
    pass("a chip carried from To to Cc moves there");

    await carry("asta@holm.example", fieldEl(2));
    assert.deepEqual(emails(lists.cc), []);
    assert.deepEqual(emails(lists.bcc), ["asta@holm.example"]);
    pass("a chip carried from Cc to Bcc moves there");

    await carry("asta@holm.example", fieldEl(0));
    assert.deepEqual(emails(lists.bcc), []);
    assert.deepEqual(emails(lists.to), ["otto@berg.example", "asta@holm.example"]);
    pass("a chip carried from Bcc to To moves there");

    await carry("otto@berg.example", fieldEl(0));
    assert.deepEqual(emails(lists.to), ["otto@berg.example", "asta@holm.example"]);
    pass("a chip let go over its own field stays put");

    await mount({
      to: [person("asta@holm.example")],
      cc: [person("Asta@Holm.example"), person("otto@berg.example")],
      bcc: [],
    });
    await carry("Asta@Holm.example", fieldEl(0));
    assert.deepEqual(emails(lists.to), ["asta@holm.example"], "To is not given her twice");
    assert.deepEqual(emails(lists.cc), ["otto@berg.example"], "she has left Cc");
    pass("a chip dropped on a field that has the address already only leaves where it was");

    const from = chip("otto@berg.example");
    pointer("pointerdown", from, 10, 10);
    pointer("pointerup", fieldEl(0), 11, 11);
    await sleep(40);
    assert.deepEqual(emails(lists.cc), ["otto@berg.example"]);
    assert.deepEqual(emails(lists.to), ["asta@holm.example"]);
    pass("a press without a move carries nothing");

    pointer("pointerdown", chip("otto@berg.example"), 10, 10);
    pointer("pointermove", fieldEl(0), 60, 60);
    await sleep(10);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    pointer("pointerup", fieldEl(0), 60, 60);
    await sleep(40);
    assert.deepEqual(emails(lists.cc), ["otto@berg.example"]);
    assert.equal(document.body.style.cursor, "", "the page's cursor is given back");
    pass("Escape puts a carried chip back");

    await mount({ to: [person("asta@holm.example")], cc: [], bcc: [], showBcc: false });
    assert(!bccShown);
    await carry("asta@holm.example", document.getElementById("bcc-button"));
    assert(bccShown, "the Bcc row is shown");
    assert.deepEqual(emails(lists.to), []);
    assert.deepEqual(emails(lists.bcc), ["asta@holm.example"]);
    pass("a chip dropped on the Bcc button lands in Bcc");

    root.unmount();
    process.exit(0);
  } catch (err) {
    console.error("the carry walk failed:", err);
    console.error("fields:", JSON.stringify({ to: emails(lists.to), cc: emails(lists.cc), bcc: emails(lists.bcc) }));
    process.exit(1);
  }
}

void main();
