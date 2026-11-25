/**
 * The walk itself — see mounted-pause-early.test.mjs.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { AccountHoursMenu } from "@/components/mail/account-hours-menu";
import { UnpauseChallengeHost } from "@/components/mail/UnpauseChallenge";
import { usePauseChip } from "@/components/mail/use-pause-chip";
import { useMailT } from "@/lib/mail/i18n";
import { FETCH_EARLY_MINUTES, mailPauseVerdictForAccount, readPauseState } from "@/lib/mail/quiet-hours";
import { MAIL_PAUSE_KEY } from "@/lib/mail/storage-keys";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const act = async (fn, ms = 80) => {
  fn();
  await sleep(ms);
};

const ME = "rowan@example.org";
const text = () => document.body.textContent || "";
const button = (words) => [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes(words));
const challengeWords = () => document.querySelector("[data-challenge-words]")?.textContent ?? "";
const stored = () => readPauseState(JSON.parse(window.localStorage.getItem(MAIL_PAUSE_KEY) ?? "null"));
function typeInto(el, value) {
  const proto = el instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement : window.HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(el, value);
  el.dispatchEvent(new window.Event("input", { bubbles: true }));
}

/** Hours that pause new mail now and end in two hours, every day. */
const clock = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const NOW_HOURS = [{ start: clock(Date.now() - 60 * 60_000), end: clock(Date.now() + 2 * 60 * 60_000), days: [0, 1, 2, 3, 4, 5, 6] }];

/** The mailbox is shown: the Shown side has nothing to say here, until the last part. */
let hiddenNow = null;
const hide = {
  hidden: [],
  statusOf: () => hiddenNow ?? { hidden: false, byHand: false, reason: null, until: null, untilClock: null, shownEarlyUntil: null },
  hoursOf: () => (hiddenNow ? NOW_HOURS : []),
  showWords: 0,
  hideUntil: () => {},
  hideByHand: () => {},
  setHours: () => {},
  showNow: () => {},
  resumeSchedule: () => {},
  setShowWords: () => {},
  hideAgainMinutes: 15,
  setHideAgainMinutes: () => {},
  showWordsOf: () => (hiddenNow ? 9 : 0),
  hideAgainOf: () => 15,
  setShowWordsFor: () => {},
  setHideAgainFor: () => {},
};

let menuOpen = false;
let openMenu = () => {};
function Page() {
  const t = useMailT();
  const chip = usePauseChip({ accountEmails: [ME], accountLabels: new Map(), t });
  const [, rerender] = React.useState(0);
  openMenu = () => {
    menuOpen = true;
    rerender((n) => n + 1);
  };
  const pause = {
    state: chip.pauseState,
    now: chip.pauseNow,
    pauseUntil: chip.pauseMailUntil,
    resume: chip.resumeMail,
    getEarly: chip.getMailEarly,
    endEarly: chip.endMailEarly,
    setQuietHours: chip.setMailQuietHours,
    setFollowAllHours: chip.setFollowAllHours,
    setUnpauseWords: chip.setUnpauseWords,
  };
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(UnpauseChallengeHost),
    menuOpen
      ? React.createElement(AccountHoursMenu, {
          account: ME,
          accounts: [ME],
          labels: new Map(),
          isOutlookAccount: () => false,
          x: 10,
          y: 10,
          hide,
          pause,
          onDismiss: () => {
            menuOpen = false;
            rerender((n) => n + 1);
          },
        })
      : null
  );
}

