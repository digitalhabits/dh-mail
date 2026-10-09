/**
 * The walk itself — see mounted-stack-threads.test.mjs.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { useMailViewMode } from "@/components/mail/mail-list-state";
import { StackThreadsSetting } from "@/components/mail/stack-threads-setting";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const act = async (fn, ms = 60) => {
  fn();
  await sleep(ms);
};

/** What the list reads: a second user of the setting. */
function List() {
  const [mode] = useMailViewMode();
  return React.createElement("p", { id: "list" }, mode);
}

async function main() {
  try {
    // The default, with nothing saved.
    localStorage.clear();
    document.body.innerHTML = '<div id="r"></div>';
    const root = createRoot(document.getElementById("r"));
    await act(() => root.render(React.createElement(React.Fragment, null, React.createElement(StackThreadsSetting), React.createElement(List))));
    const toggle = () => document.querySelector("[role=switch]");
    const list = () => document.getElementById("list").textContent;
    assert.equal(toggle().getAttribute("aria-checked"), "true");
    assert.equal(list(), "people");
    pass("with nothing saved, stacking is on");

    await act(() => toggle().click());
    assert.equal(toggle().getAttribute("aria-checked"), "false");
    assert.equal(list(), "threads", "the list follows at once");
    assert.equal(localStorage.getItem("redd-plan-mail-view-mode"), "threads");
    pass("the toggle turns stacking off for the list at once, and it is kept");

    await act(() => toggle().click());
    assert.equal(list(), "people");
    pass("and on again");

    root.unmount();
    process.exit(0);
  } catch (err) {
    console.error("the stack-threads walk failed:", err);
    process.exit(1);
  }
}

void main();
