/**
 * The walk itself — see mounted-message-files.test.mjs. Fixtures invented,
 * as every fixture here must be.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { setMailApiTransport } from "@/lib/mail/api";
import { MessageAttachmentChips } from "@/components/mail/MailAttachments";
import { AttachmentPreviewDialog } from "@/components/mail/attachment-preview";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ACCOUNT = "ulla@aavang.example";
const FILES = [
  { attachmentId: "a1", filename: "notes.txt", mimeType: "text/plain", size: 512 },
  { attachmentId: "a2", filename: "choir-plan.zip", mimeType: "application/zip", size: Math.round(2.5 * 1024 * 1024) },
  { attachmentId: "a3", filename: "rehearsal.csv", mimeType: "text/csv", size: 40 * 1024 },
];

setMailApiTransport(async () => new Response(new Uint8Array([104, 105]), { status: 200 }));

function Files() {
  const [open, setOpen] = React.useState(null);
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(MessageAttachmentChips, {
      account: ACCOUNT,
      messageId: "m1",
      attachments: FILES,
      onPreview: setOpen,
    }),
    React.createElement(AttachmentPreviewDialog, {
      account: ACCOUNT,
      messageId: "m1",
      attachment: open,
      siblings: FILES,
      onSelect: setOpen,
      onClose: () => setOpen(null),
    })
  );
}

const tile = (name) => document.querySelector(`button[title="${name}"]`);
const dialog = () => document.querySelector("[role=dialog]");
const text = () => document.body.textContent || "";
const press = (k) =>
  window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

async function main() {
  try {
    document.body.innerHTML = '<div id="r"></div>';
    const root = createRoot(document.getElementById("r"));
    root.render(React.createElement(Files));
    await sleep(150);

    for (const [name, size] of [["notes.txt", "512 B"], ["choir-plan.zip", "2.5 MB"], ["rehearsal.csv", "40 KB"]]) {
      assert(tile(name), `${name} has a tile`);
      assert((tile(name).textContent || "").includes(size), `${name} says ${size}: ${tile(name).textContent}`);
    }
    pass("each file has its tile, with its name and its size in words");

    assert([...document.querySelectorAll("button")].some((b) => /Download all/.test(b.textContent || "")), "Download all is offered");
    pass("several files offer Download all");

    assert(!dialog(), "no preview before a click");
    tile("choir-plan.zip").click();
    await sleep(150);
    assert.equal(dialog()?.getAttribute("aria-label"), "choir-plan.zip", "the preview names the file");
    assert(text().includes("2 / 3"), "and says it is the second of three");
    pass("a click on a tile opens its preview, which names the file and where it stands");

    document.querySelector('button[aria-label="Next file"]').click();
    await sleep(150);
    assert.equal(dialog()?.getAttribute("aria-label"), "rehearsal.csv", "Next goes to the third");
    press("ArrowRight");
    await sleep(150);
    assert.equal(dialog()?.getAttribute("aria-label"), "notes.txt", "and round to the first");
    press("ArrowLeft");
    await sleep(150);
    assert.equal(dialog()?.getAttribute("aria-label"), "rehearsal.csv", "ArrowLeft goes back");
    press("Escape");
    await sleep(150);
    assert(!dialog(), "Escape closes the preview");
    pass("Next and the arrow keys step through the files; Escape closes");

    root.unmount();
    process.exit(0);
  } catch (err) {
    console.error("the message files walk failed:", err);
    process.exit(1);
  }
}

void main();
