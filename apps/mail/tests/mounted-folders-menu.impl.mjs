/**
 * The walk itself — see mounted-folders-menu.test.mjs. Fixtures invented.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { FoldersTabMenu, MAIL_THREAD_DRAG_TYPE } from "@/components/mail/MailFolders";

import { waitFor } from "./mounted-dom.mjs";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FOLDERS = [
  { name: "Ferries", count: 3 },
  { name: "Garden", count: 5 },
  { name: "Garage", count: 1 },
];
const calls = [];
const note = (name) => (...args) => {
  calls.push([name, ...args]);
};

const clickEl = (el) => {
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
  }
};
const search = () => document.querySelector("input[placeholder]");
const typeInto = (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(el, value);
  el.dispatchEvent(new window.Event("input", { bubbles: true }));
};
const key = (el, k) => el.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
const folderButton = (name) =>
  [...document.querySelectorAll("li button")].find((b) => (b.textContent || "").includes(name));

async function main() {
  try {
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root"));
    root.render(
      React.createElement(FoldersTabMenu, {
        folders: FOLDERS,
        loading: false,
        onOpenFolder: note("openFolder"),
        onCreateFolder: async (name) => calls.push(["createFolder", name]),
        onDropThread: async (folderName, thread) => calls.push(["dropThread", folderName, thread.threadId]),
        onOpenSent: note("openSent"),
      })
    );
    const trigger = await waitFor(() => document.querySelector('button[aria-label="Folders"]'));
    assert(trigger, "the Folders button is there");
    clickEl(trigger);
    await waitFor(() => search());
    assert(folderButton("Ferries") && folderButton("Garden") && folderButton("Garage"), "every folder is listed");
    typeInto(search(), "gar");
    await waitFor(() => !folderButton("Ferries"));
    assert(folderButton("Garden") && folderButton("Garage"), "the two that match stay");
    pass("the button opens the menu, and typing narrows its folders");

    // Typing marks the first match; one Down marks the second.
    key(search(), "ArrowDown");
    await sleep(50);
    key(search(), "Enter");
    await waitFor(() => calls.some((c) => c[0] === "openFolder"));
    const opened = calls.find((c) => c[0] === "openFolder")[1];
    assert.equal(opened.name, "Garage", `the second match opens: ${opened.name}`);
    pass("the arrow keys move the mark, and Enter opens the folder marked");

    await sleep(200);
    clickEl(trigger);
    await waitFor(() => search());
    key(search(), "Escape");
    await waitFor(() => !search());
    pass("Escape closes the menu");

    clickEl(trigger);
    await waitFor(() => folderButton("Ferries"));
    const data = new Map([[MAIL_THREAD_DRAG_TYPE, JSON.stringify({ account: "ingrid@solberg.example", threadId: "boat-1" })]]);
    const dt = { get types() { return [...data.keys()]; }, getData: (t) => data.get(t) ?? "", setData: (t, v) => data.set(t, v), dropEffect: "none" };
    const target = folderButton("Ferries").closest("li");
    for (const type of ["dragenter", "dragover", "drop"]) {
      const ev = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(ev, "dataTransfer", { value: dt });
      target.dispatchEvent(ev);
      await sleep(30);
    }
    await waitFor(() => calls.some((c) => c[0] === "dropThread"));
    assert.deepEqual(calls.find((c) => c[0] === "dropThread"), ["dropThread", "Ferries", "boat-1"]);
    pass("a conversation dropped on a folder in the menu is filed there");
  } catch (err) {
    console.error("the mounted walk failed:", err);
    process.exit(1);
  }
  process.exit(0);
}

void main();
