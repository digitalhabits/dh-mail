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
    assert(!text().includes("fit your week"), "nothing is asked before a mailbox is connected");
    pass("nothing is asked before a mailbox is connected");

    await act(() => announceMailboxConnected(NEW));
    assert(text().includes("How should this account fit your week?"), `the question is asked: ${text().slice(0, 200)}`);
    assert(text().includes(NEW), "it names the mailbox");
    pass("a new mailbox is asked how it should fit the week");

    const always = button("Always on");
    assert.equal(always.getAttribute("aria-checked"), "true", "Always on is chosen to begin with");
    pass("Always on is the default");

    await act(() => button("Work hours").click());
    assert.equal(button("Work hours").getAttribute("aria-checked"), "true", "Work hours is chosen");
    await act(() => button("Done").click());
    assert(!text().includes("fit your week"), "Done closes the question");
    pass("a rhythm is picked and Done closes");

    const hide = stored("redd-plan-mail-hide");
    assert(!hide?.accounts?.[NEW]?.hours, `work hours keep the mailbox shown: ${JSON.stringify(hide)}`);
    const pause = readPauseState(stored("redd-plan-mail-pause"));
    assert(!mailPauseVerdictForAccount(pause, NEW, at(1, 10)).paused, "Tuesday 10:00 fetches");
    assert(mailPauseVerdictForAccount(pause, NEW, at(1, 20)).paused, "Tuesday 20:00 does not");
    assert(mailPauseVerdictForAccount(pause, NEW, at(5, 12)).paused, "Saturday noon does not");
    pass("work hours are kept as the mailbox's own quiet hours");

    await act(() => announceMailboxConnected("ivy@example.org"));
    await act(() => button("Off on weekends").click());
    await act(() => button("Done").click());
    const row = stored("redd-plan-mail-hide")?.accounts?.["ivy@example.org"];
    assert(mailboxHideVerdict(row, at(5, 12)).hidden, `off on weekends hides it on Saturday: ${JSON.stringify(row)}`);
    assert(!mailboxHideVerdict(row, at(2, 12)).hidden, "and not on Wednesday");
    pass("off on weekends is kept as the hiding schedule");

    await act(() => announceMailboxConnected("oak@example.org"));
    await act(() => button("Set your own hours").click());
    assert(text().includes("Shown in Mail") && text().includes("New mail arrives"), "own hours shows both settings");
    assert(text().includes("Not shown"), "and the week's key");
    pass("own hours shows both settings and the week");

    root.unmount();
    process.exit(0);
  } catch (err) {
    console.error("the walk failed:", err);
    process.exit(1);
  }
}

void main();
