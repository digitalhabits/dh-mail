/**
 * The walk itself — see mounted-composer-foot-typing.test.mjs.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { useComposerMoreBelow } from "@/components/mail/use-composer-more-below";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** What the letter measures. Set by the walk. */
const size = { scrollHeight: 100, clientHeight: 100 };
const measured = (el, name, read) =>
  Object.defineProperty(el, name, { configurable: true, get: read });

let renders = 0;
let shownMore = null;
let shownText = null;
function Band() {
  const columnRef = React.useRef(null);
  const [text, setText] = React.useState("");
  const more = useComposerMoreBelow(columnRef, "k");
  renders += 1;
  shownMore = more;
  shownText = text;
  // Heights are read from the elements, so they are put on the elements
  // before the hook's effect reads them.
  const column = (el) => {
    columnRef.current = el;
    if (!el) return;
    measured(el, "scrollHeight", () => size.scrollHeight);
    measured(el, "clientHeight", () => size.clientHeight);
    measured(el, "scrollTop", () => 0);
  };
  return React.createElement(
    "div",
    null,
    React.createElement(
      "div",
      { ref: column, "data-column": "" },
      React.createElement("input", {
        value: text,
        onChange: (e) => setText(e.target.value),
      })
    )
  );
}

/**
 * One key press, in the order WebKit runs it.
 *
 * The letter goes into the box. Then the `input` event reaches the band's
 * listener, which sits below React's. The browser runs the queued
 * microtasks between the two listeners. Then React reads the event.
 *
 * happy-dom runs no microtasks between two listeners of one event, so the
 * two halves are sent apart. `window.event` is set as the browser sets it.
 * React takes an `input` event as a key press, and a state change made
 * during one is drawn in a microtask.
 */
async function press(input, column, letter) {
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setValue.call(input, input.value + letter);
  const during = async (event, target) => {
    Object.defineProperty(window, "event", { configurable: true, value: event });
    try {
      target.dispatchEvent(event);
    } finally {
      delete window.event;
    }
  };
  // The band's listener alone: an event that does not bubble stops at the column.
  await during(new window.Event("input", { bubbles: false }), column);
  await Promise.resolve();
  await Promise.resolve();
  // React's turn.
  await during(new window.Event("input", { bubbles: true }), input);
  await Promise.resolve();
}

async function main() {
  let root;
  try {
    document.body.innerHTML = '<div id="r"></div>';
    root = createRoot(document.getElementById("r"));
    root.render(React.createElement(Band));
    await sleep(100);
    const column = document.querySelector("[data-column]");
    const input = document.querySelector("input");
    assert.equal(shownMore, false, "nothing below at first");

    await press(input, column, "p");
    await sleep(60);
    assert.equal(shownText, "p");

    // The suggestions opened with the first letter: the column is taller
    // than it shows now, and the foot grew. The next letter is the one that
    // was lost.
    size.scrollHeight = 400;
    await press(input, column, "e");
    assert.equal(shownMore, false, "no state changes while the key press is handled");
    assert.equal(input.value, "pe", "the box keeps the second letter");
    assert.equal(shownText, "pe", "and React has it");
    pass("a letter typed as the suggestions open is kept");

    await sleep(60);
    assert.equal(shownMore, true, "the shadow above Send comes on, a frame later");
    pass("the shadow above Send still follows the typing, a frame later");

    // A pick closes the suggestions: nothing is below any more. The first
    // letter of the next name was the one lost there.
    size.scrollHeight = 100;
    await press(input, column, "t");
    assert.equal(input.value, "pet", "the box keeps the letter after a pick");
    assert.equal(shownText, "pet", "and React has it");
    await sleep(60);
    assert.equal(shownMore, false, "the shadow goes off when nothing is below");
    pass("a letter typed as the suggestions close is kept");

    // Many letters in one frame ask once.
    size.scrollHeight = 400;
    const settled = renders;
    for (const letter of "abcde") await press(input, column, letter);
    const typed = renders - settled;
    await sleep(60);
    assert.equal(shownText, "petabcde");
    assert.equal(renders - settled - typed, 1, "five letters in one frame draw the band once more");
    pass("letters typed in one frame ask for one drawing of the shadow");
  } finally {
    root?.unmount();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
