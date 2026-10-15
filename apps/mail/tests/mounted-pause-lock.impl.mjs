/**
 * The walk itself — see mounted-pause-lock.test.mjs.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { FrictionPanel, QuietHoursPanel } from "@/components/mail/pause-panels";
import { mailPauseVerdict } from "@/lib/mail/quiet-hours";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const act = async (fn, ms = 60) => {
  fn();
  await sleep(ms);
};

const LOCK = { words: 2 };
const WORK = { start: "09:00", end: "17:00", days: [0, 1, 2, 3, 4] };

let windows = [WORK];
let words = 10;
function Schedule({ lock }) {
  const [list, setList] = React.useState([WORK]);
  windows = list;
  return React.createElement(QuietHoursPanel, {
    windows: list,
    lock,
    account: null,
    accountLabel: null,
    followAll: false,
    onBack: () => {},
    onChange: setList,
    onDone: () => {},
  });
}
function Friction({ lock }) {
  const [count, setCount] = React.useState(10);
  words = count;
  return React.createElement(FrictionPanel, { words: count, lock, onChange: setCount, onBack: () => {} });
}

const rows = () => [...document.querySelectorAll("div.rounded-lg.bg-stone-50")];
const rowCount = () => rows().length;
const dayIn = (row, label) => rows()[row].querySelector(`button[aria-label="${label}"]`);
// 5 Oct 2026 is a Monday.
const MONDAY_10 = new Date(2026, 9, 5, 10);
const TUESDAY_10 = new Date(2026, 9, 6, 10);
const SATURDAY_NOON = new Date(2026, 9, 10, 12);
const arrives = (at) => !mailPauseVerdict({ quietHours: windows }, at).paused;
const byText = (text) => [...document.querySelectorAll("button")].find((b) => b.textContent === text);
const text = () => document.body.textContent || "";
const challengeWords = () => document.querySelector("p[aria-hidden].font-mono")?.textContent ?? "";
function typeInto(el, value) {
  const proto = el instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement : window.HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(el, value);
  el.dispatchEvent(new window.Event("input", { bubbles: true }));
}

async function main() {
  try {
    document.body.innerHTML = '<div id="r"></div>';
    let root = createRoot(document.getElementById("r"));
    await act(() => root.render(React.createElement(Schedule, { lock: LOCK })));
    // The panel shows the hours new mail arrives: around 09:00–17:00 on
    // weekdays, and all day at the weekend, which is the third rule.
    assert(rowCount() === 3, `three rules: ${rowCount()}`);
    await act(() => dayIn(2, "Mon").click());
    assert(!arrives(MONDAY_10), "Monday 10:00 is still quiet");
    assert(challengeWords().split(" ").length === 2, `two words asked: "${challengeWords()}"`);
    pass("more hours for new mail wait for the words (a tester's case)");

    await act(() => dayIn(2, "Sat").click());
    assert(!arrives(SATURDAY_NOON), "Saturday noon is quiet at once");
    assert(!document.querySelector("textarea"), "the Monday change waiting is dropped");
    pass("fewer hours go through at once, and drop the change waiting");

    await act(() => dayIn(2, "Mon").click());
    assert(challengeWords(), "Monday asks again");

    await act(() => typeInto(document.querySelector("textarea"), "wrong words"));
    assert(byText("Make the change").disabled, "wrong words do not unlock");
    await act(() => typeInto(document.querySelector("textarea"), challengeWords()));
    await act(() => byText("Make the change").click());
    assert(arrives(MONDAY_10), "Monday 10:00 now has new mail");
    assert(!arrives(SATURDAY_NOON), "Saturday noon is still quiet");
    pass("typed right, the change waiting is made, and Saturday stays quiet");

    await act(() => dayIn(2, "Tue").click());
    assert(arrives(TUESDAY_10), "Tuesday 10:00 has new mail at once");
    pass("once unlocked, the panel stays open for more");

    root.unmount();
    document.body.innerHTML = '<div id="r2"></div>';
    root = createRoot(document.getElementById("r2"));
    await act(() => root.render(React.createElement(Schedule, { lock: undefined })));
    await act(() => dayIn(2, "Mon").click());
    assert(arrives(MONDAY_10), "no pause running: Monday 10:00 has new mail at once");
    assert(!document.querySelector("textarea"), "and nothing is asked");
    pass("with no pause running, nothing is locked");

    root.unmount();
    document.body.innerHTML = '<div id="r3"></div>';
    root = createRoot(document.getElementById("r3"));
    await act(() => root.render(React.createElement(Friction, { lock: LOCK })));
    const slider = () => document.querySelector('input[type="range"]');
    await act(() => typeInto(slider(), "1"));
    assert.equal(words, 10, "the words stay at 10");
    assert(challengeWords(), "the words are asked for");
    pass("setting the words down to one waits for the words");
    await act(() => byText("Cancel").click());
    assert(!document.querySelector("textarea") && words === 10, "cancel leaves it at 10");
    await act(() => typeInto(slider(), "40"));
    assert.equal(words, 40, "more words go through at once");
    pass("cancel keeps the words; more words are free");

    root.unmount();
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

void main();
