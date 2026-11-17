/**
 * The walk itself — see mounted-person-empty.test.mjs.
 */

import * as React from "react";
import { createRoot } from "react-dom/client";

import { PersonPane } from "@/components/mail/PersonPane";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (ok, line) => {
  if (!ok) throw new Error(line);
  pass(line);
};

const nothing = () => {};

/** A person as the list groups them, with the conversations given. */
const person = (threads) => ({
  key: "rowan@example.org",
  name: "Rowan Vale",
  email: "rowan@example.org",
  people: [{ name: "Rowan Vale", email: "rowan@example.org" }],
  isGroup: false,
  unread: false,
  threads,
});

async function main() {
  try {
    const errors = [];
    window.addEventListener("error", (event) => errors.push(event.error ?? event.message));

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host, { onUncaughtError: (err) => errors.push(err) });
    root.render(
      React.createElement(PersonPane, {
        row: person([]),
        onOpenThread: nothing,
        zoom: 1,
        onZoomAdjust: nothing,
        onArchiveAll: nothing,
        onDeleteAll: nothing,
        onToggleRead: nothing,
        onArchiveThread: nothing,
        onTrashThread: nothing,
      })
    );
    await sleep(120);

    assert(errors.length === 0, "a person with no conversation draws with no error");
    assert((host.textContent || "").includes("Rowan Vale"), "and the pane is there, with the person's name");

    root.unmount();
    console.log("\nALL PASS");
    process.exit(0);
  } catch (err) {
    console.error("FAIL ", err);
    process.exit(1);
  }
}

void main();
