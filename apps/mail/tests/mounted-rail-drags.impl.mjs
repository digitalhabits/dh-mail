/**
 * The walk itself — see mounted-rail-drags.test.mjs. Fixtures invented.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { setMailApiTransport } from "@/lib/mail/api";
import { MailFolderRail } from "@/components/mail/MailFolderRail";

import { waitFor } from "./mounted-dom.mjs";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SOLVEIG = "solveig@nordli.example";
const ARNE = "arne@nordli.example";
const FOLDERS = [
  { account: SOLVEIG, name: "Garden", count: 4 },
  { account: SOLVEIG, name: "Garden/Seeds", count: 2 },
  { account: ARNE, name: "Boat", count: 3 },
];
setMailApiTransport(async () => new Response("{}", { status: 200 }));

const calls = [];
const noteAsync = (name) => async (...args) => {
  calls.push([name, ...args]);
};

/** A DataTransfer that keeps what is set on it. */
function transfer() {
  const data = new Map();
  return {
    get types() {
      return [...data.keys()];
    },
    setData: (type, value) => data.set(type, value),
    getData: (type) => data.get(type) ?? "",
    setDragImage: () => undefined,
    dropEffect: "none",
    effectAllowed: "all",
  };
}
const drag = (el, type, dt, clientY = 0) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dt });
  Object.defineProperty(event, "clientY", { value: clientY });
  el.dispatchEvent(event);
  return event;
};
// The heading stays the drop target while a folder is carried, when it is
// not itself draggable.
const heading = (email) =>
  [...document.querySelectorAll("[draggable]")].find((el) => (el.textContent || "").trim().startsWith(email));

async function main() {
  // Each mailbox's section has its own band of the rail, Solveig's on top.
  const proto = window.HTMLElement.prototype;
  proto.getBoundingClientRect = function () {
    const text = this.textContent || "";
    const s = text.includes(SOLVEIG), a = text.includes(ARNE);
    const [top, bottom] = s && !a ? [0, 200] : a && !s ? [200, 300] : [0, 300];
    return { top, bottom, left: 0, right: 200, width: 200, height: bottom - top, x: 0, y: top };
  };
  try {
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root"));
    root.render(
      React.createElement(MailFolderRail, {
        accountFolders: FOLDERS,
        loading: false,
        accounts: [SOLVEIG, ARNE],
        openFolder: null,
        systemView: null,
        draftCount: 0,
        onOpenFolder: () => undefined,
        onOpenSent: () => undefined,
        onOpenDrafts: () => undefined,
        onOpenTrash: () => undefined,
        onOpenInbox: () => undefined,
        onOpenJunk: () => undefined,
        onOpenArchived: () => undefined,
        onCreateFolder: noteAsync("createFolder"),
        onRenameFolder: noteAsync("renameFolder"),
        onDeleteFolder: noteAsync("deleteFolder"),
        onReorderAccount: noteAsync("reorderAccount"),
        draggingAccount: null,
        onDropThread: () => undefined,
        onDropTrash: () => undefined,
      })
    );
    await waitFor(() => heading(ARNE) && heading(SOLVEIG));

    // Arne's heading, carried to the top of the rail.
    const dt = transfer();
    drag(heading(ARNE), "dragstart", dt);
    await sleep(50);
    const rail = heading(SOLVEIG).closest(".overflow-y-auto");
    assert(rail, "the rail's scroller is there");
    drag(rail, "dragover", dt, 10);
    await sleep(30);
    drag(rail, "drop", dt, 10);
    drag(heading(ARNE), "dragend", dt);
    await waitFor(() => calls.some((c) => c[0] === "reorderAccount"));
    assert.deepEqual(calls.find((c) => c[0] === "reorderAccount"), ["reorderAccount", ARNE, SOLVEIG]);
    pass("a mailbox's heading dragged above another mailbox moves it there");

    // Seeds lives in Garden; dropped on Solveig's heading it comes out to the top.
    const unfold = document.querySelector('button[aria-label="Open Garden"]');
    if (unfold) unfold.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    const seeds = await waitFor(() =>
      [...document.querySelectorAll("[draggable=true]")].find((el) => (el.textContent || "").trim().startsWith("Seeds"))
    );
    assert(seeds, "the nested folder can be dragged");
    const dt2 = transfer();
    drag(seeds, "dragstart", dt2);
    await sleep(50);
    drag(heading(SOLVEIG), "dragover", dt2);
    await sleep(30);
    drag(heading(SOLVEIG), "drop", dt2);
    drag(seeds, "dragend", dt2);
    await waitFor(() => calls.some((c) => c[0] === "renameFolder"));
    assert.deepEqual(calls.find((c) => c[0] === "renameFolder"), ["renameFolder", SOLVEIG, "Garden/Seeds", "Seeds"]);
    pass("a folder inside another, dropped on its mailbox's heading, comes out to the top");
  } catch (err) {
    console.error("the mounted walk failed:", err, JSON.stringify(calls));
    process.exit(1);
  }
  process.exit(0);
}

void main();