async function main() {
  try {
    window.localStorage.clear();
    window.localStorage.setItem(MAIL_PAUSE_KEY, JSON.stringify({ quietHours: NOW_HOURS, unpauseWords: 2 }));
    assert(mailPauseVerdictForAccount(stored(), ME, new Date()).paused, "the hours pause new mail now");

    document.body.innerHTML = '<div id="r"></div>';
    const root = createRoot(document.getElementById("r"));
    await act(() => root.render(React.createElement(Page)));
    // As in the app: the menu opens on a press, after the state has loaded.
    await act(() => openMenu());

    assert(text().includes("New mail paused until"), `a sentence says new mail is paused: ${text().slice(0, 300)}`);
    assert(text().includes("By your schedule"), `and that the schedule did it: ${text().slice(0, 300)}`);
    assert(button(`Get new mail for ${FETCH_EARLY_MINUTES} minutes`), `a way round is offered: ${text().slice(0, 400)}`);
    assert(text().includes("Type 2 words first"), "and it says the words come first");
    assert(!button("For 1 hour") && !button("Rest of today"), "no rows that only pause it more, until asked");
    assert(button("Edit schedule") && button("Change what getting mail early takes"), "the two links are under the rows");
    pass("paused by the schedule, the menu offers new mail for 15 minutes, words first");

    await act(() => button("Pause for longer").click());
    const flyout = document.querySelector("[data-pointer-menu-flyout]");
    assert(flyout, "Pause for longer opens its times beside the menu");
    assert((flyout.textContent || "").includes("Pick a time…"), `and Pick a time…: ${flyout.textContent}`);
    assert(!(flyout.textContent || "").includes("For 1 hour"), `only times after the schedule lets go: ${flyout.textContent}`);
    await act(() => button("Pause for longer").click());
    assert(!document.querySelector("[data-pointer-menu-flyout]"), "a second press closes it");
    pass("Pause for longer lists only longer times, beside the menu");

    await act(() => button(`Get new mail for ${FETCH_EARLY_MINUTES} minutes`).click());
    assert.equal(challengeWords().split(" ").length, 2, `two words are asked: "${challengeWords()}"`);
    assert(mailPauseVerdictForAccount(stored(), ME, new Date()).paused, "nothing changes before the words");
    pass("the words are asked before anything changes");

    await act(() => typeInto(document.querySelector("textarea"), challengeWords()));
    const confirm = [...document.querySelectorAll("button")].find((b) => !b.disabled && /^Start fetching$/.test(b.textContent || ""));
    assert(confirm, `a button confirms the words: ${text().slice(-300)}`);
    await act(() => confirm.click());

    const state = stored();
    const now = Date.now();
    const early = state.accounts?.[ME]?.fetchEarlyUntil ?? 0;
    assert(Math.abs(early - (now + FETCH_EARLY_MINUTES * 60_000)) < 60_000, `new mail comes in for 15 minutes: ${JSON.stringify(state)}`);
    assert(!mailPauseVerdictForAccount(state, ME, new Date(now)).paused, "new mail comes in now");
    assert(mailPauseVerdictForAccount(state, ME, new Date(now + (FETCH_EARLY_MINUTES + 1) * 60_000)).paused, "and the hours pause it again after");
    assert.equal(state.quietHours.length, 1, "the schedule itself is kept");
    pass("typed right, new mail comes in for 15 minutes, and then the schedule again");

    // During the 15 minutes (mockup 10a): the menu counts down, and Pause now
    // goes back to the schedule with no words.
    await act(() => openMenu());
    assert(text().includes("Getting new mail until"), `the sentence says new mail comes in: ${text().slice(0, 300)}`);
    assert(/1[45] min left · then paused until/.test(text()), `the minutes left, and the pause after: ${text().slice(0, 300)}`);
    assert(button("Pause now") && text().includes("Back on your schedule until"), "Pause now, back on the schedule");
    assert(!text().includes("words first"), "no words to go back");
    await act(() => button("Pause now").click());
    assert(!challengeWords(), "nothing is asked");
    assert(!stored().accounts?.[ME]?.fetchEarlyUntil, `the early time is gone: ${JSON.stringify(stored())}`);
    assert(mailPauseVerdictForAccount(stored(), ME, new Date()).paused, "the schedule pauses new mail again");
    pass("during the 15 minutes, the menu counts down, and Pause now needs no words");

    root.unmount();

    // The Shown side, hidden by the schedule: the same shape.
    window.localStorage.setItem(MAIL_PAUSE_KEY, JSON.stringify({ quietHours: [] }));
    hiddenNow = {
      hidden: true,
      byHand: false,
      reason: "schedule",
      until: null,
      untilClock: NOW_HOURS[0].end,
      endsAt: new Date(Date.now() + 2 * 60 * 60_000),
      shownEarlyUntil: null,
    };
    menuOpen = false;
    const again = createRoot(document.getElementById("r"));
    await act(() => again.render(React.createElement(Page)));
    await act(() => openMenu());
    assert(text().includes("Hidden from Mail until") && text().includes("By your schedule"), `a sentence says it is hidden, and who: ${text().slice(0, 300)}`);
    assert(button("Show for 15 minutes…") && text().includes("Type 9 words first"), `Show for 15 minutes…, words first: ${text().slice(0, 400)}`);
    assert(button("Hide for longer") && button("Change what showing early takes"), "Hide for longer, and the links");
    pass("hidden by the schedule: the sentence, Show for 15 minutes…, and Hide for longer");
    again.unmount();
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

void main();
