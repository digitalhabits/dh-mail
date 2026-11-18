/**
 * The walk itself — see mounted-signature-editor-stays.test.mjs. The people
 * here are invented.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { SignatureDialog } from "@/components/mail/SignatureDialog";
import { setMailApiTransport } from "@/lib/mail/api";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const IDA = "ida.holm@aavang.example";
const IDA_HOME = "ida@home.example";

let reads = 0;
setMailApiTransport(async (path) => {
  if (path.startsWith("/api/mail/signature")) {
    reads += 1;
    const signature = path.includes(encodeURIComponent(IDA)) ? "<p>Ida Holm</p>" : "";
    return new Response(JSON.stringify({ signature, includeOnNew: true, onReplies: "first" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
});

const host = document.createElement("div");
document.body.appendChild(host);
const root = createRoot(host);
/** A new list at each render, as the page gives it after a sync. */
const show = (open) =>
  root.render(
    React.createElement(SignatureDialog, {
      open,
      accounts: [IDA, IDA_HOME],
      onClose: () => {},
      onSaved: () => {},
    })
  );
const text = () => document.body.textContent ?? "";
const button = (label) =>
  [...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);

async function walk() {
  show(true);
  await sleep(50);
  assert.ok(text().includes("Signatures"), "the list of signatures shows");
  assert.ok(button("Edit"), "an address has Edit");

  button("Edit").click();
  await sleep(50);
  assert.ok(button("Save"), "Edit opens the editor");
  pass("Edit opens the editor");

  const before = reads;
  show(true);
  await sleep(50);
  show(true);
  await sleep(50);
  assert.ok(button("Save"), "the editor is still open after a new list with the same addresses");
  assert.ok(!text().includes("Signatures"), "the list did not come back");
  assert.equal(reads, before, "the same addresses are not read again");
  pass("a new list with the same addresses leaves the editor open");

  show(false);
  await sleep(20);
  show(true);
  await sleep(50);
  assert.ok(!button("Save") && text().includes("Signatures"), "a dialog that opens again starts at the list");
  pass("a dialog that opens again starts at the list");

  root.unmount();
  process.exit(0);
}

walk().catch((err) => {
  console.error(err);
  process.exit(1);
});
