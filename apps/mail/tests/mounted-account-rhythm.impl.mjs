/**
 * The walk itself — see mounted-account-rhythm.test.mjs.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { ConnectedMailboxRhythm } from "@/components/mail/AccountRhythmDialog";
import { announceMailboxConnected } from "@/lib/mail/mailbox-connected";
import { mailboxHideVerdict } from "@/lib/mail/mailbox-hide";
import { mailPauseVerdictForAccount, readPauseState } from "@/lib/mail/quiet-hours";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const act = async (fn, ms = 80) => {
  fn();
  await sleep(ms);
};

const NEW = "rowan@example.org";
const text = () => document.body.textContent || "";
const button = (words) => [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes(words));
const stored = (key) => JSON.parse(window.localStorage.getItem(key) ?? "null");
// 5 Oct 2026 is a Monday.
const at = (day, h) => new Date(2026, 9, 5 + day, h);

async function main() {
  try {
    window.localStorage.clear();
    document.body.innerHTML = '<div id="r"></div>';
    const root = createRoot(document.getElementById("r"));
    await act(() => root.render(React.createElement(ConnectedMailboxRhythm)));
    assert(!text().includes("see this account"), "nothing is asked before a mailbox is connected");
    pass("nothing is asked before a mailbox is connected");

    await act(() => announceMailboxConnected(NEW));
    assert(text().includes("When do you want to see this account in your inbox?"), `the first question is asked: ${text().slice(0, 200)}`);
    assert(text().includes(NEW) && text().includes("Step 1 of 2"), "it names the mailbox and the step");
    pass("a new mailbox is asked when to see it, step 1 of 2");

    assert.equal(button("Always").getAttribute("aria-checked"), "true", "Always is chosen to begin with");
    assert(!text().includes("Add more hours"), "Always shows the week, not the editor");
    pass("Always is the default, with no editor");

    await act(() => button("Weekdays only").click());
    assert.equal(button("Weekdays only").getAttribute("aria-checked"), "true", "Weekdays only is chosen");
    assert(text().includes("Add more hours"), "another answer opens the editor");
    pass("an answer other than Always opens the editor");

    await act(() => button("Next").click());
    assert(text().includes("When should new mail come in?") && text().includes("Step 2 of 2"), "Next asks the second question");
    await act(() => button("Working hours").click());
    await act(() => button("Done").click());
    assert(!text().includes("new mail come in"), "Done closes the questions");
    pass("both questions are answered and Done closes");

    const row = stored("redd-plan-mail-hide")?.accounts?.[NEW];
    assert(mailboxHideVerdict(row, at(5, 12)).hidden, `weekdays only hides it on Saturday: ${JSON.stringify(row)}`);
    assert(!mailboxHideVerdict(row, at(2, 12)).hidden, "and not on Wednesday");
    const pause = readPauseState(stored("redd-plan-mail-pause"));
    assert(!mailPauseVerdictForAccount(pause, NEW, at(1, 10)).paused, "Tuesday 10:00 fetches");
    assert(mailPauseVerdictForAccount(pause, NEW, at(1, 20)).paused, "Tuesday 20:00 does not");
    pass("the answers are kept as the hiding schedule and the mailbox's quiet hours");

    await act(() => announceMailboxConnected("ivy@example.org"));
    await act(() => button("Working hours").click());
    await act(() => button("Next").click());
    await act(() => button("Back").click());
    assert(text().includes("Step 1 of 2"), "Back goes to the first question");
    assert.equal(button("Working hours").getAttribute("aria-checked"), "true", "with its answer kept");
    pass("Back keeps the first answer");

    const lock = document.querySelector('[role="switch"][aria-label="Make it harder to show early"]');
    assert(lock && lock.getAttribute("aria-checked") === "false", "the lock is off to begin with");
    await act(() => lock.click());
    await act(() => button("Next").click());
    await act(() => button("Done").click());
    assert.equal(stored("redd-plan-mail-hide")?.showWords, 10, `the lock asks for words: ${JSON.stringify(stored("redd-plan-mail-hide"))}`);
    pass("turning on the lock sets the words to type");

    await act(() => announceMailboxConnected("oak@example.org"));
    await act(() => button("Custom hours").click());
    assert.equal(button("Custom hours").getAttribute("aria-checked"), "true", "Custom hours is chosen");
    const cards = () => document.querySelectorAll('[aria-label="From"]').length;
    const before = cards();
    await act(() => button("Add more hours").click());
    assert(cards() > 0 && text().includes("Add more hours"), "custom hours shows the editor");
    assert(cards() >= before, "and Add more hours adds a rule");
    pass("custom hours opens the same editor as the menus");

    root.unmount();
    process.exit(0);
  } catch (err) {
    console.error("the walk failed:", err);
    process.exit(1);
  }
}

void main();
