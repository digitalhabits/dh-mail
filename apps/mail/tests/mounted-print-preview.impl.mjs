/**
 * The walk itself — see mounted-print-preview.test.mjs.
 *
 * happy-dom has no print panel and is not the desktop app, so the print
 * goes to the frame a browser prints from. What is checked is what lands
 * in that frame, and that the thread's own keys never hear the ⌘P.
 */

import * as React from "react";
import { createRoot } from "react-dom/client";

import { DraftAttachmentPreviewDialog } from "@/components/mail/attachment-preview";
import { buildFilePrintDocument } from "@/components/mail/print-attachment";

import { check, suite } from "./harness.mjs";
import { toastSink } from "./shims/sonner.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A one-pixel PNG, made up here.
const PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const ITEMS = [
  { id: "pic", filename: "boarding-pass.png", mimeType: "image/png", size: 68, contentBase64: PIXEL },
  { id: "txt", filename: "notes.txt", mimeType: "text/plain", size: 5, contentBase64: "aGVsbG8=" },
];

const pressPrint = () =>
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "p", metaKey: true, bubbles: true, cancelable: true }));

suite(async () => {
  const toasts = [];
  toastSink.push = (t) => toasts.push(t);
  const doc = buildFilePrintDocument('Ticket "A" <1>', ["data:image/png;base64,AAA", "https://beacon.test/x.png", "data:image/png;base64,BBB"]);
  check("one sheet for each picture", (doc.match(/class="sheet"/g) || []).length === 2);
  check("a picture from the web is left out", !doc.includes("beacon.test"));
  check("only data: pictures may load", doc.includes("img-src data:") && doc.includes("default-src 'none'"));
  check("the title is escaped", doc.includes("Ticket &quot;A&quot; &lt;1&gt;"));

  // The thread's keys: on the window, as use-thread-keys listens.
  let threadHeard = 0;
  window.addEventListener("keydown", (e) => {
    if (e.metaKey && e.key === "p") threadHeard += 1;
  });

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const show = (previewId) =>
    root.render(React.createElement(DraftAttachmentPreviewDialog, { items: ITEMS, previewId, onSelect: () => {}, onClose: () => {} }));

  show("pic");
  await sleep(50);
  pressPrint();
  let frame = null;
  for (let i = 0; i < 100 && !frame; i++) {
    await sleep(20);
    frame = document.getElementById("mail-print-frame");
  }
  check("⌘P on a previewed picture never reaches the thread", threadHeard === 0, `heard ${threadHeard}`);
  const printed = frame?.getAttribute("srcdoc") || frame?.srcdoc || "";
  check("and the picture is what is printed", printed.includes(`data:image/png;base64,${PIXEL}`), printed.slice(0, 120) || JSON.stringify(toasts));
  check("under the file's name", printed.includes("<title>boarding-pass.png</title>"));
  frame?.remove();

  show("txt");
  await sleep(50);
  pressPrint();
  await sleep(200);
  check("⌘P on a file Mail cannot print does not print the message either", threadHeard === 0 && !document.getElementById("mail-print-frame"));

  root.unmount();
});
