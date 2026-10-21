/**
 * The walk itself — see mounted-time-field.test.mjs.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { TimeField } from "@/components/mail/date-time-pick";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The box's words, as a key press leaves them. */
async function typeInto(input, text) {
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setValue.call(input, text);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  await sleep(20);
}

/** A menu that holds the time, as the snooze menu does. */
let setFromOutside = null;
const changes = [];
function Holder() {
  const [hm, setHm] = React.useState("09:00");
  setFromOutside = setHm;
  return React.createElement(TimeField, {
    value: hm,
    onChange: (next) => {
      changes.push(next);
      setHm(next);
    },
    label: "Time",
  });
}

async function main() {
  try {
    document.body.innerHTML = '<div id="r"></div>';
    const root = createRoot(document.getElementById("r"));
    root.render(React.createElement(Holder));
    await sleep(50);
    const input = document.querySelector("input");
    assert.equal(input.value, "09:00");

    await typeInto(input, "0:00");
    assert.equal(input.value, "0:00", "the box keeps the words being typed");
    assert.deepEqual(changes, ["00:00"]);
    pass("taking the 9 out of 09:00 leaves 0:00 in the box");

    await typeInto(input, "08:00");
    assert.equal(input.value, "08:00");
    assert.equal(changes.at(-1), "08:00");
    pass("the 8 goes where the 9 was, and 08:00 is the time");

    setFromOutside("10:30");
    await sleep(20);
    assert.equal(input.value, "10:30");
    pass("a time set from outside still replaces the box's words");

    root.unmount();
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

void main();
